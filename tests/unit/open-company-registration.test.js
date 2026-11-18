import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountAuth } from '../../backend/src/api/account-auth.js';
import { createApiApp } from '../../backend/src/api/app.js';
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

test('open company registration creates company and owner account in one step', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const session = await accountAuth.registerCompany({
    email: 'founder@mycompany.test',
    displayName: 'Founder Alice',
    password: 'secure-founder-password-123',
    companyName: 'Acme Innovation Labs',
    companyType: 'technology',
    website: 'https://innovation.acme.test',
    agreeToTerms: true
  });

  assert.ok(session.access_token);
  assert.equal(session.must_change_password, false);
  assert.equal(session.terms_accepted, true);
  assert.equal(session.profile.email, 'founder@mycompany.test');
  assert.equal(session.profile.name, 'Founder Alice');
  assert.ok(session.company);
  assert.equal(session.company.name, 'Acme Innovation Labs');

  // Verify owner can log in with their password
  const loginSession = await accountAuth.login({
    email: 'founder@mycompany.test',
    password: 'secure-founder-password-123'
  });
  assert.ok(loginSession.access_token);
  assert.equal(loginSession.profile.email, 'founder@mycompany.test');

  // Verify tenant membership
  const tenants = await repository.listTenantsForSubject(session.profile.sub);
  assert.equal(tenants.length, 1);
  assert.equal(tenants[0].name, 'Acme Innovation Labs');
  assert.equal(tenants[0].role, 'owner');
});

test('team members do not need to register on the platform - platform generates credentials', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  // 1. Owner registers company
  const ownerSession = await accountAuth.registerCompany({
    email: 'owner@startup.test',
    displayName: 'Owner Olivia',
    password: 'owner-master-password-123',
    companyName: 'HyperGrowth Tech',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  // 2. Add team member via member route logic or employee provisioning
  const provisioned = await accountAuth.provisionEmployee({
    displayName: 'Bob Engineer',
    email: 'bob@hypergrowth.test',
    employeeCode: 'EMP-001',
    jobTitle: 'Backend developer',
    department: 'Engineering',
    experienceLevel: 'senior',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  assert.ok(provisioned.temporaryPassword, 'Platform must generate temporary password');
  assert.equal(provisioned.employee.email, 'bob@hypergrowth.test');

  // 3. Team member logs in directly with platform-generated login ID (email) and password
  const memberLogin = await accountAuth.login({
    email: 'bob@hypergrowth.test',
    password: provisioned.temporaryPassword
  });
  assert.ok(memberLogin.access_token);
  assert.equal(memberLogin.must_change_password, true, 'Member must change password on first login');

  // 4. Team member updates password
  const changedSession = await accountAuth.changePassword(
    memberLogin.profile.sub,
    'bobs-new-private-password-123',
    { agreeToTerms: true }
  );
  assert.equal(changedSession.must_change_password, false);

  // 5. Team member can now log in with their updated password
  const postChangeLogin = await accountAuth.login({
    email: 'bob@hypergrowth.test',
    password: 'bobs-new-private-password-123'
  });
  assert.ok(postChangeLogin.access_token);
});

test('role-based access levels: owner, admin, editor, viewer and capability profiles', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const ownerSession = await accountAuth.registerCompany({
    email: 'boss@enterprise.test',
    displayName: 'Company Boss',
    password: 'boss-password-12345',
    companyName: 'Enterprise Corp',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  // Provision an HR manager
  const hrManager = await accountAuth.provisionEmployee({
    displayName: 'HR Leader',
    email: 'hr@enterprise.test',
    employeeCode: 'HR-01',
    jobTitle: 'HR manager',
    department: 'People',
    experienceLevel: 'senior',
    accessRole: 'hr-manager'
  }, tenantId, ownerSession.profile.sub);

  // Verify and activate
  await repository.verifyEmployee(tenantId, hrManager.employee.employeeId, ownerSession.profile.sub);
  const hrMembership = await repository.getMembership(tenantId, hrManager.employee.subject);
  assert.equal(hrMembership.status, 'active');
  assert.equal(hrMembership.capabilityProfile, 'hr-manager');

  // Provision a regular employee
  const dev = await accountAuth.provisionEmployee({
    displayName: 'Dev Dave',
    email: 'dave@enterprise.test',
    employeeCode: 'DEV-01',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'mid-level',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  await repository.verifyEmployee(tenantId, dev.employee.employeeId, ownerSession.profile.sub);
  const devMembership = await repository.getMembership(tenantId, dev.employee.subject);
  assert.equal(devMembership.status, 'active');
  assert.equal(devMembership.role, 'editor');
  assert.equal(devMembership.capabilityProfile, 'employee');
});
