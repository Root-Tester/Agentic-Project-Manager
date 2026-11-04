import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApiApp } from '../../backend/src/api/app.js';

function createTeamRepository() {
  const members = new Map([
    ['tenant-a:owner-a', {
      tenantId: 'tenant-a', subject: 'owner-a', role: 'owner', status: 'active',
      displayName: 'Owner Ada', email: 'ada@example.com'
    }],
    ['tenant-a:developer-b', {
      tenantId: 'tenant-a', subject: 'developer-b', role: 'editor', status: 'active',
      capabilityProfile: 'backend-developer',
      displayName: 'Dev Bob', email: 'bob@example.com'
    }],
    ['tenant-a:viewer-c', {
      tenantId: 'tenant-a', subject: 'viewer-c', role: 'viewer', status: 'active',
      displayName: 'Viewer Cam', email: 'cam@example.com'
    }],
    ['tenant-a:system-e', {
      tenantId: 'tenant-a', subject: 'system-e', role: 'editor', status: 'active',
      capabilityProfile: 'system-administrator',
      displayName: 'System Eli', email: 'eli@example.com'
    }],
    ['tenant-b:outsider-d', {
      tenantId: 'tenant-b', subject: 'outsider-d', role: 'owner', status: 'active'
    }]
  ]);
  const docs = {
    milestone: {
      PROJECT_ID: 'P1',
      MILESTONE_START: '2026-10-01'
    },
    employees: [{
      Employee_ID: 'EMP-01',
      Employee_Name: 'Engineer',
      Role: 'Engineer',
      Department: 'Engineering',
      experience_level: 'senior'
    }],
    tasks: {
      tasks: [
        { task_id: 'T1', project_id: 'P1', task_name: 'Task 1', description: 'First task', assigned_to: 'EMP-01', dependencies: [], priority: 'medium', status: 'completed', start_date: '2026-10-01', end_date: '2026-10-01', estimated_hours: 5 },
        { task_id: 'T2', project_id: 'P1', task_name: 'Task 2', description: 'Second task', assigned_to: 'EMP-01', dependencies: [], priority: 'high', status: 'blocked', start_date: '2026-10-01', end_date: '2026-10-01', estimated_hours: 3 },
        { task_id: 'T3', project_id: 'P1', task_name: 'Task 3', description: 'Third task', assigned_to: 'EMP-01', dependencies: [], priority: 'low', status: 'in-progress', start_date: '2026-10-01', end_date: '2099-01-01', estimated_hours: 2 }
      ]
    }
  };
  const conversations = new Map();
  const messages = [];
  const notifications = [];
  const audit = [];
  let nextId = 1;
  const makeId = () => String(nextId++).padStart(24, '0');
  const workspaceKey = (tenantId, workspaceId) => `${tenantId}:${workspaceId}`;

  return {
    members,
    messages,
    notifications,
    audit,
    async listTenantsForSubject(subject) {
      return [...members.values()]
        .filter(member => member.subject === subject)
        .map(member => ({ tenantId: member.tenantId, name: member.tenantId, role: member.role }));
    },
    async getMembership(tenantId, subject) {
      return members.get(`${tenantId}:${subject}`) || null;
    },
    async findAccountIdentityByEmail(email) {
      return email.toLowerCase() === 'new@example.com'
        ? {
          subject: 'new-user',
          email: 'new@example.com',
          displayName: 'New User',
          status: 'active'
        }
        : null;
    },
    async listMembers(tenantId) {
      return [...members.values()].filter(member =>
        member.tenantId === tenantId && member.status === 'active'
      );
    },
    async upsertMember(tenantId, member) {
      const saved = { ...member, tenantId, status: 'active' };
      members.set(`${tenantId}:${member.subject}`, saved);
      return saved;
    },
    async listWorkspaces(tenantId) {
      return tenantId === 'tenant-a' ? [{ workspaceId: 'ws-a', name: 'Workspace A' }] : [];
    },
    async listTaskDocuments(tenantId) {
      return tenantId === 'tenant-a'
        ? [
          { workspaceId: 'ws-a', tasks: docs.tasks.tasks },
          { workspaceId: 'ws-b', tasks: [] }
        ]
        : [];
    },
    async getOperationsSummary(tenantId) {
      return tenantId === 'tenant-a'
        ? { workspaces: 1, messages: messages.length, auditEvents: audit.length }
        : { workspaces: 0, messages: 0, auditEvents: 0 };
    },
    async getDocuments(tenantId, workspaceId) {
      if (workspaceKey(tenantId, workspaceId) === 'tenant-a:ws-a') {
        return structuredClone(docs);
      }
      if (workspaceKey(tenantId, workspaceId) === 'tenant-a:ws-b') {
        return { milestone: null, employees: [], tasks: { tasks: [] } };
      }
      return null;
    },
    async setDocument(tenantId, workspaceId, type, value) {
      if (workspaceKey(tenantId, workspaceId) !== 'tenant-a:ws-a') return false;
      docs[type] = value;
      return true;
    },
    async addAuditEvent(event) {
      audit.push({ ...event, _id: makeId(), createdAt: new Date().toISOString() });
    },
    async listAuditEvents(tenantId, { workspaceId, limit }) {
      return audit
        .filter(event => event.tenantId === tenantId && (!workspaceId || event.workspaceId === workspaceId))
        .slice(-limit)
        .reverse()
        .map(event => ({ ...event, id: event._id }));
    },
    async getOrCreateDirectConversation(tenantId, workspaceId, conversationId, participants) {
      const record = {
        tenantId, workspaceId, conversationId, participants, type: 'direct'
      };
      conversations.set(`${tenantId}:${workspaceId}:${conversationId}`, record);
      return record;
    },
    async listDirectConversations(tenantId, workspaceId, subject) {
      return [...conversations.values()].filter(item =>
        item.tenantId === tenantId && item.workspaceId === workspaceId &&
        item.participants.includes(subject)
      );
    },
    async getDirectConversationParticipants(tenantId, workspaceId, conversationId) {
      return conversations.get(`${tenantId}:${workspaceId}:${conversationId}`)?.participants || [];
    },
    async canAccessConversation(tenantId, workspaceId, conversationId, subject) {
      return conversationId === 'project' ||
        (conversations.get(`${tenantId}:${workspaceId}:${conversationId}`)?.participants.includes(subject) ?? false);
    },
    async listMessages(tenantId, workspaceId, conversationId, { limit }) {
      return messages.filter(item =>
        item.tenantId === tenantId && item.workspaceId === workspaceId &&
        item.conversationId === conversationId
      ).slice(-limit);
    },
    async listMessagesAfter(tenantId, workspaceId, conversationId, after) {
      return messages.filter(item =>
        item.tenantId === tenantId && item.workspaceId === workspaceId &&
        item.conversationId === conversationId && item.id > after
      );
    },
    async getMessage(tenantId, workspaceId, conversationId, messageId) {
      return messages.find(item =>
        item.id === messageId && item.tenantId === tenantId &&
        item.workspaceId === workspaceId && item.conversationId === conversationId
      ) || null;
    },
    async createMessage(message) {
      const saved = { ...message, id: makeId(), createdAt: new Date().toISOString() };
      messages.push(saved);
      return saved;
    },
    async createNotifications(items) {
      notifications.push(...items.map(item => ({
        ...item, id: makeId(), readAt: null, createdAt: new Date().toISOString()
      })));
    },
    async listNotifications(tenantId, subject) {
      return notifications.filter(item =>
        item.tenantId === tenantId && item.recipientSubject === subject
      );
    },
    async countUnreadNotifications(tenantId, subject) {
      return notifications.filter(item =>
        item.tenantId === tenantId && item.recipientSubject === subject && !item.readAt
      ).length;
    },
    async markNotificationRead(tenantId, subject, notificationId) {
      const notification = notifications.find(item =>
        item.tenantId === tenantId && item.recipientSubject === subject && item.id === notificationId
      );
      if (!notification) return false;
      notification.readAt = new Date().toISOString();
      return true;
    }
  };
}

