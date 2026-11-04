import assert from 'node:assert/strict';
import { once } from 'node:events';
import axios from 'axios';
import test from 'node:test';
import { createApiApp } from '../../backend/src/api/app.js';

const employees = [
  { Employee_ID: 'EMP-001', Employee_Name: 'Test User', Role: 'Engineer', Department: 'Engineering' }
];
const milestone = {
  PROJECT_ID: 'PROJ-1',
  MILESTONE_START: '2026-10-01',
  MILESTONE_END: '2026-10-31'
};

function createRepository() {
  const records = new Map([
    ['tenant-a:workspace-a', { milestone, employees, tasks: { tasks: [] } }]
  ]);
  return {
    records,
    async listTenantsForSubject(subject) {
      return subject === 'subject-a'
        ? [{ tenantId: 'tenant-a', name: 'Tenant A', role: 'owner' }]
        : [];
    },
    async getMembership(tenantId, subject) {
      return tenantId === 'tenant-a' && subject === 'subject-a'
        ? { tenantId, subject, role: 'owner', status: 'active' }
        : null;
    },
    async addAuditEvent() {},
    async listWorkspaces(tenantId) {
      return tenantId === 'tenant-a'
        ? [{ workspaceId: 'workspace-a', name: 'Workspace A' }]
        : [];
    },
    async createWorkspace(tenantId, workspaceId, name) {
      const key = `${tenantId}:${workspaceId}`;
      if (records.has(key)) return false;
      records.set(key, { name, milestone: null, employees: null, tasks: null });
      return true;
    },
    async getDocuments(tenantId, workspaceId) {
      return records.get(`${tenantId}:${workspaceId}`) || null;
    },
    async setDocument(tenantId, workspaceId, type, value) {
      const docs = records.get(`${tenantId}:${workspaceId}`);
      if (!docs) return false;
      docs[type] = value;
      return true;
    }
  };
}

async function withServer(t, app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await run(`http://127.0.0.1:${server.address().port}`);
}

function createApp(repository) {
  return createApiApp({
    config: {
      issuer: 'https://identity.example.com/',
      audience: 'apm-api',
      jwksUri: 'https://identity.example.com/jwks',
      corsOrigins: ['http://localhost:5173']
    },
    repository,
    verifyToken: async token => {
      if (token === 'token-a') return { sub: 'subject-a', email: 'user@example.com' };
      throw new Error('Rejected token.');
    }
  });
}

