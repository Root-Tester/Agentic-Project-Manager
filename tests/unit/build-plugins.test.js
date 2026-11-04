import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, validateConfig } from '../../build/core/config.js';

test('build loads each assistant platform manifest as a unique plugin', async () => {
  const config = await loadConfig();
  assert.equal(config.targets.length, 6);
  assert.equal(new Set(config.targets.map(target => target.id)).size, config.targets.length);
  assert.equal(new Set(config.targets.map(target => target.bundleName)).size, config.targets.length);

  const duplicate = structuredClone(config);
  duplicate.targets.push({ ...duplicate.targets[0] });
  const errors = validateConfig(duplicate);
  assert.ok(errors.some(error => error.includes('duplicate target id')));
  assert.ok(errors.some(error => error.includes('duplicate bundle name')));
});
