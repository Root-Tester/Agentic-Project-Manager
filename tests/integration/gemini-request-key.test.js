import assert from 'node:assert/strict';
import { once } from 'node:events';
import axios from 'axios';
import test from 'node:test';
import { createApiApp } from '../../backend/src/api/app.js';

const employee = {
  Employee_ID: 'EMP-01',
  Employee_Name: 'Engineer',
  Role: 'Engineer',
  Department: 'Engineering'
};
const milestone = {
  PROJECT_ID: 'P1',
  MILESTONE_START: '2026-10-01',
  MILESTONE_END: '2026-10-31'
};

function createRepository() {
  const documents = {
    milestone,
    employees: [employee],
    tasks: { tasks: [] }
  };
  const auditEvents = [];
  return {
    documents,
    auditEvents,
    async getMembership(tenantId, subject) {
      return tenantId === 'tenant-a' && subject === 'subject-a'
        ? { tenantId, subject, role: 'owner', status: 'active' }
        : null;
    },
    async getDocuments(tenantId, workspaceId) {
      return tenantId === 'tenant-a' && workspaceId === 'workspace-a' ? documents : null;
    },
    async setDocument(tenantId, workspaceId, type, value) {
      if (tenantId !== 'tenant-a' || workspaceId !== 'workspace-a') return false;
      documents[type] = value;
      return true;
    },
    async addAuditEvent(event) {
      auditEvents.push(event);
    }
  };
}

function createApp(repository) {
  return createApiApp({
    config: {
      issuer: 'https://identity.test/',
      audience: 'apm-api',
      jwksUri: 'https://identity.test/jwks',
      corsOrigins: []
    },
    repository,
    verifyToken: async token => {
      if (token !== 'valid-token') throw new Error('Rejected token.');
      return { sub: 'subject-a', name: 'Test User' };
    }
  });
}

async function withServer(t, app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  await run(`http://127.0.0.1:${server.address().port}`);
}

test('authenticated Gemini key supports live models and generation without persistence', async t => {
  const repository = createRepository();
  const originalGet = axios.get;
  const originalPost = axios.post;
  const key = 'private-gemini-test-key';
  const generated = {
    tasks: ['T1', 'T2', 'T3'].map(task_id => ({
      task_id,
      project_id: 'P1',
      task_name: `Task ${task_id}`,
      description: 'A generated task',
      assigned_to: 'EMP-01',
      dependencies: [],
      priority: 'medium',
      status: 'not-started',
      start_date: '2026-10-05',
      end_date: '2026-10-06',
      estimated_hours: 2
    }))
  };
  axios.get = async (url, config) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(config.headers['x-goog-api-key'], key);
    return {
      data: {
        models: [{
          name: 'models/gemini-flash',
          baseModelId: 'gemini-flash',
          displayName: 'Gemini Flash',
          supportedGenerationMethods: ['generateContent']
        }]
      }
    };
  };
  axios.post = async (url, body, config) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent');
    assert.equal(config.headers['x-goog-api-key'], key);
    return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] } };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
  });

  await withServer(t, createApp(repository), async baseUrl => {
    const headers = {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json'
    };
    const modelsResponse = await fetch(
      `${baseUrl}/api/v1/tenants/tenant-a/ai/models?provider=gemini`,
      { method: 'POST', headers, body: JSON.stringify({ apiKey: key }) }
    );
    assert.equal(modelsResponse.status, 200);
    assert.deepEqual((await modelsResponse.json()).models, [
      { id: 'gemini-flash', name: 'Gemini Flash' }
    ]);

    const generatedResponse = await fetch(
      `${baseUrl}/api/v1/tenants/tenant-a/workspaces/workspace-a/tasks/generate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: 'gemini', model: 'gemini-flash', apiKey: key })
      }
    );
    assert.equal(generatedResponse.status, 200);
    assert.deepEqual((await generatedResponse.json()).tasks, generated.tasks);
    assert.equal(JSON.stringify(repository.documents).includes(key), false);
    assert.equal(JSON.stringify(repository.auditEvents).includes(key), false);
  });
});

test('Gemini request-scoped keys require tenant authentication and reject other providers', async t => {
  const repository = createRepository();
  const originalGet = axios.get;
  let providerCalls = 0;
  axios.get = async () => {
    providerCalls++;
    return { data: { models: [] } };
  };
  t.after(() => { axios.get = originalGet; });

  await withServer(t, createApp(repository), async baseUrl => {
    const url = `${baseUrl}/api/v1/tenants/tenant-a/ai/models?provider=gemini`;
    const unauthenticated = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'secret-key' })
    });
    assert.equal(unauthenticated.status, 401);

    const invalidProvider = await fetch(
      `${baseUrl}/api/v1/tenants/tenant-a/ai/models?provider=openai`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ apiKey: 'secret-key' })
      }
    );
    assert.equal(invalidProvider.status, 400);

    const malformedKey = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ apiKey: 'secret key with spaces' })
    });
    assert.equal(malformedKey.status, 400);
    assert.equal(providerCalls, 0);
  });
});
