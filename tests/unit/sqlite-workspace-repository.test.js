import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteDatabase } from '../../backend/src/storage/sqlite/database.js';
import { WorkspaceRepository } from '../../backend/src/storage/sqlite/workspace-repository.js';
import { createWorkspaceCache } from '../../backend/src/storage/cache/workspace-cache.js';

async function createRepository(options = {}) {
  const storage = await openSqliteDatabase(':memory:');
  return {
    storage,
    repository: new WorkspaceRepository(storage.database, createWorkspaceCache(), options)
  };
}

test('SQLite schema is isolated by tenant and preserves workspace documents', async t => {
  const { storage, repository } = await createRepository();
  t.after(() => storage.close());
  const ownerA = await repository.createAccount({
    email: 'owner-a@example.test',
    displayName: 'Owner A',
    passwordHash: 'scrypt-hash-a'
  });
  const ownerB = await repository.createAccount({
    email: 'owner-b@example.test',
    displayName: 'Owner B',
    passwordHash: 'scrypt-hash-b'
  });
  const tenantsA = await repository.listTenantsForSubject(ownerA.subject);
  const tenantsB = await repository.listTenantsForSubject(ownerB.subject);
  assert.equal(tenantsA.length, 1);
  assert.equal(tenantsB.length, 1);
  assert.notEqual(tenantsA[0].tenantId, tenantsB[0].tenantId);
  assert.equal(tenantsA[0].role, 'owner');

  assert.ok(await repository.getDocuments(ownerA.tenantId, 'main'));
  assert.equal(await repository.getDocuments('unknown-tenant', 'main'), null);
  assert.equal(await repository.getMembership(ownerA.tenantId, ownerB.subject), null);

  const taskDocument = { tasks: [{ task_id: 'T1', status: 'pending' }] };
  assert.equal(await repository.setDocument(ownerA.tenantId, 'main', 'tasks', taskDocument), true);
  const saved = await repository.getDocuments(ownerA.tenantId, 'main');
  assert.equal(saved.tasks.tasks[0].status, 'not-started');
  assert.equal((await repository.listTaskDocuments(ownerA.tenantId))[0].tasks[0].status, 'not-started');
});

test('all user-controlled values are SQL parameters and cannot alter the schema', async t => {
  const { storage, repository } = await createRepository();
  t.after(() => storage.close());
  const owner = await repository.createAccount({
    email: 'owner@example.test',
    displayName: 'Owner',
    passwordHash: 'hash'
  });
  const payload = `'); DROP TABLE users; --`;
  const message = await repository.createMessage({
    tenantId: owner.tenantId,
    workspaceId: 'main',
    conversationId: 'project',
    senderSubject: owner.subject,
    senderName: 'Owner',
    content: payload,
    parentMessageId: null
  });
  assert.equal(message.content, payload);
  assert.equal((await repository.listMessages(owner.tenantId, 'main', 'project'))[0].content, payload);
  assert.equal((await repository.getAccountByEmail('owner@example.test')).subject, owner.subject);
  assert.equal(storage.database.prepare('SELECT count(*) AS count FROM users').get().count, 1);
  assert.equal(await repository.findAccountIdentityByEmail(`x' OR 1=1 --`), null);
});

test('workspace/member and direct-conversation operations remain tenant-scoped', async t => {
  const { storage, repository } = await createRepository();
  t.after(() => storage.close());
  const owner = await repository.createAccount({
    email: 'owner@example.test',
    displayName: 'Owner',
    passwordHash: 'hash'
  });
  const colleague = await repository.createAccount({
    email: 'colleague@example.test',
    displayName: 'Colleague',
    passwordHash: 'hash'
  });
  const member = await repository.upsertMember(owner.tenantId, {
    subject: colleague.subject,
    email: colleague.email,
    displayName: colleague.displayName,
    role: 'editor',
    capabilityProfile: 'backend-developer',
    responsibility: 'Engineer',
    department: 'Engineering'
  });
  assert.equal(member.role, 'editor');
  assert.deepEqual(
    (await repository.listMembers(owner.tenantId)).map(item => item.email),
    ['colleague@example.test', 'owner@example.test']
  );

  const conversationId = 'dm-test';
  await repository.getOrCreateDirectConversation(
    owner.tenantId,
    'main',
    conversationId,
    [owner.subject, colleague.subject]
  );
  assert.equal(await repository.canAccessConversation(owner.tenantId, 'main', conversationId, colleague.subject), true);
  assert.equal(await repository.canAccessConversation('another-tenant', 'main', conversationId, colleague.subject), false);
  const created = await repository.createMessage({
    tenantId: owner.tenantId,
    workspaceId: 'main',
    conversationId,
    senderSubject: owner.subject,
    senderName: 'Owner',
    content: 'hello',
    parentMessageId: null
  });
  assert.equal((await repository.listMessagesAfter(owner.tenantId, 'main', conversationId, '')).length, 1);
  assert.equal((await repository.getMessage(owner.tenantId, 'main', conversationId, created.id)).content, 'hello');
});
