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

test('first login mandatory password change is enforced for provisioned employees', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  // 1. Owner registers company
  const ownerSession = await accountAuth.registerCompany({
    email: 'admin@company.test',
    displayName: 'Admin User',
    password: 'admin-password-123',
    companyName: 'Tech Innovations',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  // 2. Provision an employee
  const provisioned = await accountAuth.provisionEmployee({
    displayName: 'Alice Developer',
    email: 'alice@company.test',
    employeeCode: 'EMP-001',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'senior',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  assert.ok(provisioned.temporaryPassword);

  // 3. Employee signs in with temporary password
  const initialLogin = await accountAuth.login({
    email: 'alice@company.test',
    password: provisioned.temporaryPassword
  });
  assert.equal(initialLogin.must_change_password, true, 'must_change_password must be true on first login');

  // Verify token claims reflect mustChangePassword
  const verified = await accountAuth.verifyToken(initialLogin.access_token);
  assert.equal(verified.mustChangePassword, true);

  // 4. Employee changes their password
  const updatedSession = await accountAuth.changePassword(
    initialLogin.profile.sub,
    'new-private-password-for-alice-123',
    { agreeToTerms: true }
  );
  assert.equal(updatedSession.must_change_password, false, 'must_change_password must be false after update');

  // 5. Subsequent login with new password succeeds and has must_change_password = false
  const subsequentLogin = await accountAuth.login({
    email: 'alice@company.test',
    password: 'new-private-password-for-alice-123'
  });
  assert.equal(subsequentLogin.must_change_password, false);
});

test('admin or HR can reset / recover initial password for an employee', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const ownerSession = await accountAuth.registerCompany({
    email: 'owner@recover.test',
    displayName: 'Owner',
    password: 'owner-password-123',
    companyName: 'Recovery Corp',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  const provisioned = await accountAuth.provisionEmployee({
    displayName: 'Forgetful User',
    email: 'forgetful@recover.test',
    employeeCode: 'EMP-002',
    jobTitle: 'Backend developer',
    department: 'Engineering',
    experienceLevel: 'mid-level',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  // Admin resets the lost password
  const resetResult = await accountAuth.resetEmployeePassword(tenantId, provisioned.employee.employeeId);
  assert.ok(resetResult.temporaryPassword);
  assert.equal(resetResult.email, 'forgetful@recover.test');

  // Employee can log in with new recovered password and must change password
  const loginSession = await accountAuth.login({
    email: 'forgetful@recover.test',
    password: resetResult.temporaryPassword
  });
  assert.ok(loginSession.access_token);
  assert.equal(loginSession.must_change_password, true);
});

test('offboarding: task handover reassignment and account deletion for departed / fired employees', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const ownerSession = await accountAuth.registerCompany({
    email: 'director@delivery.test',
    displayName: 'Director',
    password: 'director-password-123',
    companyName: 'Delivery Co',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  // Provision departing employee and handover recipient
  const departed = await accountAuth.provisionEmployee({
    displayName: 'Leaving Worker',
    email: 'leaving@delivery.test',
    employeeCode: 'DEV-LEAVE',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'senior',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  const activeWorker = await accountAuth.provisionEmployee({
    displayName: 'Active Worker',
    email: 'active@delivery.test',
    employeeCode: 'DEV-ACTIVE',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'senior',
    accessRole: 'employee'
  }, tenantId, ownerSession.profile.sub);

  await repository.verifyEmployee(tenantId, departed.employee.employeeId, ownerSession.profile.sub);
  await repository.verifyEmployee(tenantId, activeWorker.employee.employeeId, ownerSession.profile.sub);

  // Create workspace tasks assigned to DEV-LEAVE
  const sampleTasks = {
    tasks: [
      {
        task_id: 'TASK-101',
        task_name: 'Important customer feature',
        assigned_to: 'DEV-LEAVE',
        status: 'in-progress'
      },
      {
        task_id: 'TASK-102',
        task_name: 'Security patch',
        assigned_to: 'DEV-LEAVE',
        status: 'testing'
      }
    ]
  };
  await repository.setDocument(tenantId, 'main', 'tasks', sampleTasks);

  // Mark employee as fired / departed
  await repository.updateEmployeeStatus(tenantId, departed.employee.employeeId, 'fired');
  const employeeRecord = await repository.getEmployee(tenantId, departed.employee.employeeId);
  assert.equal(employeeRecord.employmentStatus, 'fired');

  // Verify manager can access uncompleted tasks for handover
  const assignedTasks = await repository.getEmployeeTasks(tenantId, 'DEV-LEAVE');
  assert.equal(assignedTasks.length, 2);

  // Hand over / reassign tasks to DEV-ACTIVE
  const reassignedCount = await repository.reassignTasks(tenantId, 'DEV-LEAVE', 'DEV-ACTIVE');
  assert.equal(reassignedCount, 2);

  // Confirm tasks are now assigned to DEV-ACTIVE
  const updatedTasksDoc = await repository.getDocument(tenantId, 'main', 'tasks');
  assert.equal(updatedTasksDoc.tasks[0].assigned_to, 'DEV-ACTIVE');
  assert.equal(updatedTasksDoc.tasks[1].assigned_to, 'DEV-ACTIVE');

  // Verify deletion of employee account once handover is complete
  const deleteResult = await repository.deleteEmployee(tenantId, departed.employee.employeeId);
  assert.equal(deleteResult.success, true);

  const afterDelete = await repository.getEmployee(tenantId, departed.employee.employeeId);
  assert.equal(afterDelete, null);
});

test('batch employee provisioning requires verified employee roster', async t => {
  const { storage, accountAuth } = await setup();
  t.after(() => storage.close());

  const ownerSession = await accountAuth.registerCompany({
    email: 'boss@import.test',
    displayName: 'Boss',
    password: 'boss-password-123',
    companyName: 'Import Corp',
    companyType: 'technology',
    agreeToTerms: true
  });
  const tenantId = ownerSession.company.tenantId;

  const rosterList = [
    {
      displayName: 'Imported One',
      email: 'one@import.test',
      employeeCode: 'IMP-001',
      jobTitle: 'Backend developer',
      department: 'Engineering',
      experienceLevel: 'senior',
      accessRole: 'employee'
    },
    {
      displayName: 'Imported Two',
      email: 'two@import.test',
      employeeCode: 'IMP-002',
      jobTitle: 'HR manager',
      department: 'People',
      experienceLevel: 'senior',
      accessRole: 'hr-manager'
    }
  ];

  const batchResult = await accountAuth.batchProvisionEmployees(rosterList, tenantId, ownerSession.profile.sub);
  assert.equal(batchResult.results.length, 2);
  assert.ok(batchResult.results[0].temporaryPassword);
  assert.ok(batchResult.results[1].temporaryPassword);

  // First login password change check for batch provisioned user
  const userLogin = await accountAuth.login({
    email: 'one@import.test',
    password: batchResult.results[0].temporaryPassword
  });
  assert.equal(userLogin.must_change_password, true);
});
