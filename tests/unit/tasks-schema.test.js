import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTaskStatuses,
  TASK_STATUSES,
  validateEmployees,
  validateTasksDocument
} from '../../shared/schemas/tasks.js';

const employees = [
  { Employee_ID: 'EMP-001', Employee_Name: 'Alice Smith', Role: 'Engineer', Department: 'Engineering' },
  { Employee_ID: 'EMP-002', Employee_Name: 'Bob Jones', Role: 'Writer', Department: 'Product' }
];
const milestone = {
  PROJECT_ID: 'PROJ-1',
  MILESTONE_START: '2026-10-01',
  MILESTONE_END: '2026-10-31'
};
const makeTask = (id, assignedTo = 'EMP-001', dependencies = []) => ({
  task_id: id,
  project_id: 'PROJ-1',
  task_name: `Task ${id}`,
  description: 'A valid task description',
  assigned_to: assignedTo,
  dependencies,
  priority: 'medium',
  status: 'not-started',
  start_date: '2026-10-05',
  end_date: '2026-10-08',
  estimated_hours: 8
});

test('validates employee structure and unique identifiers', () => {
  assert.deepEqual(validateEmployees(employees), []);
  assert.match(validateEmployees([{ ...employees[0] }, { ...employees[0] }]).join('; '), /must be unique/);
  assert.match(validateEmployees({}).join('; '), /non-empty array/);
});

test('accepts a valid task document within the milestone window', () => {
  const document = { tasks: [makeTask('T1'), makeTask('T2', 'EMP-002', ['T1']), makeTask('T3')] };
  assert.deepEqual(validateTasksDocument(document, {
    employees,
    milestone,
    enforceTaskCount: true
  }), []);
});

test('supports the workflow statuses and normalizes legacy pending values without mutating input', () => {
  for (const status of TASK_STATUSES) {
    const errors = validateTasksDocument({ tasks: [makeTask('T1', 'EMP-001', [])].map(task => ({ ...task, status })) });
    assert.deepEqual(errors, [], `status ${status} should be valid`);
  }

  const legacyDocument = { tasks: [{ ...makeTask('T1'), status: 'pending' }] };
  const normalized = normalizeTaskStatuses(legacyDocument);
  assert.equal(normalized.tasks[0].status, 'not-started');
  assert.equal(legacyDocument.tasks[0].status, 'pending');
  assert.deepEqual(validateTasksDocument(normalized), []);
  assert.match(validateTasksDocument({ tasks: [{ ...makeTask('T1'), status: 'unknown' }] }).join('; '), /status: must be one of/);
});

test('rejects invalid assignments, dates, dependencies, cycles, and generation counts', () => {
  const tasks = [
    { ...makeTask('T1', 'UNKNOWN', ['T2']), start_date: '2026-09-30' },
    { ...makeTask('T2', 'EMP-001', ['T1']), end_date: '2026-11-01' }
  ];
  const errors = validateTasksDocument({ tasks }, {
    employees,
    milestone,
    enforceTaskCount: true
  });
  assert.ok(errors.some(error => error.includes('between 3 and 8')));
  assert.ok(errors.some(error => error.includes('available employee')));
  assert.ok(errors.some(error => error.includes('milestone start')));
  assert.ok(errors.some(error => error.includes('milestone end')));
  assert.ok(errors.some(error => error.includes('cycles')));
});
