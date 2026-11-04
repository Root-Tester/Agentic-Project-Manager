import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const doctorPath = path.join(projectRoot, 'scripts', 'doctor.js');

function runDoctor(values) {
  return spawnSync(process.execPath, [doctorPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...values }
  });
}

test('doctor reports missing JWT configuration without printing secret values', () => {
  const secret = 'placeholder-secret-that-must-never-be-printed';
  const result = runDoctor({ APM_JWT_SECRET: secret });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /APM_JWT_SECRET: configured/);
  assert.match(output, /APM_DATABASE_PATH: default/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test('doctor accepts SQLite and JWT config without identity-provider settings', () => {
  const result = runDoctor({
    APM_JWT_SECRET: 'valid-test-jwt-secret-with-more-than-32-bytes',
    APM_DATABASE_PATH: '.data/test.sqlite'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Backend configuration: ready/);
  assert.match(result.stdout, /Account sign-in: email\/password with signed JWT sessions/);
  assert.match(result.stdout, /Database: local SQLite/);
});
