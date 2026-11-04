import { createHash } from 'node:crypto';
import { Router } from 'express';
import { calculateCapacityForecast } from '../../../../shared/analytics/capacity-forecast.js';
import { RESPONSIBILITY_PROFILES } from '../../../../shared/access/capabilities.js';
import { hasCapability } from '../../../../shared/access/capabilities.js';
import { ApiError } from '../errors.js';
import { createTenantAccessMiddleware } from '../middleware/tenant-access.js';

const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const MEMBER_ROLES = new Set(['owner', 'admin', 'editor', 'viewer']);
const CONVERSATION_ID = /^dm-[a-f0-9]{64}$/;

function assertWorkspaceId(workspaceId) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) {
    throw new ApiError(400, 'Workspace ID must be 2-128 valid characters.');
  }
}

function toMemberView(member) {
  return {
    subject: member.subject,
    email: member.email || '',
    displayName: member.displayName || member.email || member.subject,
    role: member.role,
    capabilityProfile: member.capabilityProfile || '',
    responsibility: member.responsibility || '',
    department: member.department || ''
  };
}

function validateMemberInput(input, { allowOwner }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'Member profile must be an object.');
  }
  const { subject = '', email = '', displayName, role, capabilityProfile = '', responsibility = '', department = '' } = input;
  if (typeof subject !== 'string' || subject.length > 255) {
    throw new ApiError(400, 'Member subject must be at most 255 characters.');
  }
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 120) {
    throw new ApiError(400, 'Display name must contain 1-120 characters.');
  }
  if (typeof email !== 'string' || email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ApiError(400, 'Enter a valid account email address.');
  }
  if (!MEMBER_ROLES.has(role) || (!allowOwner && role === 'owner')) {
    throw new ApiError(400, 'Choose an allowed organization access role.');
  }
  if (typeof capabilityProfile !== 'string' ||
    (capabilityProfile && !Object.hasOwn(RESPONSIBILITY_PROFILES, capabilityProfile))) {
    throw new ApiError(400, 'Choose a supported responsibility profile or leave it blank.');
  }
  for (const [field, value] of [['responsibility', responsibility], ['department', department]]) {
    if (typeof value !== 'string' || value.length > 100) {
      throw new ApiError(400, `${field} must be at most 100 characters.`);
    }
  }
  return {
    subject: subject.trim(),
    email: email.trim(),
    displayName: displayName.trim(),
    role,
    capabilityProfile,
    responsibility: responsibility.trim(),
    department: department.trim()
  };
}

function conversationIdFor(subjectA, subjectB) {
  const pair = [subjectA, subjectB].sort();
  return `dm-${createHash('sha256').update(pair.join('\0')).digest('hex')}`;
}

async function assertWorkspace(repository, tenantId, workspaceId) {
  assertWorkspaceId(workspaceId);
  const documents = await repository.getDocuments(tenantId, workspaceId);
  if (documents === null) throw new ApiError(404, 'Workspace not found.');
  return documents;
}

async function assertConversation(repository, tenantId, workspaceId, conversationId, subject) {
  if (conversationId !== 'project' && !CONVERSATION_ID.test(conversationId)) {
    throw new ApiError(404, 'Discussion not found.');
  }
  if (!await repository.canAccessConversation(tenantId, workspaceId, conversationId, subject)) {
    throw new ApiError(404, 'Discussion not found.');
  }
}

