import { randomUUID } from 'node:crypto';
import { normalizeTaskStatuses } from '../../../../shared/schemas/tasks.js';

const DOCUMENT_COLUMNS = new Map([
  ['milestone', 'milestone_json'],
  ['employees', 'employees_json'],
  ['tasks', 'tasks_json']
]);

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  return JSON.parse(value);
}

function sqliteId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function apiId(value) {
  return Number(value).toString(16).padStart(24, '0');
}

export class StorageLimitError extends Error {
  constructor(limitBytes) {
    super(`Storage limit reached (${limitBytes} bytes). Oldest eligible project and activity data was purged; no more eligible records can be removed.`);
    this.name = 'StorageLimitError';
    this.statusCode = 507;
  }
}

export class WorkspaceRepository {
  constructor(database, cache, { storageLimitBytes = Number.POSITIVE_INFINITY } = {}) {
    if (!(storageLimitBytes === Number.POSITIVE_INFINITY ||
      Number.isSafeInteger(storageLimitBytes) && storageLimitBytes >= 1_048_576)) {
      throw new Error('Storage limit must be at least 1048576 bytes.');
    }
    this.database = database;
    this.cache = cache;
    this.storageLimitBytes = storageLimitBytes;
    this.lastRetention = null;
  }

  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async getStorageUsage() {
    const pageCount = Number(this.database.prepare('PRAGMA page_count').get().page_count) || 0;
    const freePages = Number(this.database.prepare('PRAGMA freelist_count').get().freelist_count) || 0;
    const pageSize = Number(this.database.prepare('PRAGMA page_size').get().page_size) || 0;
    const logicalBytes = Math.max(0, pageCount - freePages) * pageSize;
    return {
      dataBytes: logicalBytes,
      indexBytes: 0,
      logicalBytes,
      limitBytes: this.storageLimitBytes,
      lastRetention: this.lastRetention
    };
  }

  async getRetentionCandidates() {
    const candidates = [
      ['message', this.database.prepare(
        'SELECT id, created_at AS createdAt FROM messages ORDER BY created_at, id LIMIT 1'
      ).get()],
      ['notification', this.database.prepare(
        'SELECT id, created_at AS createdAt FROM notifications ORDER BY created_at, id LIMIT 1'
      ).get()],
      ['auditEvent', this.database.prepare(
        'SELECT id, created_at AS createdAt FROM audit_events ORDER BY created_at, id LIMIT 1'
      ).get()],
      ['workspace', this.database.prepare(
        `SELECT tenant_id AS tenantId, workspace_id AS workspaceId,
          created_at AS createdAt, updated_at AS updatedAt
        FROM workspaces ORDER BY updated_at, created_at, tenant_id, workspace_id LIMIT 1`
      ).get()]
    ].filter(([, record]) => record)
      .map(([type, record]) => ({
        type,
        record,
        timestamp: type === 'workspace'
          ? record.updatedAt || record.createdAt
          : record.createdAt
      }));
    return candidates.sort((left, right) =>
      (Date.parse(left.timestamp) || 0) - (Date.parse(right.timestamp) || 0) ||
      String(left.record.id || left.record.workspaceId)
        .localeCompare(String(right.record.id || right.record.workspaceId))
    );
  }

  async purgeOldest(candidate) {
    return this.transaction(() => {
      const { type, record } = candidate;
      if (type === 'message') {
        return this.database.prepare('DELETE FROM messages WHERE id = ?').run(record.id).changes;
      }
      if (type === 'notification') {
        return this.database.prepare('DELETE FROM notifications WHERE id = ?').run(record.id).changes;
      }
      if (type === 'auditEvent') {
        return this.database.prepare('DELETE FROM audit_events WHERE id = ?').run(record.id).changes;
      }
      if (type === 'workspace') {
        const { tenantId, workspaceId } = record;
        const counts = ['messages', 'notifications', 'audit_events', 'conversations']
          .reduce((sum, table) => sum + this.database.prepare(
            `SELECT count(*) AS count FROM ${table} WHERE tenant_id = ? AND workspace_id = ?`
          ).get(tenantId, workspaceId).count, 0);
        const deleted = this.database.prepare(
          'DELETE FROM workspaces WHERE tenant_id = ? AND workspace_id = ?'
        ).run(tenantId, workspaceId).changes;
        if (deleted) this.cache.deleteWorkspace(tenantId, workspaceId);
        return counts + deleted;
      }
      throw new Error(`Unsupported retention record type: ${type}`);
    });
  }

