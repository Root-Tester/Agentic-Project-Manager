import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadBackendConfig } from '../backend/src/config/env.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dotenvResult = dotenv.config({ path: path.join(projectRoot, '.env') });
if (dotenvResult.error && dotenvResult.error.code !== 'ENOENT') {
  throw dotenvResult.error;
}

let ready = false;
let configError = '';
try {
  const config = loadBackendConfig(process.env);
  ready = true;
  console.log('Backend configuration: ready');
  console.log(`  Database path: ${config.databasePath}`);
  console.log(`  Storage limit: ${config.storageLimitBytes} bytes`);
  console.log(`  Platform admin allowlist: ${config.platformAdminEmails.length ? `${config.platformAdminEmails.length} address(es)` : 'not configured (company creation disabled)'}`);
} catch (error) {
  configError = error.message;
  console.log('Backend configuration: not ready');
  console.log(`  APM_JWT_SECRET: ${process.env.APM_JWT_SECRET ? 'configured' : 'missing'}`);
  console.log(`  APM_DATABASE_PATH: ${process.env.APM_DATABASE_PATH?.trim() ? 'configured' : 'default'}`);
}

if (configError) {
  console.error(`Configuration error: ${configError}`);
  console.error('Create .env from .env.example and generate APM_JWT_SECRET with npm run generate:jwt-secret.');
  process.exitCode = 1;
}

if (ready) {
  console.log('Account sign-in: email/password with signed JWT sessions');
  console.log('Database: local SQLite; runtime database files are not versioned');
  if (!process.env.APM_PLATFORM_ADMIN_EMAILS?.trim()) {
    console.log('Platform administration: set APM_PLATFORM_ADMIN_EMAILS in .env to enable company setup.');
  }
}
