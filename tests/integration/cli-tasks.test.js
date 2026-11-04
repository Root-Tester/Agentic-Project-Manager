import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateTasksCommand } from '../../cli/src/commands/generate-tasks.js';

const employees = [
  { Employee_ID: 'EMP-001', Employee_Name: 'Alice Smith', Role: 'Engineer', Department: 'Engineering' }
];
const milestone = {
  PROJECT_ID: 'PROJ-1',
  MILESTONE_START: '2026-10-01',
  MILESTONE_END: '2026-10-31'
};
const validDocument = {
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
};

test('CLI validates LLM output before writing tasks.json', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-cli-tasks-'));
  const originalCwd = process.cwd();
  const originalMock = process.env.MOCK_LLM_RESPONSE;
  t.after(async () => {
    process.chdir(originalCwd);
    if (originalMock === undefined) delete process.env.MOCK_LLM_RESPONSE;
    else process.env.MOCK_LLM_RESPONSE = originalMock;
    await rm(cwd, { recursive: true, force: true });
  });

  await writeFile(path.join(cwd, 'milestone.json'), JSON.stringify(milestone));
  await writeFile(path.join(cwd, 'employees.json'), JSON.stringify(employees));
  process.chdir(cwd);

  process.env.MOCK_LLM_RESPONSE = JSON.stringify({
    tasks: validDocument.tasks.map(task => ({ ...task, assigned_to: 'UNKNOWN' }))
  });
  await assert.rejects(generateTasksCommand(), /failed validation/i);
  await assert.rejects(access(path.join(cwd, 'tasks.json')));

  process.env.MOCK_LLM_RESPONSE = JSON.stringify(validDocument);
  await generateTasksCommand();
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'tasks.json'), 'utf8')), validDocument);
});