export function createTeamRouter(repository) {
  const router = Router({ mergeParams: true });

  router.get(
    '/members',
    createTenantAccessMiddleware(repository, { capability: 'members:read' }),
    async (req, res) => {
      const members = await repository.listMembers(req.tenant.id);
      res.json({
        members: members.map(toMemberView),
        profiles: Object.entries(RESPONSIBILITY_PROFILES).map(([id, profile]) => ({
          id,
          label: profile.label
        }))
      });
    }
  );

  router.post(
    '/members',
    createTenantAccessMiddleware(repository, { admin: true }),
    async (req, res) => {
      const member = validateMemberInput(req.body, { allowOwner: req.tenant.role === 'owner' });
      const account = await repository.findAccountIdentityByEmail(member.email);
      if (!account || account.status !== 'active') {
        throw new ApiError(404, 'Register this account before adding it to the team.');
      }
      member.subject = account.subject;
      const existing = await repository.getMembership(req.tenant.id, member.subject);
      if (existing) throw new ApiError(409, 'This identity is already a tenant member.');
      const saved = await repository.upsertMember(req.tenant.id, member);
      await repository.addAuditEvent({
        tenantId: req.tenant.id,
        actorSubject: req.user.subject,
        actorName: req.user.name,
        eventType: 'member.created',
        targetId: member.subject,
        details: { role: member.role, capabilityProfile: member.capabilityProfile }
      });
      res.status(201).json({ member: toMemberView(saved) });
    }
  );

  router.put(
    '/members/:subject',
    createTenantAccessMiddleware(repository, { admin: true }),
    async (req, res) => {
      const input = { ...req.body, subject: req.params.subject };
      const member = validateMemberInput(input, { allowOwner: req.tenant.role === 'owner' });
      const existing = await repository.getMembership(req.tenant.id, member.subject);
      if (!existing) throw new ApiError(404, 'Member not found.');
      if (existing.role === 'owner' && member.role !== 'owner') {
        throw new ApiError(409, 'Owner access cannot be changed through member profile editing.');
      }
      if (member.subject === req.user.subject && existing.role !== member.role) {
        throw new ApiError(409, 'You cannot change your own organization access role.');
      }
      const saved = await repository.upsertMember(req.tenant.id, member);
      await repository.addAuditEvent({
        tenantId: req.tenant.id,
        actorSubject: req.user.subject,
        actorName: req.user.name,
        eventType: 'member.updated',
        targetId: member.subject,
        details: { role: member.role, capabilityProfile: member.capabilityProfile }
      });
      res.json({ member: toMemberView(saved) });
    }
  );

  router.get(
    '/workspaces/:workspaceId/discussions',
    createTenantAccessMiddleware(repository, { capability: 'discussions:read' }),
    async (req, res) => {
      const { workspaceId } = req.params;
      await assertWorkspace(repository, req.tenant.id, workspaceId);
      const [members, directConversations] = await Promise.all([
        repository.listMembers(req.tenant.id),
        repository.listDirectConversations(req.tenant.id, workspaceId, req.user.subject)
      ]);
      res.json({
        conversations: [
          { conversationId: 'project', type: 'project', title: 'Project discussion' },
          ...directConversations.map(conversation => {
            const otherSubject = conversation.participants.find(subject => subject !== req.user.subject);
            const other = members.find(member => member.subject === otherSubject);
            return {
              conversationId: conversation.conversationId,
              type: 'direct',
              title: other?.displayName || other?.email || otherSubject,
              participantSubject: otherSubject
            };
          })
        ],
        members: members
          .filter(member => hasCapability(member, 'direct-messages:read'))
          .map(toMemberView)
      });
    }
  );

  router.post(
    '/workspaces/:workspaceId/discussions/direct',
    createTenantAccessMiddleware(repository, { capability: 'direct-messages:write' }),
    async (req, res) => {
      const { workspaceId } = req.params;
      await assertWorkspace(repository, req.tenant.id, workspaceId);
      const recipientSubject = req.body?.recipientSubject;
      if (typeof recipientSubject !== 'string' || recipientSubject.length > 255 ||
        recipientSubject === req.user.subject) {
        throw new ApiError(400, 'Choose another active tenant member.');
      }
      const recipient = await repository.getMembership(req.tenant.id, recipientSubject);
      if (!recipient) throw new ApiError(404, 'Member not found.');
      if (!hasCapability(recipient, 'direct-messages:read')) {
        throw new ApiError(403, 'The selected member cannot access direct messages.');
      }
      const participants = [req.user.subject, recipientSubject].sort();
      const conversationId = conversationIdFor(...participants);
      await repository.getOrCreateDirectConversation(
        req.tenant.id,
        workspaceId,
        conversationId,
        participants
      );
      res.status(201).json({
        conversationId,
        type: 'direct',
        title: recipient.displayName || recipient.email || recipientSubject,
        participantSubject: recipientSubject
      });
    }
  );

  router.get(
    '/workspaces/:workspaceId/discussions/:conversationId/messages',
    createTenantAccessMiddleware(repository, { capability: 'discussions:read' }),
    async (req, res) => {
      const { workspaceId, conversationId } = req.params;
      await assertWorkspace(repository, req.tenant.id, workspaceId);
      await assertConversation(repository, req.tenant.id, workspaceId, conversationId, req.user.subject);
      if (conversationId !== 'project' &&
        !req.tenant.capabilities.includes('direct-messages:read') &&
        !req.tenant.capabilities.includes('*')) {
        throw new ApiError(403, 'Direct message access is not available.');
      }
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const before = req.query.before;
      if (before !== undefined && (typeof before !== 'string' || !/^[a-f0-9]{24}$/i.test(before))) {
        throw new ApiError(400, 'Message cursor is invalid.');
      }
      res.json({
        messages: await repository.listMessages(
          req.tenant.id,
          workspaceId,
          conversationId,
          { limit, before }
        )
      });
    }
  );

  router.post(
    '/workspaces/:workspaceId/discussions/:conversationId/messages',
    createTenantAccessMiddleware(repository, { capability: 'discussions:write' }),
    async (req, res) => {
      const { workspaceId, conversationId } = req.params;
      await assertWorkspace(repository, req.tenant.id, workspaceId);
      await assertConversation(repository, req.tenant.id, workspaceId, conversationId, req.user.subject);
      if (conversationId !== 'project' &&
        !req.tenant.capabilities.includes('direct-messages:write') &&
        !req.tenant.capabilities.includes('*')) {
        throw new ApiError(403, 'Direct message access is not available.');
      }
      const { content, parentMessageId = null } = req.body || {};
      if (typeof content !== 'string' || !content.trim() || content.length > 5000) {
        throw new ApiError(400, 'Message must contain 1-5000 characters.');
      }
      if (parentMessageId !== null) {
        const parent = typeof parentMessageId === 'string'
          ? await repository.getMessage(
            req.tenant.id,
            workspaceId,
            conversationId,
            parentMessageId
          )
          : null;
        if (!parent) throw new ApiError(400, 'Thread parent message was not found in this discussion.');
      }
      const message = await repository.createMessage({
        tenantId: req.tenant.id,
        workspaceId,
        conversationId,
        senderSubject: req.user.subject,
        senderName: req.user.name,
        content: content.trim(),
        parentMessageId
      });
      const allMembers = await repository.listMembers(req.tenant.id);
      const recipients = conversationId === 'project'
        ? allMembers
          .filter(member => member.subject !== req.user.subject &&
            hasCapability(member, 'discussions:read'))
          .map(member => member.subject)
        : (await repository.getDirectConversationParticipants(
          req.tenant.id,
          workspaceId,
          conversationId
        )).filter(subject => subject !== req.user.subject &&
          hasCapability(allMembers.find(member => member.subject === subject), 'direct-messages:read'));
      await repository.createNotifications(recipients.map(recipientSubject => ({
        tenantId: req.tenant.id,
        recipientSubject,
        type: 'message',
        workspaceId,
        conversationId,
        messageId: message.id,
        actorName: req.user.name,
        preview: message.content.slice(0, 180)
      })));
      await repository.addAuditEvent({
        tenantId: req.tenant.id,
        workspaceId,
        actorSubject: req.user.subject,
        actorName: req.user.name,
        eventType: 'message.created',
        targetId: message.id,
        details: { conversationType: conversationId === 'project' ? 'project' : 'direct', parentMessageId }
      });
      res.status(201).json({ message });
    }
  );

  router.get(
    '/workspaces/:workspaceId/discussions/:conversationId/stream',
    createTenantAccessMiddleware(repository, { capability: 'discussions:read' }),
    async (req, res, next) => {
      const { workspaceId, conversationId } = req.params;
      try {
        await assertWorkspace(repository, req.tenant.id, workspaceId);
        await assertConversation(repository, req.tenant.id, workspaceId, conversationId, req.user.subject);
        if (conversationId !== 'project' &&
          !req.tenant.capabilities.includes('direct-messages:read') &&
          !req.tenant.capabilities.includes('*')) {
          throw new ApiError(403, 'Direct message access is not available.');
        }
        let cursor = typeof req.query.after === 'string' ? req.query.after : '';
        if (cursor && !/^[a-f0-9]{24}$/i.test(cursor)) {
          throw new ApiError(400, 'Message cursor is invalid.');
        }
        res.status(200).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();
        res.write('retry: 3000\n\n');
        let closed = false;
        let timeout;
        res.on('close', () => {
          closed = true;
          clearTimeout(timeout);
        });

        const poll = async () => {
          if (closed) return;
          try {
            const messages = await repository.listMessagesAfter(
              req.tenant.id,
              workspaceId,
              conversationId,
              cursor,
              100
            );
            for (const message of messages) {
              res.write(`id: ${message.id}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
              cursor = message.id;
            }
            if (!messages.length) res.write(': keep-alive\n\n');
            if (!closed) timeout = setTimeout(poll, 2000);
          } catch {
            if (!closed) {
              res.write(`event: stream-error\ndata: ${JSON.stringify({ error: 'Could not read discussion updates.' })}\n\n`);
              res.end();
            }
          }
        };
        poll();
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        next(error);
      }
    }
  );

  router.get(
    '/notifications',
    createTenantAccessMiddleware(repository),
    async (req, res) => {
      const notifications = await repository.listNotifications(req.tenant.id, req.user.subject);
      res.json({
        notifications,
        unreadCount: await repository.countUnreadNotifications(req.tenant.id, req.user.subject)
      });
    }
  );

  router.put(
    '/notifications/:notificationId/read',
    createTenantAccessMiddleware(repository),
    async (req, res) => {
      const updated = await repository.markNotificationRead(
        req.tenant.id,
        req.user.subject,
        req.params.notificationId
      );
      if (!updated) throw new ApiError(404, 'Notification not found.');
      res.json({ success: true });
    }
  );

  router.get(
    '/audit',
    createTenantAccessMiddleware(repository, { capability: 'audit:read' }),
    async (req, res) => {
      const { workspaceId } = req.query;
      if (workspaceId !== undefined) await assertWorkspace(repository, req.tenant.id, workspaceId);
      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
      res.json({
        events: await repository.listAuditEvents(req.tenant.id, { workspaceId, limit })
      });
    }
  );

  router.get(
    '/analytics/kpis',
    createTenantAccessMiddleware(repository, { capability: 'kpi:read' }),
    async (req, res) => {
      const { workspaceId } = req.query;
      let workspaceTaskDocuments;
      let forecast;
      if (workspaceId === undefined) {
        workspaceTaskDocuments = await repository.listTaskDocuments(req.tenant.id);
      } else {
        if (typeof workspaceId !== 'string') {
          throw new ApiError(400, 'Workspace ID must be a single string value.');
        }
        const documents = await assertWorkspace(repository, req.tenant.id, workspaceId);
        const tasks = Array.isArray(documents.tasks?.tasks) ? documents.tasks.tasks : [];
        workspaceTaskDocuments = [{ workspaceId, tasks }];
        forecast = calculateCapacityForecast({
          tasks,
          employees: documents.employees,
          milestone: documents.milestone
        });
      }
      const totals = {
        workspaces: workspaceTaskDocuments.length,
        tasks: 0,
        completed: 0,
        blocked: 0,
        overdue: 0,
        estimatedHours: 0,
        byStatus: {},
        workload: {}
      };
      const today = new Date().toISOString().slice(0, 10);
      for (const workspace of workspaceTaskDocuments) {
        const tasks = workspace.tasks;
        if (!Array.isArray(tasks)) continue;
        for (const task of tasks) {
          if (!task || typeof task !== 'object') continue;
          totals.tasks++;
          totals.byStatus[task.status] = (totals.byStatus[task.status] || 0) + 1;
          if (task.status === 'completed') totals.completed++;
          if (task.status === 'blocked') totals.blocked++;
          if (task.status !== 'completed' && typeof task.end_date === 'string' && task.end_date < today) {
            totals.overdue++;
          }
          const hours = Number.isFinite(task.estimated_hours) ? task.estimated_hours : 0;
          totals.estimatedHours += hours;
          const assignee = typeof task.assigned_to === 'string' ? task.assigned_to : 'unassigned';
          totals.workload[assignee] ||= { tasks: 0, estimatedHours: 0 };
          totals.workload[assignee].tasks++;
          totals.workload[assignee].estimatedHours += hours;
        }
      }
      res.json({
        ...totals,
        completionRate: totals.tasks ? Math.round((totals.completed / totals.tasks) * 100) : 0,
        ...(forecast ? {
          workspaceId,
          activeTeamCount: forecast.activeTeamCount,
          proficiencyCounts: forecast.proficiencyCounts,
          forecastWindow: forecast.projectedStart && forecast.projectedEnd
            ? {
              start: forecast.projectedStart,
              end: forecast.projectedEnd,
              workingDays: forecast.workingDays,
              capacityHoursPerDay: forecast.capacityHoursPerDay,
              targetEnd: forecast.milestoneEnd,
              exceedsMilestone: forecast.exceedsMilestone
            }
            : null
        } : {})
      });
    }
  );

  router.get(
    '/operations/summary',
    createTenantAccessMiddleware(repository),
    async (req, res) => {
      const capabilities = req.tenant.capabilities;
      if (!capabilities.includes('*') &&
        !capabilities.includes('system:read') &&
        !capabilities.includes('database:read')) {
        throw new ApiError(403, 'System or database operations permission required.');
      }
      const summary = await repository.getOperationsSummary(req.tenant.id);
      res.json({
        service: 'available',
        observedAt: new Date().toISOString(),
        ...(capabilities.includes('*') || capabilities.includes('system:read')
          ? { workspaces: summary.workspaces }
          : {}),
        ...(capabilities.includes('*') || capabilities.includes('database:read')
          ? {
            tenantMessages: summary.messages,
            tenantAuditEvents: summary.auditEvents,
            storage: summary.storage
          }
          : {})
      });
    }
  );

  return router;
}
