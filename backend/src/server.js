import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackendConfig } from './config/env.js';
import { sanitizeStartupError } from './config/startup-errors.js';
import { createApiApp } from './api/app.js';
import { createAccountAuth } from './api/account-auth.js';
import { openSqliteDatabase } from './storage/sqlite/database.js';
import { WorkspaceRepository } from './storage/sqlite/workspace-repository.js';
import { createWorkspaceCache } from './storage/cache/workspace-cache.js';

export async function startServer({ env = process.env } = {}) {
  const config = loadBackendConfig(env);
  const storage = await openSqliteDatabase(config.databasePath);
  const repository = new WorkspaceRepository(storage.database, createWorkspaceCache(), {
    storageLimitBytes: config.storageLimitBytes
  });
  await repository.ensureDemoData();
  const accountAuth = createAccountAuth({
    repository,
    secret: config.jwtSecret,
    platformAdminEmails: config.platformAdminEmails
  });
  let app;
  let server;
  try {
    const staticDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../frontend/dist'
    );
    app = createApiApp({ config, repository, accountAuth, staticDirectory });
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(config.port, '0.0.0.0', () => resolve(instance));
      instance.once('error', reject);
    });
  } catch (error) {
    try {
      storage.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'API listener failed and the SQLite database could not be closed.'
      );
    }
    throw error;
  }
  const bindAddress = `0.0.0.0:${config.port}`;
  console.log(`Backend API listening on ${bindAddress}; health check: http://127.0.0.1:${config.port}/healthz`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    storage.close();
  };
  return { server, close };
}

const isEntrypoint = process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();
if (isEntrypoint) {
  try {
    const { close } = await startServer();
    process.once('SIGINT', () => close().then(() => process.exit(0)));
    process.once('SIGTERM', () => close().then(() => process.exit(0)));
  } catch (error) {
    console.error(`Backend startup failed: ${sanitizeStartupError(error)}`);
    process.exitCode = 1;
  }
}