function createApp(repository) {
  return createApiApp({
    config: {
      issuer: 'https://identity.example.com/',
      audience: 'apm-api',
      jwksUri: 'https://identity.example.com/jwks',
      corsOrigins: ['http://localhost:5173']
    },
    repository,
    verifyToken: async token => {
      const subject = {
        'owner-token': 'owner-a',
        'developer-token': 'developer-b',
        'viewer-token': 'viewer-c',
        'system-token': 'system-e',
        'outsider-token': 'outsider-d'
      }[token];
      if (!subject) throw new Error('Rejected token.');
      return { sub: subject, name: subject };
    }
  });
}

async function withServer(t, app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  ));
  await run(`http://127.0.0.1:${server.address().port}`);
}

function headers(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

test('tenant members receive least-privilege capabilities and protected profile management', async t => {
  const repository = createTeamRepository();
  await withServer(t, createApp(repository), async base => {
    const access = await fetch(`${base}/api/v1/tenants/tenant-a/access`, {
      headers: headers('developer-token')
    });
    assert.equal(access.status, 200);
    assert.equal((await access.json()).capabilities.includes('tasks:write'), true);

    const documents = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/documents`,
      { headers: headers('developer-token') }
    );
    assert.equal(documents.status, 200);
    assert.equal(Object.hasOwn((await documents.json()).documents, 'employees'), false);

    const forbiddenPeopleEdit = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/documents/employees`,
      {
        method: 'PUT',
        headers: headers('developer-token', true),
        body: JSON.stringify({ value: [] })
      }
    );
    assert.equal(forbiddenPeopleEdit.status, 403);

    const employeeRoster = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/documents/employees`,
      {
        method: 'PUT',
        headers: headers('owner-token', true),
        body: JSON.stringify({
          value: [
            {
              Employee_ID: 'EMP-01',
              Employee_Name: 'Engineer',
              Role: 'Engineer',
              Department: 'Engineering',
              employment_status: 'retired',
              experience_level: 'senior'
            },
            {
              Employee_ID: 'EMP-02',
              Employee_Name: 'New Engineer',
              Role: 'Backend developer',
              Department: 'Engineering',
              Email: 'new@example.com',
              Phone: '+1-555-0100',
              experience_level: 'fresher',
              employment_status: 'working',
              Manager: 'Owner Ada',
              Location: 'Remote',
              employment_type: 'Full-time',
              start_date: '2026-10-01'
            }
          ]
        })
      }
    );
    assert.equal(employeeRoster.status, 200);
    const savedRoster = await repository.getDocuments('tenant-a', 'ws-a');
    assert.equal(savedRoster.employees[0].employment_status, 'retired');
    assert.equal(savedRoster.employees[1].Phone, '+1-555-0100');

    const forbiddenMemberManagement = await fetch(
      `${base}/api/v1/tenants/tenant-a/members`,
      {
        method: 'POST',
        headers: headers('developer-token', true),
        body: JSON.stringify({
          subject: 'new-user',
          displayName: 'New User',
          role: 'admin'
        })
      }
    );
    assert.equal(forbiddenMemberManagement.status, 403);

    const created = await fetch(`${base}/api/v1/tenants/tenant-a/members`, {
      method: 'POST',
      headers: headers('owner-token', true),
      body: JSON.stringify({
        subject: 'new-user',
        displayName: 'New User',
        email: 'new@example.com',
        role: 'editor',
        capabilityProfile: 'cybersecurity',
        responsibility: 'Security analyst',
        department: 'Security'
      })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).member.capabilityProfile, 'cybersecurity');
    assert.equal(repository.audit.at(-1).eventType, 'member.created');

    const crossTenant = await fetch(`${base}/api/v1/tenants/tenant-a/members`, {
      headers: headers('outsider-token')
    });
    assert.equal(crossTenant.status, 404);

    const adminOnly = await fetch(`${base}/api/v1/tenants/tenant-a/operations/summary`, {
      headers: headers('developer-token')
    });
    assert.equal(adminOnly.status, 403);

    const operations = await fetch(`${base}/api/v1/tenants/tenant-a/operations/summary`, {
      headers: headers('system-token')
    });
    assert.equal(operations.status, 200);
    const operationsSummary = await operations.json();
    assert.equal(operationsSummary.service, 'available');
    assert.equal(operationsSummary.workspaces, 1);
    assert.equal(Object.hasOwn(operationsSummary, 'tenantMessages'), false);
  });
});

test('project discussions, direct messages, threads, notifications, audit, live stream, and KPIs are scoped', async t => {
  const repository = createTeamRepository();
  await withServer(t, createApp(repository), async base => {
    const messagesUrl = `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/discussions/project/messages`;
    const posted = await fetch(messagesUrl, {
      method: 'POST',
      headers: headers('owner-token', true),
      body: JSON.stringify({ content: 'Please review the API delivery.' })
    });
    assert.equal(posted.status, 201);
    const firstMessage = (await posted.json()).message;
    assert.equal(firstMessage.content, 'Please review the API delivery.');
    assert.equal(repository.notifications.some(item => item.recipientSubject === 'developer-b'), true);
    assert.equal(repository.audit.at(-1).eventType, 'message.created');
    assert.equal(Object.hasOwn(repository.audit.at(-1), 'content'), false);

    const reply = await fetch(messagesUrl, {
      method: 'POST',
      headers: headers('developer-token', true),
      body: JSON.stringify({
        content: 'I will review it.',
        parentMessageId: firstMessage.id
      })
    });
    assert.equal(reply.status, 201);
    assert.equal((await reply.json()).message.parentMessageId, firstMessage.id);

    const notificationResponse = await fetch(
      `${base}/api/v1/tenants/tenant-a/notifications`,
      { headers: headers('developer-token') }
    );
    assert.equal(notificationResponse.status, 200);
    const notificationData = await notificationResponse.json();
    assert.equal(notificationData.unreadCount, 1);
    const markedRead = await fetch(
      `${base}/api/v1/tenants/tenant-a/notifications/${notificationData.notifications[0].id}/read`,
      { method: 'PUT', headers: headers('developer-token') }
    );
    assert.equal(markedRead.status, 200);

    const dm = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/discussions/direct`,
      {
        method: 'POST',
        headers: headers('developer-token', true),
        body: JSON.stringify({ recipientSubject: 'owner-a' })
      }
    );
    assert.equal(dm.status, 201);
    const conversationId = (await dm.json()).conversationId;
    const privateMessages = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/discussions/${conversationId}/messages`,
      { headers: headers('viewer-token') }
    );
    assert.equal(privateMessages.status, 404);

    const auditResponse = await fetch(`${base}/api/v1/tenants/tenant-a/audit`, {
      headers: headers('owner-token')
    });
    assert.equal(auditResponse.status, 200);
    assert.ok((await auditResponse.json()).events.length >= 2);

    const kpis = await fetch(`${base}/api/v1/tenants/tenant-a/analytics/kpis`, {
      headers: headers('developer-token')
    });
    assert.equal(kpis.status, 200);
    const kpiData = await kpis.json();
    assert.equal(kpiData.tasks, 3);
    assert.equal(kpiData.completed, 1);
    assert.equal(kpiData.blocked, 1);
    assert.equal(kpiData.overdue, 1);
    assert.equal(kpiData.completionRate, 33);
    assert.equal(kpiData.workspaces, 2);

    const workspaceKpis = await fetch(
      `${base}/api/v1/tenants/tenant-a/analytics/kpis?workspaceId=ws-a`,
      { headers: headers('developer-token') }
    );
    assert.equal(workspaceKpis.status, 200);
    const workspaceData = await workspaceKpis.json();
    assert.equal(workspaceData.workspaceId, 'ws-a');
    assert.equal(workspaceData.workspaces, 1);
    assert.equal(workspaceData.tasks, 3);
    assert.equal(workspaceData.activeTeamCount, 1);
    assert.deepEqual(workspaceData.proficiencyCounts, { fresher: 0, 'mid-level': 0, senior: 1 });
    assert.equal(workspaceData.forecastWindow.start, '2026-10-01');
    assert.equal(workspaceData.forecastWindow.end, '2026-10-01');
    assert.equal(workspaceData.forecastWindow.capacityHoursPerDay, 10);

    const otherWorkspaceKpis = await fetch(
      `${base}/api/v1/tenants/tenant-a/analytics/kpis?workspaceId=ws-b`,
      { headers: headers('developer-token') }
    );
    assert.equal(otherWorkspaceKpis.status, 200);
    assert.equal((await otherWorkspaceKpis.json()).tasks, 0);

    const missingWorkspaceKpis = await fetch(
      `${base}/api/v1/tenants/tenant-a/analytics/kpis?workspaceId=ws-missing`,
      { headers: headers('developer-token') }
    );
    assert.equal(missingWorkspaceKpis.status, 404);
    const crossTenantKpis = await fetch(
      `${base}/api/v1/tenants/tenant-b/analytics/kpis?workspaceId=ws-a`,
      { headers: headers('outsider-token') }
    );
    assert.equal(crossTenantKpis.status, 404);

    const updatedTasks = structuredClone(await repository.getDocuments('tenant-a', 'ws-a'));
    updatedTasks.tasks.tasks[1].status = 'testing';
    const statusUpdate = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/documents/tasks`,
      {
        method: 'PUT',
        headers: headers('developer-token', true),
        body: JSON.stringify({ value: updatedTasks.tasks })
      }
    );
    assert.equal(statusUpdate.status, 200);
    assert.equal(repository.audit.some(event =>
      event.eventType === 'task.status.changed' &&
      event.targetId === 'T2' &&
      event.details.from === 'blocked' &&
      event.details.to === 'testing'
    ), true);

    const controller = new AbortController();
    const stream = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-a/discussions/project/stream?after=000000000000000000000000`,
      { headers: headers('owner-token'), signal: controller.signal }
    );
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    let received = '';
    while (!received.includes(firstMessage.id)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += new TextDecoder().decode(chunk.value);
    }
    assert.match(received, /event: message/);
    controller.abort();

    const crossWorkspace = await fetch(
      `${base}/api/v1/tenants/tenant-a/workspaces/ws-other/discussions/project/messages`,
      { headers: headers('owner-token') }
    );
    assert.equal(crossWorkspace.status, 404);
  });
});
