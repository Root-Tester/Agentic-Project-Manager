import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiApp } from '../../backend/src/api/app.js';

test('single-origin deployment serves the SPA with restrictive security headers', async t => {
  const staticDirectory = await mkdtemp(path.join(os.tmpdir(), 'apm-hosted-'));
  await writeFile(path.join(staticDirectory, 'index.html'), '<main>Hosted UI</main>');
  const server = createApiApp({
    config: {
      issuer: 'agentic-project-manager',
      audience: 'agentic-project-manager-web',
      corsOrigins: ['https://app.example.test']
    },
    repository: {},
    staticDirectory
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    await rm(staticDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hosted UI/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const spaRoute = await fetch(`${baseUrl}/projects`);
  assert.equal(spaRoute.status, 200);
  assert.match(await spaRoute.text(), /Hosted UI/);

  const apiNotFound = await fetch(`${baseUrl}/api/missing`);
  assert.equal(apiNotFound.status, 404);
  assert.doesNotMatch(await apiNotFound.text(), /Hosted UI/);

  const forbiddenOrigin = await fetch(baseUrl, {
    headers: { Origin: 'https://attacker.example.test' }
  });
  assert.equal(forbiddenOrigin.status, 403);
});
