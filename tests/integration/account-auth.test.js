import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createAccountAuth } from '../../backend/src/api/account-auth.js';
import { createApiApp } from '../../backend/src/api/app.js';
import { openSqliteDatabase } from '../../backend/src/storage/sqlite/database.js';
import { WorkspaceRepository } from '../../backend/src/storage/sqlite/workspace-repository.js';
import { createWorkspaceCache } from '../../backend/src/storage/cache/workspace-cache.js';

const SECRET = 'a-test-signing-secret-that-is-long-enough-123456';
const ADMIN_EMAILS = ['platform@example.test'];

async function setupApp(t) {
  const storage = await openSqliteDatabase(':memory:');
  const repository = new WorkspaceRepository(storage.database, createWorkspaceCache());
  await repository.ensureDemoData();
  const accountAuth = createAccountAuth({
    repository,
    secret: SECRET,
    platformAdminEmails: ADMIN_EMAILS
  });
  const app = createApiApp({
    config: {
      issuer: 'agentic-project-manager',
      audience: 'agentic-project-manager-web',
      corsOrigins: ['http://127.0.0.1:3000'],
      platformAdminEmails: ADMIN_EMAILS
    },
    repository,
    accountAuth
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    storage.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function postJson(baseUrl, route, body, token, prefix = '/api/v1/auth') {
  return fetch(`${baseUrl}${prefix}/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

test('only allowlisted platform administrators register and create isolated companies', async t => {
  const baseUrl = await setupApp(t);
  const denied = await postJson(baseUrl, 'register', {
    email: 'individual@example.test',
    displayName: 'Individual User',
    password: 'a-long-password-for-tests-1'
  });
  assert.equal(denied.status, 403);

  const adminResponse = await postJson(baseUrl, 'register', {
    email: 'PLATFORM@example.test',
    displayName: 'Platform Admin',
    password: 'a-long-password-for-tests-1'
  });
  assert.equal(adminResponse.status, 201);
  assert.equal(adminResponse.headers.get('cache-control'), 'no-store');
  const adminSession = await adminResponse.json();
  assert.equal(adminSession.platform_admin, true);

  const noPersonalTenant = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${adminSession.access_token}` }
  });
  assert.equal((await noPersonalTenant.json()).tenants.length, 0);

  const created = await postJson(baseUrl, 'companies', {
    name: 'Acme Product Studio',
    companyType: 'product-based',
    website: 'https://acme.example.test',
    ownerName: 'Owner Ada',
    ownerEmail: 'owner@acme.example.test'
  }, adminSession.access_token, '/api/v1/platform');
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const companyResult = await created.json();
  assert.equal(companyResult.company.name, 'Acme Product Studio');
  assert.equal(typeof companyResult.ownerCredentials.temporaryPassword, 'string');

  const ownerLogin = await postJson(baseUrl, 'login', {
    email: companyResult.ownerCredentials.email,
    password: companyResult.ownerCredentials.temporaryPassword
  });
  assert.equal(ownerLogin.status, 200);
  const temporarySession = await ownerLogin.json();
  assert.equal(temporarySession.must_change_password, true);
  const blockedUntilPasswordChanged = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${temporarySession.access_token}` }
  });
  assert.equal(blockedUntilPasswordChanged.status, 403);

  const changed = await postJson(baseUrl, 'change-password', {
    password: 'a-new-private-password-for-owner'
  }, temporarySession.access_token);
  assert.equal(changed.status, 200);
  const ownerSession = await changed.json();
  assert.equal(ownerSession.must_change_password, false);
  const ownerTenants = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${ownerSession.access_token}` }
  });
  const tenant = (await ownerTenants.json()).tenants[0];
  assert.equal(tenant.name, 'Acme Product Studio');
  assert.equal(tenant.role, 'owner');
  const profile = await fetch(`${baseUrl}/api/v1/tenants/${tenant.tenantId}/company`, {
    headers: { Authorization: `Bearer ${ownerSession.access_token}` }
  });
  assert.equal((await profile.json()).company.companyType, 'product-based');
});