  async ensureStorageCapacity(additionalBytes = 0) {
    if (this.storageLimitBytes === Number.POSITIVE_INFINITY) return;
    const reserveBytes = Math.max(1024, Math.ceil(additionalBytes * 1.25));
    let usage = await this.getStorageUsage();
    if (usage.logicalBytes + reserveBytes <= this.storageLimitBytes) return;

    let purgedRecords = 0;
    let attempts = 0;
    while (usage.logicalBytes + reserveBytes > this.storageLimitBytes) {
      const [oldest] = await this.getRetentionCandidates();
      if (!oldest) throw new StorageLimitError(this.storageLimitBytes);
      purgedRecords += await this.purgeOldest(oldest);
      attempts++;
      const nextUsage = await this.getStorageUsage();
      if (nextUsage.logicalBytes >= usage.logicalBytes && attempts >= 10) {
        throw new StorageLimitError(this.storageLimitBytes);
      }
      usage = nextUsage;
    }

    this.lastRetention = {
      purgedRecords,
      observedAt: new Date().toISOString(),
      logicalBytes: usage.logicalBytes,
      limitBytes: this.storageLimitBytes
    };
    this.database.prepare(
      `INSERT INTO system_state (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    ).run('storage-retention', JSON.stringify(this.lastRetention), this.lastRetention.observedAt);
  }

  async createAccount({ email, displayName, passwordHash }) {
    const subject = randomUUID();
    const tenantId = `tenant-${randomUUID()}`;
    const now = new Date().toISOString();
    const tenantName = `${displayName}'s Workspace`.slice(0, 120);
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify({ email, displayName, passwordHash })));
    this.transaction(() => {
      this.database.prepare(
        `INSERT INTO users (subject, email, display_name, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(subject, email, displayName, passwordHash, now);
      this.database.prepare(
        'INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)'
      ).run(tenantId, tenantName, now);
      this.database.prepare(
        `INSERT INTO memberships (tenant_id, subject, role, status, created_at)
         VALUES (?, ?, 'owner', 'active', ?)`
      ).run(tenantId, subject, now);
      this.database.prepare(
        `INSERT INTO workspaces
          (tenant_id, workspace_id, name, created_at, updated_at)
         VALUES (?, 'main', 'My Workspace', ?, ?)`
      ).run(tenantId, now, now);
    });
    return { subject, tenantId, email, displayName, createdAt: now };
  }

  async createPlatformAdminAccount({ email, displayName, passwordHash }) {
    const subject = randomUUID();
    const now = new Date().toISOString();
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify({ email, displayName, passwordHash })));
    this.database.prepare(
      `INSERT INTO users (subject, email, display_name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(subject, email, displayName, passwordHash, now);
    return { subject, email, displayName, status: 'active', mustChangePassword: false, createdAt: now };
  }

  async createCompany({
    name,
    companyType,
    website,
    ownerEmail,
    ownerName,
    ownerPasswordHash,
    actorSubject
  }) {
    const tenantId = `company-${randomUUID()}`;
    const ownerSubject = randomUUID();
    const workspaceId = 'main';
    const now = new Date().toISOString();
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify({
      name, companyType, website, ownerEmail, ownerName, ownerPasswordHash
    })));
    this.transaction(() => {
      this.database.prepare(
        `INSERT INTO users
          (subject, email, display_name, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      ).run(ownerSubject, ownerEmail, ownerName, ownerPasswordHash, now);
      this.database.prepare(
        'INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)'
      ).run(tenantId, name, now);
      this.database.prepare(
        `INSERT INTO company_profiles
          (tenant_id, company_type, legal_name, website, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(tenantId, companyType, name, website, actorSubject, now, now);
      this.database.prepare(
        `INSERT INTO memberships
          (tenant_id, subject, role, status, display_name, created_at, updated_at)
         VALUES (?, ?, 'owner', 'active', ?, ?, ?)`
      ).run(tenantId, ownerSubject, ownerName, now, now);
      this.database.prepare(
        `INSERT INTO workspaces
          (tenant_id, workspace_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(tenantId, workspaceId, 'Company workspace', now, now);
    });
    return {
      tenantId,
      name,
      companyType,
      website,
      workspaceId,
      owner: { subject: ownerSubject, email: ownerEmail, displayName: ownerName },
      createdAt: now
    };
  }

  async getCompany(tenantId) {
    return this.database.prepare(
      `SELECT tenant_id AS tenantId, company_type AS companyType,
        legal_name AS name, website, created_at AS createdAt,
        updated_at AS updatedAt
       FROM company_profiles WHERE tenant_id = ?`
    ).get(tenantId) || null;
  }

  async listCompanies() {
    return this.database.prepare(
      `SELECT c.tenant_id AS tenantId, c.legal_name AS name,
        c.company_type AS companyType, c.website, c.created_at AS createdAt,
        count(DISTINCT e.employee_id) AS employees
       FROM company_profiles c
       LEFT JOIN employees e ON e.tenant_id = c.tenant_id
       GROUP BY c.tenant_id
       ORDER BY c.created_at DESC, c.tenant_id`
    ).all();
  }

  async createEmployee({
    tenantId,
    actorSubject,
    email,
    displayName,
    employeeCode,
    jobTitle,
    department,
    experienceLevel,
    accessRole,
    passwordHash
  }) {
    const employeeId = randomUUID();
    const now = new Date().toISOString();
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify({
      email, displayName, employeeCode, jobTitle, department
    })));
    let subject;
    this.transaction(() => {
      const existing = this.database.prepare(
        'SELECT subject, status FROM users WHERE email = ? COLLATE NOCASE'
      ).get(email);
      if (existing && existing.status !== 'active') {
        throw new Error('The existing account is disabled and cannot be provisioned.');
      }
      subject = existing?.subject || randomUUID();
      if (!existing) {
        this.database.prepare(
          `INSERT INTO users
            (subject, email, display_name, password_hash, must_change_password, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        ).run(subject, email, displayName, passwordHash, now);
      }
      const membership = this.database.prepare(
        'SELECT status FROM memberships WHERE tenant_id = ? AND subject = ?'
      ).get(tenantId, subject);
      if (membership) throw new Error('This account already has company access.');
      this.database.prepare(
        `INSERT INTO employees
          (employee_id, tenant_id, subject, employee_code, email, display_name,
           job_title, department, experience_level, employment_status,
           verification_status, access_role, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-verification',
           'pending', ?, ?, ?, ?)`
      ).run(
        employeeId, tenantId, subject, employeeCode, email, displayName,
        jobTitle, department, experienceLevel, accessRole, actorSubject, now, now
      );
      this.database.prepare(
        `INSERT INTO memberships
          (tenant_id, subject, role, status, display_name, capability_profile,
           responsibility, department, created_at, updated_at)
         VALUES (?, ?, 'editor', 'inactive', ?, ?, ?, ?, ?, ?)`
      ).run(
        tenantId, subject, displayName, accessRole, jobTitle, department, now, now
      );
    });
    return {
      employeeId,
      subject,
      employeeCode,
      email,
      displayName,
      jobTitle,
      department,
      experienceLevel,
      accessRole,
      employmentStatus: 'pending-verification',
      verificationStatus: 'pending',
      hasLogin: true,
      createdAt: now
    };
  }

  async listEmployees(tenantId, { subject, accessRole } = {}) {
    const base = `
      SELECT e.employee_id AS employeeId, e.subject, e.employee_code AS employeeCode,
        e.email, e.display_name AS displayName, e.job_title AS jobTitle,
        e.department, e.experience_level AS experienceLevel,
        e.employment_status AS employmentStatus,
        e.verification_status AS verificationStatus, e.access_role AS accessRole,
        e.manager_subject AS managerSubject, e.verified_by AS verifiedBy,
        e.created_at AS createdAt, e.updated_at AS updatedAt
      FROM employees e
    `;
    const rows = accessRole === 'manager' || accessRole === 'team-leader'
      ? this.database.prepare(`${base}
          WHERE e.tenant_id = ? AND (
            e.subject = ? OR e.manager_subject = ? OR e.employee_id IN (
              SELECT teammate.employee_id FROM team_assignments teammate
              WHERE teammate.tenant_id = ? AND teammate.team_id IN (
                SELECT own.team_id FROM team_assignments own
                JOIN employees me ON me.employee_id = own.employee_id
                WHERE own.tenant_id = ? AND me.subject = ?
                UNION
                SELECT t.team_id FROM company_teams t
                JOIN employees leader ON leader.employee_id = t.leader_employee_id
                WHERE t.tenant_id = ? AND leader.subject = ?
              )
            )
          )
          ORDER BY e.display_name COLLATE NOCASE, e.employee_id`
        ).all(tenantId, subject, subject, tenantId, tenantId, subject, tenantId, subject)
      : this.database.prepare(`${base}
          WHERE e.tenant_id = ?
          ORDER BY e.created_at DESC, e.employee_id`
        ).all(tenantId);
    const teamRows = this.database.prepare(
      `SELECT a.employee_id AS employeeId, t.team_id AS teamId, t.name AS teamName
       FROM team_assignments a JOIN company_teams t
         ON t.tenant_id = a.tenant_id AND t.team_id = a.team_id
       WHERE a.tenant_id = ?`
    ).all(tenantId);
    const teamsByEmployee = new Map();
    for (const team of teamRows) {
      const values = teamsByEmployee.get(team.employeeId) || [];
      values.push({ teamId: team.teamId, name: team.teamName });
      teamsByEmployee.set(team.employeeId, values);
    }
    return rows.map(employee => ({
      ...employee,
      teams: teamsByEmployee.get(employee.employeeId) || []
    }));
  }

  async verifyEmployee(tenantId, employeeId, verifiedBy, teamId = '') {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const employee = this.database.prepare(
        `SELECT employee_id AS employeeId, subject, access_role AS accessRole,
          display_name AS displayName, job_title AS jobTitle, department,
          verification_status AS verificationStatus
         FROM employees WHERE tenant_id = ? AND employee_id = ?`
      ).get(tenantId, employeeId);
      if (!employee) return null;
      if (employee.verificationStatus !== 'pending') {
        throw new Error('Only pending employees can be verified.');
      }
      if (teamId && !this.database.prepare(
        'SELECT 1 FROM company_teams WHERE tenant_id = ? AND team_id = ?'
      ).get(tenantId, teamId)) {
        throw new Error('The selected team does not exist in this company.');
      }
      this.database.prepare(
        `UPDATE employees SET verification_status = 'verified',
          employment_status = 'working', verified_by = ?, updated_at = ?
         WHERE tenant_id = ? AND employee_id = ?`
      ).run(verifiedBy, now, tenantId, employeeId);
      this.database.prepare(
        `UPDATE memberships SET status = 'active', updated_at = ?
         WHERE tenant_id = ? AND subject = ?`
      ).run(now, tenantId, employee.subject);
      if (teamId) {
        this.database.prepare(
          `INSERT INTO team_assignments
            (tenant_id, team_id, employee_id, assigned_by, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(tenantId, teamId, employeeId, verifiedBy, now);
      }
      return { ...employee, verificationStatus: 'verified', employmentStatus: 'working' };
    });
  }

  async rejectEmployee(tenantId, employeeId, verifiedBy) {
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `UPDATE employees SET verification_status = 'rejected',
        verified_by = ?, updated_at = ?
       WHERE tenant_id = ? AND employee_id = ? AND verification_status = 'pending'`
    ).run(verifiedBy, now, tenantId, employeeId);
    if (!result.changes) return false;
    this.database.prepare(
      `UPDATE memberships SET status = 'inactive', updated_at = ?
       WHERE tenant_id = ? AND subject = (
         SELECT subject FROM employees WHERE tenant_id = ? AND employee_id = ?
       )`
    ).run(now, tenantId, tenantId, employeeId);
    return true;
  }

  async updateEmployeeStatus(tenantId, employeeId, employmentStatus) {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const employee = this.database.prepare(
        `SELECT subject, verification_status AS verificationStatus
         FROM employees WHERE tenant_id = ? AND employee_id = ?`
      ).get(tenantId, employeeId);
      if (!employee) return false;
      this.database.prepare(
        `UPDATE employees SET employment_status = ?, updated_at = ?
         WHERE tenant_id = ? AND employee_id = ?`
      ).run(employmentStatus, now, tenantId, employeeId);
      this.database.prepare(
        `UPDATE memberships SET status = ?, updated_at = ?
         WHERE tenant_id = ? AND subject = ?`
      ).run(
        employmentStatus === 'working' && employee.verificationStatus === 'verified'
          ? 'active'
          : 'inactive',
        now,
        tenantId,
        employee.subject
      );
      return true;
    });
  }

  async createTeam(tenantId, { teamId, name, description, leaderEmployeeId, workspaceId, actorSubject }) {
    const now = new Date().toISOString();
    if (workspaceId && !this.database.prepare(
      'SELECT 1 FROM workspaces WHERE tenant_id = ? AND workspace_id = ?'
    ).get(tenantId, workspaceId)) return null;
    if (leaderEmployeeId && !this.database.prepare(
      `SELECT 1 FROM employees WHERE tenant_id = ? AND employee_id = ?
       AND verification_status = 'verified' AND employment_status = 'working'`
    ).get(tenantId, leaderEmployeeId)) {
      throw new Error('Team leader must be a verified, currently working company employee.');
    }
    this.transaction(() => {
      this.database.prepare(
        `INSERT INTO company_teams
          (tenant_id, team_id, name, description, leader_employee_id,
           workspace_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        tenantId, teamId, name, description, leaderEmployeeId || null,
        workspaceId || null, actorSubject, now, now
      );
      if (leaderEmployeeId) {
        const leader = this.database.prepare(
          `SELECT subject FROM employees WHERE tenant_id = ? AND employee_id = ?`
        ).get(tenantId, leaderEmployeeId);
        if (leader?.subject) {
          this.database.prepare(
            `INSERT OR IGNORE INTO team_assignments
              (tenant_id, team_id, employee_id, assigned_by, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(tenantId, teamId, leaderEmployeeId, actorSubject, now);
          this.database.prepare(
            `UPDATE employees SET access_role = 'team-leader', updated_at = ?
             WHERE tenant_id = ? AND employee_id = ?`
          ).run(now, tenantId, leaderEmployeeId);
          this.database.prepare(
            `UPDATE memberships SET capability_profile = 'team-leader', updated_at = ?
             WHERE tenant_id = ? AND subject = ?`
          ).run(now, tenantId, leader.subject);
        }
      }
    });
    return { teamId, name, description, leaderEmployeeId: leaderEmployeeId || null, workspaceId: workspaceId || null };
  }

  async assignEmployeeToTeam(tenantId, teamId, employeeId, assignedBy) {
    const employee = this.database.prepare(
      `SELECT 1 FROM employees WHERE tenant_id = ? AND employee_id = ?
       AND verification_status = 'verified' AND employment_status = 'working'`
    ).get(tenantId, employeeId);
    if (!employee) return false;
    const now = new Date().toISOString();
    return this.database.prepare(
      `INSERT INTO team_assignments
        (tenant_id, team_id, employee_id, assigned_by, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM company_teams WHERE tenant_id = ? AND team_id = ?
       )
       ON CONFLICT(tenant_id, team_id, employee_id) DO NOTHING`
    ).run(tenantId, teamId, employeeId, assignedBy, now, tenantId, teamId).changes > 0;
  }

  async listTeams(tenantId) {
    const teams = this.database.prepare(
      `SELECT t.team_id AS teamId, t.name, t.description,
        t.leader_employee_id AS leaderEmployeeId,
        leader.subject AS leaderSubject, leader.display_name AS leaderName,
        t.workspace_id AS workspaceId,
        w.name AS workspaceName, t.created_at AS createdAt,
        count(a.employee_id) AS memberCount
       FROM company_teams t
       LEFT JOIN employees leader ON leader.employee_id = t.leader_employee_id
       LEFT JOIN workspaces w
         ON w.tenant_id = t.tenant_id AND w.workspace_id = t.workspace_id
       LEFT JOIN team_assignments a
         ON a.tenant_id = t.tenant_id AND a.team_id = t.team_id
       WHERE t.tenant_id = ?
       GROUP BY t.tenant_id, t.team_id
       ORDER BY t.name COLLATE NOCASE`
    ).all(tenantId);
    const members = this.database.prepare(
      `SELECT a.team_id AS teamId, e.subject
       FROM team_assignments a JOIN employees e ON e.employee_id = a.employee_id
       WHERE a.tenant_id = ? AND e.subject IS NOT NULL`
    ).all(tenantId);
    const subjectsByTeam = new Map();
    for (const member of members) {
      const subjects = subjectsByTeam.get(member.teamId) || [];
      subjects.push(member.subject);
      subjectsByTeam.set(member.teamId, subjects);
    }
    return teams.map(team => ({
      ...team,
      memberSubjects: subjectsByTeam.get(team.teamId) || []
    }));
  }

  async getOrganizationOverview(tenantId, { subject, accessRole } = {}) {
    const employees = await this.listEmployees(tenantId, { subject, accessRole });
    const allTeams = await this.listTeams(tenantId);
    const visibleTeamIds = accessRole === 'manager' || accessRole === 'team-leader'
      ? new Set(allTeams.filter(team =>
        team.leaderEmployeeId === employees.find(item => item.subject === subject)?.employeeId ||
        employees.some(employee => employee.teams.some(teamRef => teamRef.teamId === team.teamId))
      ).map(team => team.teamId))
      : null;
    const workspaces = this.database.prepare(
      `SELECT workspace_id AS workspaceId, name, tasks_json AS tasksJson
       FROM workspaces WHERE tenant_id = ? ORDER BY name COLLATE NOCASE`
    ).all(tenantId)
      .filter(workspace => !visibleTeamIds ||
        allTeams.some(team => team.workspaceId === workspace.workspaceId && visibleTeamIds.has(team.teamId)))
      .map(workspace => {
        const allTasks = parseJson(workspace.tasksJson, { tasks: [] })?.tasks || [];
        const employeeCodes = new Set(employees.map(employee => employee.employeeCode));
        const tasks = visibleTeamIds
          ? allTasks.filter(task => !task.assigned_to || employeeCodes.has(task.assigned_to))
          : allTasks;
        const byStatus = {};
        for (const task of tasks) byStatus[task.status] = (byStatus[task.status] || 0) + 1;
        const progressByEmployee = new Map();
        for (const task of tasks) {
          if (typeof task.assigned_to !== 'string') continue;
          const progress = progressByEmployee.get(task.assigned_to) || {
            tasks: 0, completed: 0, blocked: 0
          };
          progress.tasks++;
          if (task.status === 'completed') progress.completed++;
          if (task.status === 'blocked') progress.blocked++;
          progressByEmployee.set(task.assigned_to, progress);
        }
        return {
          workspaceId: workspace.workspaceId,
          name: workspace.name,
          taskCount: tasks.length,
          completed: byStatus.completed || 0,
          blocked: byStatus.blocked || 0,
          byStatus,
          employeeProgress: [...progressByEmployee].map(([employeeCode, progress]) => ({
            employeeCode,
            employeeName: employees.find(employee => employee.employeeCode === employeeCode)?.displayName || employeeCode,
            ...progress
          }))
        };
      });
    const teams = visibleTeamIds
      ? allTeams.filter(team => visibleTeamIds.has(team.teamId))
      : allTeams;
    return {
      employeeCount: employees.length,
      pendingVerification: employees.filter(employee => employee.verificationStatus === 'pending').length,
      employeesByDepartment: Object.fromEntries(
        employees.reduce((counts, employee) =>
          counts.set(employee.department, (counts.get(employee.department) || 0) + 1),
        new Map())
      ),
      teams,
      workspaces,
      employees
    };
  }

  async updateAccountPassword(subject, passwordHash) {
    return this.database.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE subject = ? AND status = ?'
    ).run(passwordHash, subject, 'active').changes > 0;
  }

  async getDemoAccount() {
    return this.getAccountBySubject('demo-guest-readonly');
  }

  async ensureDemoData() {
    const now = new Date().toISOString();
    const tenantId = 'demo-company-readonly';
    const workspaceId = 'demo-project';
    const userSubject = 'demo-guest-readonly';
    const employees = [
      {
        employeeId: 'demo-employee-001', employeeCode: 'DEMO-001',
        displayName: 'Alex Morgan', email: 'alex.morgan@demo.invalid',
        jobTitle: 'Product manager', department: 'Product',
        accessRole: 'manager', experienceLevel: 'senior'
      },
      {
        employeeId: 'demo-employee-002', employeeCode: 'DEMO-002',
        displayName: 'Sam Rivera', email: 'sam.rivera@demo.invalid',
        jobTitle: 'Frontend developer', department: 'Engineering',
        accessRole: 'team-leader', experienceLevel: 'mid-level'
      },
      {
        employeeId: 'demo-employee-003', employeeCode: 'DEMO-003',
        displayName: 'Jamie Chen', email: 'jamie.chen@demo.invalid',
        jobTitle: 'Data scientist', department: 'Data',
        accessRole: 'employee', experienceLevel: 'fresher'
      },
      {
        employeeId: 'demo-employee-004', employeeCode: 'DEMO-004',
        displayName: 'Taylor Brooks', email: 'taylor.brooks@demo.invalid',
        jobTitle: 'HR manager', department: 'People',
        accessRole: 'hr-manager', experienceLevel: 'senior'
      }
    ];
    const taskDocument = {
      tasks: [
        {
          task_id: 'DEMO-T1', project_id: 'DEMO-P1', task_name: 'Design onboarding flow',
          description: 'Create a clear new-customer onboarding experience.',
          assigned_to: 'DEMO-001', dependencies: [], priority: 'high',
          status: 'completed', start_date: '2026-10-01', end_date: '2026-10-05',
          estimated_hours: 16
        },
        {
          task_id: 'DEMO-T2', project_id: 'DEMO-P1', task_name: 'Implement project dashboard',
          description: 'Build the project summary and task status view.',
          assigned_to: 'DEMO-002', dependencies: ['DEMO-T1'], priority: 'high',
          status: 'in-progress', start_date: '2026-10-06', end_date: '2026-11-20',
          estimated_hours: 32
        },
        {
          task_id: 'DEMO-T3', project_id: 'DEMO-P1', task_name: 'Validate analytics events',
          description: 'Check the sample analytics and report findings.',
          assigned_to: 'DEMO-003', dependencies: ['DEMO-T2'], priority: 'medium',
          status: 'testing', start_date: '2026-11-02', end_date: '2026-11-30',
          estimated_hours: 20
        }
      ]
    };
    const roster = employees.map(employee => ({
      Employee_ID: employee.employeeCode,
      Employee_Name: employee.displayName,
      Role: employee.jobTitle,
      Department: employee.department,
      experience_level: employee.experienceLevel,
      employment_status: 'working',
      Email: employee.email
    }));
    this.transaction(() => {
      this.database.prepare(
        `INSERT OR IGNORE INTO users
          (subject, email, display_name, password_hash, created_at)
         VALUES (?, 'guest@demo.invalid', 'Guest Demo', 'demo-login-disabled', ?)`
      ).run(userSubject, now);
      this.database.prepare(
        `INSERT OR IGNORE INTO tenants (id, name, created_at)
         VALUES (?, 'Demo Company (read only)', ?)`
      ).run(tenantId, now);
      this.database.prepare(
        `INSERT OR IGNORE INTO company_profiles
          (tenant_id, company_type, legal_name, website, created_by, created_at, updated_at)
         VALUES (?, 'technology', 'Demo Company', '', ?, ?, ?)`
      ).run(tenantId, userSubject, now, now);
      this.database.prepare(
        `INSERT OR IGNORE INTO memberships
          (tenant_id, subject, role, status, display_name, capability_profile,
           created_at, updated_at)
         VALUES (?, ?, 'viewer', 'active', 'Guest Demo', 'demo-readonly', ?, ?)`
      ).run(tenantId, userSubject, now, now);
      this.database.prepare(
        `INSERT OR IGNORE INTO workspaces
          (tenant_id, workspace_id, name, milestone_json, employees_json,
           tasks_json, created_at, updated_at)
         VALUES (?, ?, 'Sample Product Launch', ?, ?, ?, ?, ?)`
      ).run(
        tenantId,
        workspaceId,
        JSON.stringify({
          PROJECT_ID: 'DEMO-P1',
          MILESTONE_START: '2026-10-01',
          MILESTONE_END: '2026-11-30',
          PROJECT_NAME: 'Sample Product Launch'
        }),
        JSON.stringify(roster),
        JSON.stringify(taskDocument),
        now,
        now
      );
      const addEmployee = this.database.prepare(
        `INSERT OR IGNORE INTO employees
          (employee_id, tenant_id, employee_code, email, display_name, job_title,
           department, experience_level, employment_status, verification_status,
           access_role, created_by, verified_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', 'verified', ?, ?, ?, ?, ?)`
      );
      for (const employee of employees) {
        addEmployee.run(
          employee.employeeId, tenantId, employee.employeeCode, employee.email,
          employee.displayName, employee.jobTitle, employee.department,
          employee.experienceLevel, employee.accessRole, userSubject, userSubject, now, now
        );
      }
      this.database.prepare(
        `INSERT OR IGNORE INTO company_teams
          (tenant_id, team_id, name, description, leader_employee_id,
           workspace_id, created_by, created_at, updated_at)
         VALUES (?, 'demo-engineering', 'Product Engineering', 'Synthetic sample team.',
           'demo-employee-002', ?, ?, ?, ?)`
      ).run(tenantId, workspaceId, userSubject, now, now);
      const assign = this.database.prepare(
        `INSERT OR IGNORE INTO team_assignments
          (tenant_id, team_id, employee_id, assigned_by, created_at)
         VALUES (?, 'demo-engineering', ?, ?, ?)`
      );
      for (const employee of employees.slice(1, 3)) {
        assign.run(tenantId, employee.employeeId, userSubject, now);
      }
    });
    return { tenantId, workspaceId, seeded: true };
  }

  async getAccountByEmail(email) {
    const account = this.database.prepare(
      `SELECT subject, email, display_name AS displayName,
        password_hash AS passwordHash, status,
        must_change_password AS mustChangePassword
       FROM users WHERE email = ? COLLATE NOCASE`
    ).get(email);
    return account || null;
  }

  async getAccountBySubject(subject) {
    return this.database.prepare(
      `SELECT subject, email, display_name AS displayName, status,
        must_change_password AS mustChangePassword
       FROM users WHERE subject = ?`
    ).get(subject) || null;
  }

  async findAccountIdentityByEmail(email) {
    return this.database.prepare(
      `SELECT subject, email, display_name AS displayName, status
       FROM users WHERE email = ? COLLATE NOCASE`
    ).get(email) || null;
  }

  async isAccountActive(subject) {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM users WHERE subject = ? AND status = 'active'"
    ).get(subject));
  }

  async listTenantsForSubject(subject) {
    return this.database.prepare(
      `SELECT t.id AS tenantId, t.name, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.subject = ? AND m.status = 'active'
       ORDER BY t.name COLLATE NOCASE`
    ).all(subject);
  }

  async getMembership(tenantId, subject) {
    const row = this.database.prepare(
      `SELECT tenant_id AS tenantId, subject, role, status,
        display_name AS displayName, capability_profile AS capabilityProfile,
        responsibility, department,
        created_at AS createdAt, updated_at AS updatedAt
       FROM memberships WHERE tenant_id = ? AND subject = ? AND status = 'active'`
    ).get(tenantId, subject);
    if (!row) return null;
    const account = await this.getAccountBySubject(subject);
    return {
      ...row,
      email: account?.email || '',
      displayName: row.displayName || account?.displayName || account?.email || subject
    };
  }

  async listMembers(tenantId) {
    return this.database.prepare(
      `SELECT m.subject, u.email, COALESCE(NULLIF(m.display_name, ''), u.display_name) AS displayName,
        m.role, m.capability_profile AS capabilityProfile, m.responsibility,
        m.department, m.created_at AS createdAt
       FROM memberships m JOIN users u ON u.subject = m.subject
       WHERE m.tenant_id = ? AND m.status = 'active'
       ORDER BY displayName COLLATE NOCASE, m.subject`
    ).all(tenantId);
  }

  async upsertMember(tenantId, member) {
    const account = await this.getAccountBySubject(member.subject);
    if (!account || account.status !== 'active') return null;
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify(member)));
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO memberships
        (tenant_id, subject, role, status, display_name, capability_profile,
         responsibility, department, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, subject) DO UPDATE SET role = excluded.role,
         status = 'active', capability_profile = excluded.capability_profile,
         display_name = excluded.display_name, responsibility = excluded.responsibility,
         department = excluded.department,
         updated_at = excluded.updated_at`
    ).run(
      tenantId,
      member.subject,
      member.role,
      member.displayName || account.displayName,
      member.capabilityProfile || '',
      member.responsibility || '',
      member.department || '',
      now,
      now
    );
    return this.getMembership(tenantId, member.subject);
  }

  async getStorage() {
    return this.getStorageUsage();
  }

  async getOrCreateDirectConversation(tenantId, workspaceId, conversationId, participants) {
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify(participants)));
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO conversations
        (tenant_id, workspace_id, conversation_id, type, participants_json, created_at)
       VALUES (?, ?, ?, 'direct', ?, ?)
       ON CONFLICT(tenant_id, workspace_id, conversation_id) DO NOTHING`
    ).run(tenantId, workspaceId, conversationId, JSON.stringify(participants), now);
    return {
      tenantId,
      workspaceId,
      conversationId,
      type: 'direct',
      participants,
      createdAt: now
    };
  }

  async listDirectConversations(tenantId, workspaceId, subject) {
    return this.database.prepare(
      `SELECT tenant_id AS tenantId, workspace_id AS workspaceId,
        conversation_id AS conversationId, type, participants_json AS participantsJson,
        created_at AS createdAt
       FROM conversations WHERE tenant_id = ? AND workspace_id = ? AND type = 'direct'
       ORDER BY created_at DESC`
    ).all(tenantId, workspaceId)
      .map(row => ({ ...row, participants: parseJson(row.participantsJson, []) }))
      .filter(conversation => conversation.participants.includes(subject));
  }

  async getDirectConversationParticipants(tenantId, workspaceId, conversationId) {
    const row = this.database.prepare(
      `SELECT participants_json FROM conversations
       WHERE tenant_id = ? AND workspace_id = ? AND conversation_id = ? AND type = 'direct'`
    ).get(tenantId, workspaceId, conversationId);
    return parseJson(row?.participants_json, []);
  }

  async canAccessConversation(tenantId, workspaceId, conversationId, subject) {
    if (conversationId === 'project') return true;
    return Boolean(this.database.prepare(
      `SELECT participants_json FROM conversations
       WHERE tenant_id = ? AND workspace_id = ? AND conversation_id = ? AND type = 'direct'`
    ).get(tenantId, workspaceId, conversationId) &&
      (await this.getDirectConversationParticipants(tenantId, workspaceId, conversationId)).includes(subject));
  }

  formatMessage(message) {
    return {
      id: apiId(message.id),
      conversationId: message.conversationId,
      senderSubject: message.senderSubject,
      senderName: message.senderName,
      content: message.content,
      parentMessageId: message.parentMessageId || null,
      createdAt: message.createdAt
    };
  }

  async listMessages(tenantId, workspaceId, conversationId, { limit = 50, before } = {}) {
    const beforeId = before ? sqliteId(before) : null;
    const rows = beforeId
      ? this.database.prepare(
        `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
          sender_name AS senderName, content, parent_message_id AS parentMessageId,
          created_at AS createdAt FROM messages
         WHERE tenant_id = ? AND workspace_id = ? AND conversation_id = ? AND id < ?
         ORDER BY id DESC LIMIT ?`
      ).all(tenantId, workspaceId, conversationId, beforeId, limit)
      : this.database.prepare(
        `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
          sender_name AS senderName, content, parent_message_id AS parentMessageId,
          created_at AS createdAt FROM messages
         WHERE tenant_id = ? AND workspace_id = ? AND conversation_id = ?
         ORDER BY id DESC LIMIT ?`
      ).all(tenantId, workspaceId, conversationId, limit);
    return rows.reverse().map(row => this.formatMessage(row));
  }

  async listMessagesAfter(tenantId, workspaceId, conversationId, after, limit = 100) {
    const afterId = after ? sqliteId(after) : null;
    const rows = afterId
      ? this.database.prepare(
        `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
          sender_name AS senderName, content, parent_message_id AS parentMessageId,
          created_at AS createdAt FROM messages
         WHERE tenant_id = ? AND workspace_id = ? AND conversation_id = ? AND id > ?
         ORDER BY id LIMIT ?`
      ).all(tenantId, workspaceId, conversationId, afterId, limit)
      : this.database.prepare(
        `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
          sender_name AS senderName, content, parent_message_id AS parentMessageId,
          created_at AS createdAt FROM messages
         WHERE tenant_id = ? AND workspace_id = ? AND conversation_id = ?
         ORDER BY id LIMIT ?`
      ).all(tenantId, workspaceId, conversationId, limit);
    return rows.map(row => this.formatMessage(row));
  }

  async getMessage(tenantId, workspaceId, conversationId, messageId) {
    const id = sqliteId(messageId);
    if (id === null) return null;
    const row = this.database.prepare(
      `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
        sender_name AS senderName, content, parent_message_id AS parentMessageId,
        created_at AS createdAt FROM messages
       WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND conversation_id = ?`
    ).get(id, tenantId, workspaceId, conversationId);
    return row ? this.formatMessage(row) : null;
  }

  async createMessage(message) {
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify(message)));
    const now = new Date().toISOString();
    const parentId = message.parentMessageId ? sqliteId(message.parentMessageId) : null;
    const result = this.database.prepare(
      `INSERT INTO messages
        (tenant_id, workspace_id, conversation_id, sender_subject, sender_name,
         content, parent_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      message.tenantId,
      message.workspaceId,
      message.conversationId,
      message.senderSubject,
      message.senderName,
      message.content,
      parentId === null ? null : apiId(parentId),
      now
    );
    return this.formatMessage({ ...message, id: result.lastInsertRowid, createdAt: now });
  }

  async createNotifications(notifications) {
    if (!notifications.length) return;
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify(notifications)));
    const insert = this.database.prepare(
      `INSERT INTO notifications
        (tenant_id, workspace_id, recipient_subject, type, conversation_id,
         message_id, actor_name, preview, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const notification of notifications) {
        insert.run(
          notification.tenantId,
          notification.workspaceId || null,
          notification.recipientSubject,
          notification.type,
          notification.conversationId || null,
          notification.messageId || null,
          notification.actorName,
          notification.preview,
          now
        );
      }
    });
  }

  async listNotifications(tenantId, subject, limit = 50) {
    return this.database.prepare(
      `SELECT id, type, workspace_id AS workspaceId,
        conversation_id AS conversationId, message_id AS messageId,
        actor_name AS actorName, preview, read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE tenant_id = ? AND recipient_subject = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`
    ).all(tenantId, subject, limit)
      .map(item => ({ ...item, id: apiId(item.id) }));
  }

  async countUnreadNotifications(tenantId, subject) {
    return this.database.prepare(
      `SELECT count(*) AS count FROM notifications
       WHERE tenant_id = ? AND recipient_subject = ? AND read_at IS NULL`
    ).get(tenantId, subject).count;
  }

  async markNotificationRead(tenantId, subject, notificationId) {
    await this.ensureStorageCapacity(256);
    const id = sqliteId(notificationId);
    if (id === null) return false;
    const result = this.database.prepare(
      `UPDATE notifications SET read_at = ?
       WHERE id = ? AND tenant_id = ? AND recipient_subject = ?`
    ).run(new Date().toISOString(), id, tenantId, subject);
    return result.changes > 0;
  }

  async addAuditEvent(event) {
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify(event)));
    this.database.prepare(
      `INSERT INTO audit_events
        (tenant_id, workspace_id, actor_subject, actor_name, event_type, target_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.tenantId,
      event.workspaceId || null,
      event.actorSubject,
      event.actorName,
      event.eventType,
      event.targetId || null,
      JSON.stringify(event.details || {}),
      new Date().toISOString()
    );
  }

  async listAuditEvents(tenantId, { workspaceId, limit = 100 } = {}) {
    const rows = workspaceId
      ? this.database.prepare(
        `SELECT id, workspace_id AS workspaceId, actor_subject AS actorSubject,
          actor_name AS actorName, event_type AS eventType, target_id AS targetId,
          details_json AS detailsJson, created_at AS createdAt FROM audit_events
         WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
      ).all(tenantId, workspaceId, limit)
      : this.database.prepare(
        `SELECT id, workspace_id AS workspaceId, actor_subject AS actorSubject,
          actor_name AS actorName, event_type AS eventType, target_id AS targetId,
          details_json AS detailsJson, created_at AS createdAt FROM audit_events
         WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
      ).all(tenantId, limit);
    return rows.map(item => ({
      id: apiId(item.id),
      workspaceId: item.workspaceId || null,
      actorSubject: item.actorSubject,
      actorName: item.actorName,
      eventType: item.eventType,
      targetId: item.targetId || null,
      details: parseJson(item.detailsJson, {}),
      createdAt: item.createdAt
    }));
  }

  async listWorkspaces(tenantId) {
    return this.database.prepare(
      `SELECT workspace_id AS workspaceId, name, created_at AS createdAt
       FROM workspaces WHERE tenant_id = ? ORDER BY name COLLATE NOCASE`
    ).all(tenantId);
  }

  async listTaskDocuments(tenantId) {
    return this.database.prepare(
      `SELECT workspace_id AS workspaceId, tasks_json AS tasksJson
       FROM workspaces WHERE tenant_id = ?`
    ).all(tenantId).map(workspace => ({
      workspaceId: workspace.workspaceId,
      tasks: normalizeTaskStatuses(parseJson(workspace.tasksJson, { tasks: [] })).tasks
    }));
  }

  async getOperationsSummary(tenantId) {
    const workspaces = this.database.prepare(
      'SELECT count(*) AS count FROM workspaces WHERE tenant_id = ?'
    ).get(tenantId).count;
    const messages = this.database.prepare(
      'SELECT count(*) AS count FROM messages WHERE tenant_id = ?'
    ).get(tenantId).count;
    const auditEvents = this.database.prepare(
      'SELECT count(*) AS count FROM audit_events WHERE tenant_id = ?'
    ).get(tenantId).count;
    return { workspaces, messages, auditEvents, storage: await this.getStorageUsage() };
  }

  async createWorkspace(tenantId, workspaceId, name) {
    await this.ensureStorageCapacity(Buffer.byteLength(JSON.stringify({ tenantId, workspaceId, name })));
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `INSERT INTO workspaces
        (tenant_id, workspace_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, workspace_id) DO NOTHING`
    ).run(tenantId, workspaceId, name, now, now);
    return result.changes > 0;
  }

  async getDocument(tenantId, workspaceId, type) {
    const column = DOCUMENT_COLUMNS.get(type);
    if (!column) throw new Error(`Unsupported document type: ${type}`);
    const cached = this.cache.get(tenantId, workspaceId, type);
    if (cached !== undefined) return type === 'tasks' ? normalizeTaskStatuses(cached) : cached;
    const row = this.database.prepare(
      `SELECT ${column} AS value FROM workspaces WHERE tenant_id = ? AND workspace_id = ?`
    ).get(tenantId, workspaceId);
    const value = parseJson(row?.value);
    if (value !== null) this.cache.set(tenantId, workspaceId, type, value);
    return type === 'tasks' ? normalizeTaskStatuses(value) : value;
  }

  async getDocuments(tenantId, workspaceId) {
    const row = this.database.prepare(
      `SELECT milestone_json AS milestone, employees_json AS employees, tasks_json AS tasks
       FROM workspaces WHERE tenant_id = ? AND workspace_id = ?`
    ).get(tenantId, workspaceId);
    if (!row) return null;
    const documents = {};
    for (const type of DOCUMENT_COLUMNS.keys()) {
      const cached = this.cache.get(tenantId, workspaceId, type);
      const value = cached !== undefined ? cached : parseJson(row[type]);
      documents[type] = type === 'tasks' ? normalizeTaskStatuses(value) : value;
      if (cached === undefined && value !== null) this.cache.set(tenantId, workspaceId, type, value);
    }
    return documents;
  }

  async setDocument(tenantId, workspaceId, type, value) {
    const column = DOCUMENT_COLUMNS.get(type);
    if (!column) throw new Error(`Unsupported document type: ${type}`);
    if (type === 'tasks') value = normalizeTaskStatuses(value);
    const serialized = JSON.stringify(value);
    await this.ensureStorageCapacity(Buffer.byteLength(serialized));
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `UPDATE workspaces SET ${column} = ?, updated_at = ?
       WHERE tenant_id = ? AND workspace_id = ?`
    ).run(serialized, now, tenantId, workspaceId);
    if (!result.changes) return false;
    this.cache.set(tenantId, workspaceId, type, value);
    return true;
  }
}
