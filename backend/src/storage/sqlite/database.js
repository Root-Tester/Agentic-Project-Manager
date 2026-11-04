import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    subject TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    display_name TEXT NOT NULL DEFAULT '',
    capability_profile TEXT NOT NULL DEFAULT '',
    responsibility TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT,
    PRIMARY KEY (tenant_id, subject)
  );
  CREATE INDEX IF NOT EXISTS memberships_by_subject
    ON memberships(subject, status);
  CREATE TABLE IF NOT EXISTS workspaces (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    milestone_json TEXT,
    employees_json TEXT,
    tasks_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id)
  );
  CREATE INDEX IF NOT EXISTS workspaces_by_tenant_name
    ON workspaces(tenant_id, name);
  CREATE TABLE IF NOT EXISTS conversations (
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('project', 'direct')),
    participants_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, conversation_id),
    FOREIGN KEY (tenant_id, workspace_id)
      REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    sender_subject TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    parent_message_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, workspace_id)
      REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS messages_by_conversation
    ON messages(tenant_id, workspace_id, conversation_id, id);
  CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT,
    recipient_subject TEXT NOT NULL,
    type TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    actor_name TEXT NOT NULL,
    preview TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, workspace_id)
      REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS notifications_by_member
    ON notifications(tenant_id, recipient_subject, read_at, created_at);
  CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id TEXT,
    actor_subject TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    target_id TEXT,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, workspace_id)
      REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS audit_by_tenant_time
    ON audit_events(tenant_id, workspace_id, created_at);
  CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const SCHEMA_V2 = `
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
    CHECK (must_change_password IN (0, 1));
  CREATE TABLE company_profiles (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    company_type TEXT NOT NULL CHECK (company_type IN
      ('service-based', 'product-based', 'technology', 'non-technology')),
    legal_name TEXT NOT NULL,
    website TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(subject),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE employees (
    employee_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subject TEXT REFERENCES users(subject) ON DELETE SET NULL,
    employee_code TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    department TEXT NOT NULL,
    experience_level TEXT NOT NULL DEFAULT 'mid-level'
      CHECK (experience_level IN ('fresher', 'mid-level', 'senior')),
    employment_status TEXT NOT NULL DEFAULT 'pending-verification'
      CHECK (employment_status IN
        ('pending-verification', 'working', 'on-leave', 'retired', 'fired')),
    verification_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    access_role TEXT NOT NULL DEFAULT 'employee'
      CHECK (access_role IN ('employee', 'hr', 'hr-manager', 'manager', 'team-leader')),
    manager_subject TEXT REFERENCES users(subject) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES users(subject),
    verified_by TEXT REFERENCES users(subject) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, employee_code),
    UNIQUE (tenant_id, email),
    UNIQUE (tenant_id, subject)
  );
  CREATE INDEX employees_by_tenant_status
    ON employees(tenant_id, verification_status, employment_status);
  CREATE INDEX employees_by_manager
    ON employees(tenant_id, manager_subject);
  CREATE TABLE company_teams (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    leader_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
    workspace_id TEXT,
    created_by TEXT NOT NULL REFERENCES users(subject),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, team_id)
  );
  CREATE TABLE team_assignments (
    tenant_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    employee_id TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL REFERENCES users(subject),
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, team_id, employee_id),
    FOREIGN KEY (tenant_id, team_id)
      REFERENCES company_teams(tenant_id, team_id) ON DELETE CASCADE
  );
  CREATE INDEX team_assignments_by_employee
    ON team_assignments(tenant_id, employee_id);
`;

export async function openSqliteDatabase(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('APM_DATABASE_PATH must be a non-empty path.');
  }
  const resolvedPath = filePath === ':memory:' ? ':memory:' : path.resolve(filePath);
  if (resolvedPath !== ':memory:') {
    await mkdir(path.dirname(resolvedPath), { recursive: true });
  }
  const database = new DatabaseSync(resolvedPath);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (resolvedPath !== ':memory:') {
      database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    }
    let version = database.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) {
      throw new Error('SQLite database schema is newer than this application supports.');
    }
    if (version < SCHEMA_VERSION) {
      database.exec('BEGIN IMMEDIATE');
      try {
        if (version < 1) {
          database.exec(SCHEMA);
          database.exec('PRAGMA user_version = 1');
          version = 1;
        }
        if (version < 2) {
          database.exec(SCHEMA_V2);
          database.exec('PRAGMA user_version = 2');
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    if (resolvedPath !== ':memory:') await chmod(resolvedPath, 0o600);
    return { database, filePath: resolvedPath, close: () => database.close() };
  } catch (error) {
    database.close();
    throw error;
  }
}