test('hosted API authenticates requests and scopes tenant access from verified membership', async t => {
  const repository = createRepository();
  await withServer(t, createApp(repository), async baseUrl => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/tenants`);
    assert.equal(unauthenticated.status, 401);

    const invalidToken = await fetch(`${baseUrl}/api/v1/tenants`, {
      headers: { Authorization: 'Bearer invalid' }
    });
    assert.equal(invalidToken.status, 401);

    const tenantList = await fetch(`${baseUrl}/api/v1/tenants`, {
      headers: { Authorization: 'Bearer token-a' }
    });
    assert.equal(tenantList.status, 200);
    assert.deepEqual((await tenantList.json()).tenants.map(tenant => tenant.tenantId), ['tenant-a']);

    const crossTenant = await fetch(`${baseUrl}/api/v1/tenants/tenant-b/workspaces`, {
      headers: { Authorization: 'Bearer token-a' }
    });
    assert.equal(crossTenant.status, 404);

    const documents = await fetch(`${baseUrl}/api/v1/tenants/tenant-a/workspaces/workspace-a/documents`, {
      headers: { Authorization: 'Bearer token-a' }
    });
    assert.equal(documents.status, 200);
    assert.equal((await documents.json()).documents.milestone.PROJECT_ID, 'PROJ-1');

    const forbiddenOrigin = await fetch(`${baseUrl}/api/v1/tenants`, {
      headers: {
        Authorization: 'Bearer token-a',
        Origin: 'https://attacker.example'
      }
    });
    assert.equal(forbiddenOrigin.status, 403);
  });
});

test('hosted API rejects untrusted provider credentials and writes within the authorized tenant', async t => {
  const repository = createRepository();
  await withServer(t, createApp(repository), async baseUrl => {
    const url = `${baseUrl}/api/v1/tenants/tenant-a/workspaces/workspace-a/documents/employees`;
    const invalid = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'Bearer token-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: [{ Employee_ID: 'bad' }] })
    });

    await t.test('hosted API lists only configured providers and dynamically fetches their models', async t => {
      const previousKey = process.env.OPENAI_API_KEY;
      const originalGet = axios.get;
      process.env.OPENAI_API_KEY = 'server-side-test-key';
      axios.get = async (url, config) => {
        assert.equal(url, 'https://api.openai.com/v1/models');
        assert.equal(config.headers.Authorization, 'Bearer server-side-test-key');
        return { data: { data: [{ id: 'gpt-5.1-mini', created: 1 }] } };
      };
      t.after(() => {
        axios.get = originalGet;
        if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
      });

      await withServer(t, createApp(createRepository()), async baseUrl => {
        const headers = { Authorization: 'Bearer token-a' };
        const providersResponse = await fetch(
          `${baseUrl}/api/v1/tenants/tenant-a/ai/providers`,
          { headers }
        );
        assert.equal(providersResponse.status, 200);
        assert.deepEqual((await providersResponse.json()).providers, [{ id: 'openai', name: 'OpenAI' }]);

        const modelsResponse = await fetch(
          `${baseUrl}/api/v1/tenants/tenant-a/ai/models?provider=openai`,
          { headers }
        );
        assert.equal(modelsResponse.status, 200);
        assert.deepEqual((await modelsResponse.json()).models, [
          { id: 'gpt-5.1-mini', name: 'gpt-5.1-mini' }
        ]);

        const crossTenant = await fetch(
          `${baseUrl}/api/v1/tenants/tenant-b/ai/models?provider=openai`,
          { headers }
        );
        assert.equal(crossTenant.status, 404);
      });
    });

    await t.test('hosted task generation uses backend provider keys and reports provider auth failures', async t => {
      const previousKey = process.env.OPENAI_API_KEY;
      const originalPost = axios.post;
      process.env.OPENAI_API_KEY = 'server-only-key';
      axios.post = async (url, body, config) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(config.headers.Authorization, 'Bearer server-only-key');
        const error = new Error('Rejected');
        error.response = { status: 401, data: { error: { message: 'Invalid API key' } } };
        throw error;
      };
      t.after(() => {
        axios.post = originalPost;
        if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
      });

      await withServer(t, createApp(createRepository()), async baseUrl => {
        const response = await fetch(
          `${baseUrl}/api/v1/tenants/tenant-a/workspaces/workspace-a/tasks/generate`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer token-a',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ provider: 'openai', model: 'gpt-current' })
          }
        );
        assert.equal(response.status, 502);
        const body = await response.json();
        assert.match(body.error, /API key was rejected/);
        assert.equal(body.error.includes('server-only-key'), false);
      });
    });
    assert.equal(invalid.status, 400);

    const valid = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'Bearer token-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: employees })
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(repository.records.get('tenant-a:workspace-a').employees, employees);

    const bodyTooLarge = await fetch(`${baseUrl}/api/v1/tenants`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-a',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024 + 1) })
    });
    assert.equal(bodyTooLarge.status, 413);
  });
});

test('hosted task writes normalize legacy status and continue to enforce viewer read-only access', async t => {
  const repository = createRepository();
  const taskDocument = {
    tasks: ['T1', 'T2', 'T3'].map(task_id => ({
      task_id,
      project_id: 'PROJ-1',
      task_name: `Task ${task_id}`,
      description: 'A valid task description',
      assigned_to: 'EMP-001',
      dependencies: [],
      priority: 'medium',
      status: 'pending',
      start_date: '2026-10-05',
      end_date: '2026-10-08',
      estimated_hours: 8
    }))
  };
  const headers = {
    Authorization: 'Bearer token-a',
    'Content-Type': 'application/json'
  };

  await withServer(t, createApp(repository), async baseUrl => {
    const url = `${baseUrl}/api/v1/tenants/tenant-a/workspaces/workspace-a/documents/tasks`;
    const migrated = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ value: taskDocument })
    });
    assert.equal(migrated.status, 200);
    assert.deepEqual(
      repository.records.get('tenant-a:workspace-a').tasks.tasks.map(task => task.status),
      taskDocument.tasks.map(() => 'not-started')
    );

    repository.getMembership = async () => ({
      tenantId: 'tenant-a',
      subject: 'subject-a',
      role: 'viewer',
      status: 'active'
    });
    const forbidden = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        value: {
          ...repository.records.get('tenant-a:workspace-a').tasks,
          tasks: repository.records.get('tenant-a:workspace-a').tasks.tasks.map(task => ({
            ...task,
            status: 'completed'
          }))
        }
      })
    });
    assert.equal(forbidden.status, 403);
  });
});