test('HR employee onboarding is pending until verification and team assignment', async t => {
  const baseUrl = await setupApp(t);
  const admin = await (await postJson(baseUrl, 'register', {
    email: ADMIN_EMAILS[0],
    displayName: 'Platform Admin',
    password: 'a-long-password-for-tests-1'
  })).json();
  const createdCompany = await (await postJson(baseUrl, 'companies', {
    name: 'Acme Services',
    companyType: 'service-based',
    ownerName: 'Owner Ada',
    ownerEmail: 'owner@acme.example.test'
  }, admin.access_token, '/api/v1/platform')).json();
  const ownerLogin = await (await postJson(baseUrl, 'login', {
    email: createdCompany.ownerCredentials.email,
    password: createdCompany.ownerCredentials.temporaryPassword
  })).json();
  const ownerSession = await (await postJson(baseUrl, 'change-password', {
    password: 'a-new-private-password-for-owner'
  }, ownerLogin.access_token)).json();
  const tenants = await (await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${ownerSession.access_token}` }
  })).json();
  const tenantId = tenants.tenants[0].tenantId;

  const submitted = await postJson(baseUrl, 'employees', {
    employeeCode: 'EMP-01',
    displayName: 'Dev Bob',
    email: 'bob@acme.example.test',
    jobTitle: 'Software developer',
    department: 'Engineering',
    experienceLevel: 'senior',
    accessRole: 'employee'
  }, ownerSession.access_token, `/api/v1/tenants/${tenantId}`);
  assert.equal(submitted.status, 201);
  const submission = await submitted.json();
  assert.ok(submission.temporaryPassword);
  assert.equal(submission.employee.verificationStatus, 'pending');

  const teamResponse = await postJson(baseUrl, 'teams', {
    teamId: 'platform-team',
    name: 'Platform Team',
    workspaceId: 'main'
  }, ownerSession.access_token, `/api/v1/tenants/${tenantId}`);
  assert.equal(teamResponse.status, 201);

  const employeeLogin = await postJson(baseUrl, 'login', {
    email: submission.employee.email,
    password: submission.temporaryPassword
  });
  const employeeTemporarySession = await employeeLogin.json();
  assert.equal(employeeTemporarySession.must_change_password, true);
  const employeeSession = await (await postJson(baseUrl, 'change-password', {
    password: 'a-new-private-password-for-employee'
  }, employeeTemporarySession.access_token)).json();
  const pendingAccess = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${employeeSession.access_token}` }
  });
  assert.equal((await pendingAccess.json()).tenants.length, 0);

  const verified = await postJson(
    baseUrl,
    `employees/${submission.employee.employeeId}/verify`,
    { teamId: 'platform-team' },
    ownerSession.access_token,
    `/api/v1/tenants/${tenantId}`
  );
  assert.equal(verified.status, 200);
  const employeeAccess = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${employeeSession.access_token}` }
  });
  assert.equal((await employeeAccess.json()).tenants[0].tenantId, tenantId);
  const directory = await fetch(`${baseUrl}/api/v1/tenants/${tenantId}/employees`, {
    headers: { Authorization: `Bearer ${ownerSession.access_token}` }
  });
  const employee = (await directory.json()).employees[0];
  assert.equal(employee.verificationStatus, 'verified');
  assert.equal(employee.teams[0].teamId, 'platform-team');

  const fired = await fetch(
    `${baseUrl}/api/v1/tenants/${tenantId}/employees/${employee.employeeId}/status`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ownerSession.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ employmentStatus: 'fired' })
    }
  );
  assert.equal(fired.status, 200);
  const revokedEmployeeTenants = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${employeeSession.access_token}` }
  });
  assert.deepEqual((await revokedEmployeeTenants.json()).tenants, []);
  const invalidStatus = await fetch(
    `${baseUrl}/api/v1/tenants/${tenantId}/employees/${employee.employeeId}/status`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ownerSession.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ employmentStatus: 'dismissed' })
    }
  );
  assert.equal(invalidStatus.status, 400);

  const invalidCompany = await fetch(`${baseUrl}/api/v1/tenants/not-the-company/employees`, {
    headers: { Authorization: `Bearer ${ownerSession.access_token}` }
  });
  assert.equal(invalidCompany.status, 404);
});

test('read-only demo is synthetic, isolated, and cannot modify data', async t => {
  const baseUrl = await setupApp(t);
  const response = await postJson(baseUrl, 'demo', {});
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.profile.name, 'Guest Demo');
  const tenants = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const tenant = (await tenants.json()).tenants[0];
  assert.equal(tenant.tenantId, 'demo-company-readonly');
  const update = await fetch(
    `${baseUrl}/api/v1/tenants/${tenant.tenantId}/workspaces/demo-project/documents/tasks`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: { tasks: [] } })
    }
  );
  assert.equal(update.status, 403);
  const company = await fetch(`${baseUrl}/api/v1/tenants/${tenant.tenantId}/company`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  assert.equal((await company.json()).company.name, 'Demo Company');
});

test('auth routes are rate limited and security headers are applied', async t => {
  const baseUrl = await setupApp(t);
  const first = await postJson(baseUrl, 'register', {
    email: 'invalid',
    displayName: '',
    password: ''
  });
  assert.equal(first.status, 400);
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(first.headers.get('x-frame-options'), 'DENY');
  assert.match(first.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  for (let attempt = 1; attempt < 5; attempt++) {
    await postJson(baseUrl, 'register', {
      email: ADMIN_EMAILS[0],
      displayName: 'Invalid',
      password: ''
    });
  }
  const limited = await postJson(baseUrl, 'register', {
    email: ADMIN_EMAILS[0],
    displayName: 'Invalid',
    password: ''
  });
  assert.equal(limited.status, 429);
});
