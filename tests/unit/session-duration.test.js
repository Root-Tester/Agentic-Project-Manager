import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountAuth } from '../../backend/src/api/account-auth.js';
import { openSqliteDatabase } from '../../backend/src/storage/sqlite/database.js';
import { WorkspaceRepository } from '../../backend/src/storage/sqlite/workspace-repository.js';
import { createWorkspaceCache } from '../../backend/src/storage/cache/workspace-cache.js';

const SECRET = 'a-test-signing-secret-that-is-long-enough-123456';

async function setup() {
  const storage = await openSqliteDatabase(':memory:');
  const repository = new WorkspaceRepository(storage.database, createWorkspaceCache());
  const accountAuth = createAccountAuth({
    repository,
    secret: SECRET
  });
  return { storage, repository, accountAuth };
}

test('session ID is generated and owner account receives at least 20 hours validity', async t => {
  const { storage, accountAuth } = await setup();
  t.after(() => storage.close());

  const session = await accountAuth.registerCompany({
    email: 'owner@sessions.test',
    displayName: 'Company Owner',
    password: 'owner-password-123',
    companyName: 'Session Corp',
    companyType: 'technology',
    agreeToTerms: true
  });

  assert.ok(session.session_id, 'Session must include session_id');
  assert.ok(session.sessionId, 'Session must include sessionId');
  assert.equal(session.expires_in, 20 * 3600, 'Owner session must be valid for at least 20 hours (72000s)');
  assert.ok(session.expires_at, 'Session must include expires_at');
  const expiresAtMs = new Date(session.expires_at).getTime();
  const diffHours = (expiresAtMs - Date.now()) / (1000 * 3600);
  assert.ok(diffHours >= 19.9 && diffHours <= 20.1, 'Expiry must be approximately 20 hours in the future');

  // Verify token claims preserve session_id
  const verified = await accountAuth.verifyToken(session.access_token);
  assert.equal(verified.sessionId, session.session_id);
});

test('standard employee accounts receive 15 hours session validity', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  // Register company first
  const ownerSession = await accountAuth.registerCompany({
    email: 'boss@timing.test',
    displayName: 'Boss',
    password: 'boss-password-123',
    companyName: 'Timing Corp',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  // Provision normal team member
  const provisioned = await accountAuth.provisionEmployee({
    displayName: 'Regular Staff',
    email: 'staff@timing.test',
    employeeCode: 'STAFF-01',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'mid-level',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  // Login as team member
  const memberLogin = await accountAuth.login({
    email: 'staff@timing.test',
    password: provisioned.temporaryPassword
  });

  assert.ok(memberLogin.session_id, 'Member must receive a session ID');
  assert.equal(memberLogin.expires_in, 15 * 3600, 'Regular member session must be valid for 15 hours (54000s)');
  assert.ok(memberLogin.expires_at);
  const diffHours = (new Date(memberLogin.expires_at).getTime() - Date.now()) / (1000 * 3600);
  assert.ok(diffHours >= 14.9 && diffHours <= 15.1, 'Expiry must be approximately 15 hours in the future');
});

test('executive / CEO / Managing Director / Board Member accounts receive at least 20 hours session validity', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const ownerSession = await accountAuth.registerCompany({
    email: 'founder@ceo.test',
    displayName: 'Founder',
    password: 'founder-password-123',
    companyName: 'Executive Corp',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  // Provision an executive / CEO
  const provisioned = await accountAuth.provisionEmployee({
    displayName: 'Chief Executive Officer',
    email: 'ceo@executive.test',
    employeeCode: 'EXEC-01',
    jobTitle: 'Chief Executive Officer',
    department: 'Governance',
    experienceLevel: 'senior',
    accessRole: 'manager'
  }, tenantId, ownerSession.profile.sub);

  // Update membership to have executive capability profile
  await repository.upsertMember(tenantId, {
    subject: provisioned.employee.subject,
    role: 'admin',
    displayName: 'Chief Executive Officer',
    capabilityProfile: 'executive',
    responsibility: 'CEO'
  });

  const ceoLogin = await accountAuth.login({
    email: 'ceo@executive.test',
    password: provisioned.temporaryPassword
  });

  assert.ok(ceoLogin.session_id);
  assert.equal(ceoLogin.expires_in, 20 * 3600, 'CEO / Executive session must be valid for at least 20 hours (72000s)');

  // Provision a board member
  const boardMember = await accountAuth.provisionEmployee({
    displayName: 'Board Director',
    email: 'board@executive.test',
    employeeCode: 'BOARD-01',
    jobTitle: 'Board member',
    department: 'Governance',
    experienceLevel: 'senior',
    accessRole: 'board-member'
  }, tenantId, ownerSession.profile.sub);

  const boardLogin = await accountAuth.login({
    email: 'board@executive.test',
    password: boardMember.temporaryPassword
  });
  assert.equal(boardLogin.expires_in, 20 * 3600, 'Board member session must be valid for at least 20 hours (72000s)');
});

test('account blocking terminates active session immediately and unblocking restores access', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const ownerSession = await accountAuth.registerCompany({
    email: 'founder@block.test',
    displayName: 'Company Founder',
    password: 'founder-password-123',
    companyName: 'Security Corp',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  const provisioned = await accountAuth.provisionEmployee({
    displayName: 'Target User',
    email: 'target@block.test',
    employeeCode: 'TGT-01',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'mid-level',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  const userSession = await accountAuth.login({
    email: 'target@block.test',
    password: provisioned.temporaryPassword
  });

  // Verify token works before blocking
  const verifiedBefore = await accountAuth.verifyToken(userSession.access_token);
  assert.equal(verifiedBefore.email, 'target@block.test');

  // Block employee account
  const blocked = await repository.blockEmployee(tenantId, provisioned.employee.employeeId);
  assert.ok(blocked);
  assert.equal(blocked.status, 'disabled');

  // Verify token fails immediately after blocking
  await assert.rejects(
    async () => accountAuth.verifyToken(userSession.access_token),
    /Account session is no longer active/
  );

  // Login also fails
  await assert.rejects(
    async () => accountAuth.login({ email: 'target@block.test', password: provisioned.temporaryPassword }),
    /Email or password is incorrect/
  );

  // Unblock account
  const unblocked = await repository.unblockEmployee(tenantId, provisioned.employee.employeeId);
  assert.ok(unblocked);
  assert.equal(unblocked.status, 'active');

  // Login works again after unblocking
  const restoredSession = await accountAuth.login({
    email: 'target@block.test',
    password: provisioned.temporaryPassword
  });
  assert.ok(restoredSession.access_token);
  const verifiedAfter = await accountAuth.verifyToken(restoredSession.access_token);
  assert.equal(verifiedAfter.email, 'target@block.test');
});
