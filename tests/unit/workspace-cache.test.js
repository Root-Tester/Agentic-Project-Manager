import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceCache } from '../../backend/src/storage/cache/workspace-cache.js';

test('workspace cache isolates tenants, clones values, expires and evicts old entries', async () => {
  const cache = createWorkspaceCache({ ttlMs: 20, maxEntries: 2 });
  const value = { tasks: [{ task_id: 'T1' }] };
  cache.set('tenant-a', 'workspace', 'tasks', value);
  value.tasks[0].task_id = 'MUTATED';
  const cached = cache.get('tenant-a', 'workspace', 'tasks');
  assert.equal(cached.tasks[0].task_id, 'T1');
  cached.tasks[0].task_id = 'ALSO-MUTATED';
  assert.equal(cache.get('tenant-a', 'workspace', 'tasks').tasks[0].task_id, 'T1');
  assert.equal(cache.get('tenant-b', 'workspace', 'tasks'), undefined);

  cache.set('tenant-a', 'workspace', 'employees', []);
  cache.set('tenant-a', 'workspace-2', 'tasks', { tasks: [] });
  assert.equal(cache.size, 2);
  assert.equal(cache.get('tenant-a', 'workspace', 'tasks'), undefined);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(cache.get('tenant-a', 'workspace-2', 'tasks'), undefined);
});
