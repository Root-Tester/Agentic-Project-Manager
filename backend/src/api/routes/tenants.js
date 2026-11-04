import { Router } from 'express';
import {
  getConfiguredProviders,
  listAvailableModels,
  listConfiguredModels
} from '../../../../shared/ai/index.js';
import {
  normalizeTaskStatuses,
  validateEmployees,
  validateTasksDocument
} from '../../../../shared/schemas/tasks.js';
import { ApiError } from '../errors.js';
import { createTenantAccessMiddleware } from '../middleware/tenant-access.js';
import { generateTasks } from '../../services/task-generation.js';
import { createTeamRouter } from './team.js';
import { createOrganizationRouter } from './organization.js';

const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const DOCUMENT_TYPES = new Set(['milestone', 'employees', 'tasks']);
const AI_PROVIDERS = new Set(['gemini', 'openai', 'anthropic']);

function assertProvider(provider) {
  if (typeof provider !== 'string' || !AI_PROVIDERS.has(provider)) {
    throw new ApiError(400, 'Choose a supported AI provider.');
  }
}

function getRequestApiKey(provider, body) {
  if (body?.apiKey === undefined) return '';
  if (provider !== 'gemini') {
    throw new ApiError(400, 'Only Gemini supports a request-scoped provider key.');
  }
  if (typeof body.apiKey !== 'string' || !body.apiKey.trim() ||
    body.apiKey.length > 1024 || /\s/.test(body.apiKey)) {
    throw new ApiError(400, 'Gemini API key must contain 1-1024 characters.');
  }
  return body.apiKey.trim();
}

async function sendModels(provider, apiKey, res) {
  try {
    const models = apiKey
      ? await listAvailableModels(provider, apiKey)
      : await listConfiguredModels(provider);
    res.json({ models });
  } catch (error) {
    if (error.statusCode) throw new ApiError(error.statusCode, error.message);
    throw new ApiError(503, error.message);
  }
}

function assertWorkspaceId(workspaceId) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) {
    throw new ApiError(400, 'Workspace ID must be 2-128 valid characters.');
  }
}

function validateDocument(type, value, { employees, milestone } = {}) {
  if (!DOCUMENT_TYPES.has(type)) throw new ApiError(404, 'Document type not found.');
  if (type === 'employees') {
    const errors = validateEmployees(value);
    if (errors.length) throw new ApiError(400, `Invalid employees document: ${errors.join('; ')}`);
  }
  if (type === 'tasks') {
    const errors = validateTasksDocument(value, { employees, milestone });
    if (errors.length) throw new ApiError(400, `Invalid tasks document: ${errors.join('; ')}`);
  }
}

