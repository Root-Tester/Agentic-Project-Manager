import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteDatabase } from '../../backend/src/storage/sqlite/database.js';

test('upgrades a version-one database without losing users or tenant records', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apm-schema-v1-'));
  const filePath = path.join(directory, 'legacy.sqlite');
  let storage;
  t.after(async () => {
    storage?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(filePath);
  legacy.exec(`
    CREATE TABLE users (
      subject TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE workspaces (
      tenant_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      milestone_json TEXT,
      employees_json TEXT,
      tasks_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, workspace_id)
    );
    INSERT INTO users VALUES ('existing-user', 'existing@company.test', 'Existing User', 'old-hash', 'active', '2026-01-01');
    INSERT INTO tenants VALUES ('existing-tenant', 'Existing Tenant', '2026-01-01');
    PRAGMA user_version = 1;
  `);
  legacy.close();

  storage = await openSqliteDatabase(filePath);
  assert.equal(storage.database.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(
    storage.database.prepare('SELECT email FROM users WHERE subject = ?').get('existing-user').email,
    'existing@company.test'
  );
  assert.equal(
    storage.database.prepare('SELECT must_change_password FROM users WHERE subject = ?').get('existing-user').must_change_password,
    0
  );
  assert.equal(
    storage.database.prepare('SELECT name FROM tenants WHERE id = ?').get('existing-tenant').name,
    'Existing Tenant'
  );
  assert.equal(
    storage.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'employees'").get().name,
    'employees'
  );
});
