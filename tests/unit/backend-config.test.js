import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBackendConfig } from '../../backend/src/config/env.js';
import { sanitizeStartupError } from '../../backend/src/config/startup-errors.js';

const SECRET = 'valid-test-jwt-secret-with-more-than-32-bytes';

test('backend config requires a strong JWT secret and defaults to local SQLite', () => {
  assert.throws(() => loadBackendConfig({}), /APM_JWT_SECRET/);
  assert.throws(() => loadBackendConfig({ APM_JWT_SECRET: 'too-short' }), /at least 32 bytes/);

  const config = loadBackendConfig({ APM_JWT_SECRET: SECRET });
  assert.equal(config.databasePath, '.data/agentic-project-manager.sqlite');
  assert.equal(config.storageLimitBytes, 524_288_000);
  assert.equal(config.port, 4000);
  assert.equal(config.issuer, 'agentic-project-manager');
  assert.deepEqual(config.platformAdminEmails, []);
  assert.deepEqual(config.corsOrigins, [
    'http://127.0.0.1:3000',
    'http://localhost:3000'
  ]);
});

test('backend config accepts explicit database path and validates ports, limits, and origins', () => {
  const config = loadBackendConfig({
    APM_JWT_SECRET: SECRET,
    APM_DATABASE_PATH: 'data/custom.sqlite',
    APM_STORAGE_LIMIT_BYTES: '1048576',
    API_PORT: '7860',
    CORS_ORIGINS: 'https://app.localtest',
    APM_PLATFORM_ADMIN_EMAILS: 'Admin@company.test, ops@company.test,admin@company.test'
  });
  assert.equal(config.databasePath, 'data/custom.sqlite');
  assert.equal(config.storageLimitBytes, 1_048_576);
  assert.equal(config.port, 7860);
  assert.deepEqual(config.corsOrigins, ['https://app.localtest']);
  assert.deepEqual(config.platformAdminEmails, ['admin@company.test', 'ops@company.test']);
  assert.throws(
    () => loadBackendConfig({ APM_JWT_SECRET: SECRET, API_PORT: '70000' }),
    /API_PORT/
  );
  assert.throws(
    () => loadBackendConfig({ APM_JWT_SECRET: SECRET, APM_STORAGE_LIMIT_BYTES: '1000' }),
    /APM_STORAGE_LIMIT_BYTES/
  );
  assert.throws(
    () => loadBackendConfig({ APM_JWT_SECRET: SECRET, CORS_ORIGINS: 'javascript:alert(1)' }),
    /HTTP or HTTPS/
  );
  assert.throws(
    () => loadBackendConfig({ APM_JWT_SECRET: SECRET, APM_PLATFORM_ADMIN_EMAILS: 'not-an-email' }),
    /APM_PLATFORM_ADMIN_EMAILS/
  );
});

test('backend startup diagnostics redact JWT and provider secrets', () => {
  const jwtSecret = SECRET;
  const apiKey = 'private-gemini-api-key';
  const message = sanitizeStartupError(
    new Error(`Unexpected config ${jwtSecret}; provider rejected ${apiKey}.`),
    { APM_JWT_SECRET: jwtSecret, GEMINI_API_KEY: apiKey }
  );
  assert.equal(message.includes(jwtSecret), false);
  assert.equal(message.includes(apiKey), false);
  assert.match(message, /Unexpected config/);
  assert.match(message, /\[redacted\]/);
});
