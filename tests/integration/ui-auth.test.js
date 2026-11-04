import assert from 'node:assert/strict';
import axios from 'axios';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createUiServer } from '../../cli/src/web/server.js';

const employees = [
  { Employee_ID: 'EMP-001', Employee_Name: 'Alice Smith', Role: 'Engineer', Department: 'Engineering' }
];
const milestone = {
  PROJECT_ID: 'PROJ-1',
  MILESTONE_START: '2026-10-01',
  MILESTONE_END: '2026-10-31'
};
const makeTasks = () => ({
  tasks: ['T1', 'T2', 'T3'].map(task_id => ({
    task_id,
    project_id: 'PROJ-1',
    task_name: `Task ${task_id}`,
    description: 'A valid task description',
    assigned_to: 'EMP-001',
    dependencies: [],
    priority: 'medium',
    status: 'not-started',
    start_date: '2026-10-05',
    end_date: '2026-10-08',
    estimated_hours: 8
  }))
});

test('local UI requires authentication and validates generated and saved tasks', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-ui-'));
  await writeFile(path.join(cwd, 'employees.json'), JSON.stringify(employees));
  await writeFile(path.join(cwd, 'milestone.json'), JSON.stringify(milestone));

  const { server, token } = createUiServer(cwd, 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await rm(cwd, { recursive: true, force: true });
  });

  test('local UI authenticates provider model discovery and returns live model IDs', async t => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-models-'));
    const { server, token } = createUiServer(cwd, 0);
    const originalGet = axios.get;
    axios.get = async (url, config) => {
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(config.headers.Authorization, 'Bearer test-openai-key');
      return { data: { data: [{ id: 'gpt-5.1-mini', created: 1 }] } };
    };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      axios.get = originalGet;
      await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
      await rm(cwd, { recursive: true, force: true });
    });

    const url = `http://127.0.0.1:${server.address().port}/api/models`;
    const unauthenticated = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', apiKey: 'test-openai-key' })
    });
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ provider: 'openai', apiKey: 'test-openai-key' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).models, [{ id: 'gpt-5.1-mini', name: 'gpt-5.1-mini' }]);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = { Authorization: `Bearer ${token}` };

  const page = await fetch(baseUrl);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, new RegExp(`<meta name="apm-auth-token" content="${token}">`));
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.equal(page.headers.get('cache-control'), 'no-store');

  const appScript = await fetch(`${baseUrl}/app.js`);
  assert.equal(appScript.status, 200);
  assert.match(await appScript.text(), /function getCapacityForecast\(\)/);

  const unauthenticated = await fetch(`${baseUrl}/api/load-workspace`);
  assert.equal(unauthenticated.status, 401);

  const crossOrigin = await fetch(`${baseUrl}/api/load-workspace`, {
    headers: { ...authHeaders, Origin: 'https://attacker.example' }
  });
  assert.equal(crossOrigin.status, 403);

  const workspace = await fetch(`${baseUrl}/api/load-workspace`, { headers: authHeaders });
  assert.equal(workspace.status, 200);
  assert.deepEqual((await workspace.json()).employees, employees);

  const oversized = await fetch(`${baseUrl}/api/save`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: ' '.repeat(2 * 1024 * 1024 + 1)
  });
  assert.equal(oversized.status, 413);

  const invalidSave = await fetch(`${baseUrl}/api/save`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks: [{ task_id: 'T1' }] })
  });
  assert.equal(invalidSave.status, 400);
  await assert.rejects(readFile(path.join(cwd, 'tasks.json')));

  const validTasks = makeTasks();
  const validSave = await fetch(`${baseUrl}/api/save`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(validTasks)
  });
  assert.equal(validSave.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'tasks.json'), 'utf8')), validTasks);

  const legacyTasks = {
    tasks: validTasks.tasks.map(task => ({ ...task, status: 'pending' }))
  };
  await writeFile(path.join(cwd, 'tasks.json'), JSON.stringify(legacyTasks));
  const legacyRead = await fetch(`${baseUrl}/api/load-workspace`, { headers: authHeaders });
  assert.equal(legacyRead.status, 200);
  assert.deepEqual(
    (await legacyRead.json()).tasks.map(task => task.status),
    validTasks.tasks.map(() => 'not-started')
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(cwd, 'tasks.json'), 'utf8')).tasks.map(task => task.status),
    validTasks.tasks.map(() => 'pending')
  );

  const legacySave = await fetch(`${baseUrl}/api/save`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(legacyTasks)
  });
  assert.equal(legacySave.status, 200);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(cwd, 'tasks.json'), 'utf8')).tasks.map(task => task.status),
    validTasks.tasks.map(() => 'not-started')
  );

  const previousMock = process.env.MOCK_LLM_RESPONSE;
  process.env.MOCK_LLM_RESPONSE = JSON.stringify(makeTasks());
  try {
    const generated = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        milestone,
        employees,
        provider: 'gemini',
        apiKey: 'test-key'
      })
    });
    assert.equal(generated.status, 200);
    assert.equal((await generated.json()).tasks.length, 3);

    process.env.MOCK_LLM_RESPONSE = JSON.stringify({
      tasks: makeTasks().tasks.map(task => ({ ...task, assigned_to: 'UNKNOWN' }))
    });
    const invalidGeneration = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        milestone,
        employees,
        provider: 'gemini',
        apiKey: 'test-key'
      })
    });
    assert.equal(invalidGeneration.status, 502);
  } finally {
    if (previousMock === undefined) delete process.env.MOCK_LLM_RESPONSE;
    else process.env.MOCK_LLM_RESPONSE = previousMock;
  }
});