export function createTenantRouter(repository, { accountAuth } = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ tenants: await repository.listTenantsForSubject(req.user.subject) });
  });

  const tenantRouter = Router({ mergeParams: true });
  tenantRouter.use(createOrganizationRouter(repository, accountAuth));
  tenantRouter.get(
    '/access',
    createTenantAccessMiddleware(repository),
    (req, res) => {
      res.json({
        role: req.tenant.role,
        capabilities: req.tenant.capabilities,
        capabilityProfile: req.tenant.membership.capabilityProfile || '',
        responsibility: req.tenant.membership.responsibility || '',
        department: req.tenant.membership.department || ''
      });
    }
  );

  tenantRouter.get(
    '/ai/providers',
    createTenantAccessMiddleware(repository),
    async (req, res) => {
      res.json({ providers: getConfiguredProviders() });
    }
  );

  tenantRouter.get(
    '/ai/models',
    createTenantAccessMiddleware(repository),
    async (req, res) => {
      const { provider } = req.query;
      assertProvider(provider);
      await sendModels(provider, '', res);
    }
  );

  tenantRouter.post(
    '/ai/models',
    createTenantAccessMiddleware(repository),
    async (req, res) => {
      const { provider } = req.query;
      assertProvider(provider);
      await sendModels(provider, getRequestApiKey(provider, req.body), res);
    }
  );

  tenantRouter.get(
    '/workspaces',
    createTenantAccessMiddleware(repository, { capability: 'workspace:read' }),
    async (req, res) => {
      res.json({ workspaces: await repository.listWorkspaces(req.tenant.id) });
    }
  );

  tenantRouter.post(
    '/workspaces',
    createTenantAccessMiddleware(repository, { admin: true }),
    async (req, res) => {
      const { workspaceId, name } = req.body || {};
      assertWorkspaceId(workspaceId);
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
        throw new ApiError(400, 'Workspace name must contain 1-120 characters.');
      }
      const created = await repository.createWorkspace(req.tenant.id, workspaceId, name.trim());
      if (!created) throw new ApiError(409, 'Workspace ID already exists in this tenant.');
      res.status(201).json({ workspaceId, name: name.trim() });
    }
  );

  tenantRouter.get(
    '/workspaces/:workspaceId/documents',
    createTenantAccessMiddleware(repository, { capability: 'workspace:read' }),
    async (req, res) => {
      assertWorkspaceId(req.params.workspaceId);
      const documents = await repository.getDocuments(req.tenant.id, req.params.workspaceId);
      if (documents === null) throw new ApiError(404, 'Workspace not found.');
      if (!req.tenant.capabilities.includes('*')) {
        if (!req.tenant.capabilities.includes('tasks:read')) delete documents.tasks;
        if (!req.tenant.capabilities.includes('people:read')) delete documents.employees;
      }
      res.json({ workspaceId: req.params.workspaceId, documents });
    }
  );

  tenantRouter.put(
    '/workspaces/:workspaceId/documents/:type',
    createTenantAccessMiddleware(repository, { write: true }),
    async (req, res) => {
      const { workspaceId, type } = req.params;
      assertWorkspaceId(workspaceId);
      const requiredCapability = {
        milestone: 'workspace:write',
        employees: 'people:write',
        tasks: 'tasks:write'
      }[type];
      if (!requiredCapability) throw new ApiError(404, 'Document type not found.');
      if (!req.tenant.capabilities.includes('*') &&
        !req.tenant.capabilities.includes(requiredCapability)) {
        throw new ApiError(403, `Tenant permission required: ${requiredCapability}.`);
      }
      if (!Object.hasOwn(req.body || {}, 'value')) {
        throw new ApiError(400, 'Request body must include a value.');
      }
      const existing = await repository.getDocuments(req.tenant.id, workspaceId);
      if (existing === null) throw new ApiError(404, 'Workspace not found.');
      const employees = type === 'employees' ? req.body.value : existing.employees;
      const milestone = type === 'milestone' ? req.body.value : existing.milestone;
      const value = type === 'tasks' ? normalizeTaskStatuses(req.body.value) : req.body.value;
      validateDocument(type, value, { employees, milestone });
      if (!await repository.setDocument(req.tenant.id, workspaceId, type, value)) {
        throw new ApiError(404, 'Workspace not found.');
      }
      const baseEvent = {
        tenantId: req.tenant.id,
        workspaceId,
        actorSubject: req.user.subject,
        actorName: req.user.name
      };
      if (type === 'tasks') {
        const previousTasks = new Map(
          (existing.tasks?.tasks || [])
            .filter(task => task && typeof task.task_id === 'string')
            .map(task => [task.task_id, task])
        );
        const statusChanges = value.tasks
          .filter(task => task && typeof task.task_id === 'string')
          .filter(task => previousTasks.has(task.task_id) && previousTasks.get(task.task_id).status !== task.status)
          .map(task => repository.addAuditEvent({
            ...baseEvent,
            eventType: 'task.status.changed',
            targetId: task.task_id,
            details: {
              from: previousTasks.get(task.task_id).status,
              to: task.status
            }
          }));
        await Promise.all(statusChanges);
      }
      await repository.addAuditEvent({
        ...baseEvent,
        eventType: `${type}.updated`,
        details: { documentType: type }
      });
      res.json({ success: true, type });
    }
  );

  tenantRouter.post(
    '/workspaces/:workspaceId/tasks/generate',
    createTenantAccessMiddleware(repository, { write: true, capability: 'tasks:write' }),
    async (req, res) => {
      const { workspaceId } = req.params;
      assertWorkspaceId(workspaceId);
      for (const capability of ['workspace:read', 'people:read']) {
        if (!req.tenant.capabilities.includes('*') &&
          !req.tenant.capabilities.includes(capability)) {
          throw new ApiError(403, `Tenant permission required: ${capability}.`);
        }
      }
      if (req.body?.model !== undefined &&
        (typeof req.body.model !== 'string' || req.body.model.length > 200)) {
        throw new ApiError(400, 'Model must be a string of at most 200 characters.');
      }
      const documents = await repository.getDocuments(req.tenant.id, workspaceId);
      if (documents === null) throw new ApiError(404, 'Workspace not found.');
      const milestone = req.body?.milestone ?? documents.milestone;
      const employees = req.body?.employees ?? documents.employees;
      const employeeErrors = validateEmployees(employees);
      if (employeeErrors.length) {
        throw new ApiError(400, `Invalid employees document: ${employeeErrors.join('; ')}`);
      }
      if (!milestone) throw new ApiError(400, 'A milestone is required to generate tasks.');
      const provider = req.body?.provider;
      if (provider !== undefined) assertProvider(provider);
      const apiKey = getRequestApiKey(provider, req.body);
      if (provider && !apiKey &&
        !getConfiguredProviders().some(item => item.id === provider)) {
        throw new ApiError(
          400,
          provider === 'gemini'
            ? 'Enter a Gemini API key or configure GEMINI_API_KEY on the backend.'
            : `${provider} is not configured on the backend.`
        );
      }
      const document = await generateTasks({
        milestone,
        employees,
        model: req.body?.model,
        provider,
        ...(apiKey ? { apiKey } : {})
      });
      await repository.setDocument(req.tenant.id, workspaceId, 'tasks', document);
      await repository.addAuditEvent({
        tenantId: req.tenant.id,
        workspaceId,
        actorSubject: req.user.subject,
        actorName: req.user.name,
        eventType: 'tasks.generated',
        details: { taskCount: document.tasks.length }
      });
      res.json(document);
    }
  );

  tenantRouter.use(createTeamRouter(repository));
  router.use('/:tenantId', tenantRouter);
  return router;
}
