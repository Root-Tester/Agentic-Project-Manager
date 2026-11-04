import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { callLLM, listAvailableModels } from '../../../shared/ai/index.js';
import { createWorkspaceStore, WorkspaceStoreError } from '../storage/workspace-store.js';
import {
  normalizeTaskStatuses,
  validateEmployees,
  validateTasksDocument
} from '../../../shared/schemas/tasks.js';
import logger from '../ui/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAX_REQUEST_SIZE = 2 * 1024 * 1024;
const SUPPORTED_PROVIDERS = new Set(['gemini', 'openai', 'anthropic']);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function readLocalMilestone(cwd) {
  const jsonPath = path.join(cwd, 'milestone.json');
  if (await fileExists(jsonPath)) return fs.readJson(jsonPath);
  for (const extension of ['md', 'txt']) {
    const textPath = path.join(cwd, `milestone.${extension}`);
    if (await fileExists(textPath)) return fs.readFile(textPath, 'utf8');
  }
  return null;
}

async function readLocalJson(cwd, filename) {
  const filePath = path.join(cwd, filename);
  return await fileExists(filePath) ? fs.readJson(filePath) : null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_SIZE) {
        const error = new Error('Request body exceeds the 2 MB limit.');
        error.statusCode = 413;
        reject(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_REQUEST_SIZE) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const error = new Error('Request body must be valid JSON.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isAuthorized(req, token) {
  const authorization = req.headers.authorization || '';
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;
  const provided = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function getTaskPrompt(milestone, employees) {
  return `You are a Task Generation Agent. Given a single project milestone, you break it into concrete, actionable tasks.

## INPUTS
You receive one milestone to decompose:
${formatMilestone(milestone)}

CURRENT_TIMESTAMP: ${new Date().toISOString()}

- AVAILABLE_EMPLOYEES (assign tasks ONLY to people from this list; experience_level is optional and may be fresher, mid-level, or senior):
${JSON.stringify(employees, null, 2)}

Missing experience_level means mid-level. Use proficiency when selecting a suitable assignee; keep estimated_hours as the task effort, independent of assignee productivity.

## YOUR TASK
- Break this milestone into 3-8 concrete tasks. Each task is a single piece of work someone can pick up.
- Order tasks logically. Where one task must finish before another can start, record that with dependencies.
- Keep every task's dates inside the milestone window (between MILESTONE_START and MILESTONE_END).
- Assign each task to the most suitable person from AVAILABLE_EMPLOYEES, matching their Role and Department.
- Output the result strictly as a valid JSON object matching the schema below. Do not wrap in markdown or add explanations.

## OUTPUT SCHEMA
{
  "tasks": [
    {
      "task_id": "string (unique identifier like T1, T2, etc.)",
      "project_id": "string (matches the milestone's project ID if provided)",
      "task_name": "string (short descriptive name)",
      "description": "string (detailed description of what needs to be done)",
      "assigned_to": "string (Employee_ID from the list)",
      "dependencies": ["array of task_ids"],
      "priority": "string (low, medium, high)",
      "status": "string (not-started, just-started, in-progress, testing, debugging, client-review, completed, or blocked)",
      "start_date": "string (YYYY-MM-DD)",
      "end_date": "string (YYYY-MM-DD)",
      "estimated_hours": number
    }
  ]
}
`;
}

function parseTaskResponse(responseText) {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const error = new Error('LLM response is not valid JSON.');
    error.statusCode = 502;
    throw error;
  }
}

/**
 * Formats a milestone object or JSON string into a structured key-value text.
 * 
 * @param {Object|string} milestone - The milestone object or JSON string.
 * @returns {string} The formatted text.
 */
function formatMilestone(milestone) {
  if (!milestone) return '';
  let data = milestone;
  if (typeof milestone === 'string') {
    try {
      data = JSON.parse(milestone);
    } catch {
      return milestone;
    }
  }
  
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return `PROJECT_ID: ${data.PROJECT_ID || ''}
MILESTONE_NAME: ${data.MILESTONE_NAME || ''}
MILESTONE_DESCRIPTION: ${data.MILESTONE_DESCRIPTION || ''}
MILESTONE_OWNER: ${data.MILESTONE_OWNER || ''}
MILESTONE_PRIORITY: ${data.MILESTONE_PRIORITY || ''}
MILESTONE_START: ${data.MILESTONE_START || ''}
MILESTONE_END: ${data.MILESTONE_END || ''}`;
  }
  return String(milestone);
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

export function createUiServer(cwd = process.cwd(), port = 3000) {
  const webDir = path.resolve(__dirname, 'frontend');
  const token = randomBytes(32).toString('hex');
  const workspaceStore = createWorkspaceStore({ cwd });

  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      const expectedHost = `127.0.0.1:${actualPort}`;
      if (req.headers.host !== expectedHost) {
        sendJson(res, 403, { error: 'Unexpected Host header.' });
        return;
      }

      const url = new URL(req.url, `http://${expectedHost}`);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) {
          sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
          return;
        }
        if (!isAuthorized(req, token)) {
          sendJson(res, 401, { error: 'Authentication required.' });
          return;
        }

        if (pathname === '/api/load-workspace' && req.method === 'GET') {
          const milestone = await workspaceStore.readDocument(
            'milestone',
            () => readLocalMilestone(cwd)
          );
          const employeesDocument = await workspaceStore.readDocument(
            'employees',
            () => readLocalJson(cwd, 'employees.json')
          );
          const tasksDocument = await workspaceStore.readDocument(
            'tasks',
            () => readLocalJson(cwd, 'tasks.json')
          );
          const employees = employeesDocument || [];
          let tasks = [];
          if (employeesDocument) {
            const errors = validateEmployees(employees);
            if (errors.length) throw new Error(`Invalid employees.json: ${errors.join('; ')}`);
          }
          if (tasksDocument) {
            const errors = validateTasksDocument(tasksDocument, {
              ...(employees.length ? { employees } : {}),
              milestone
            });
            if (errors.length) throw new Error(`Invalid tasks.json: ${errors.join('; ')}`);
            tasks = tasksDocument.tasks;
          }
          sendJson(res, 200, {
            milestone: typeof milestone === 'string'
              ? milestone
              : milestone ? JSON.stringify(milestone, null, 2) : '',
            employees,
            tasks
          });
          return;
        }

        if (pathname === '/api/models' && req.method === 'POST') {
          const { provider, apiKey } = await readJsonBody(req);
          if (!SUPPORTED_PROVIDERS.has(provider) || typeof apiKey !== 'string' || !apiKey.trim()) {
            const error = new Error('Choose a supported provider and enter a non-empty API key.');
            error.statusCode = 400;
            throw error;
          }
          const models = await listAvailableModels(provider, apiKey);
          sendJson(res, 200, { models });
          return;
        }

        if (pathname === '/api/generate' && req.method === 'POST') {
          const data = await readJsonBody(req);
          const { milestone, employees, provider, apiKey, model } = data || {};
          if (!(typeof milestone === 'string' || (milestone && typeof milestone === 'object'))) {
            const error = new Error('Milestone content is required.');
            error.statusCode = 400;
            throw error;
          }
          const employeeErrors = validateEmployees(employees);
          if (employeeErrors.length) {
            const error = new Error(employeeErrors.join('; '));
            error.statusCode = 400;
            throw error;
          }
          if (!SUPPORTED_PROVIDERS.has(provider) || typeof apiKey !== 'string' || !apiKey.trim()) {
            const error = new Error('A supported provider and non-empty API key are required.');
            error.statusCode = 400;
            throw error;
          }
          if (model !== undefined && (typeof model !== 'string' || model.length > 200)) {
            const error = new Error('Model must be a string of at most 200 characters.');
            error.statusCode = 400;
            throw error;
          }

          const responseText = await callLLM(getTaskPrompt(milestone, employees), model, { provider, apiKey });
          const document = normalizeTaskStatuses(parseTaskResponse(responseText));
          const validationErrors = validateTasksDocument(document, {
            employees,
            milestone,
            enforceTaskCount: true
          });
          if (validationErrors.length) {
            const error = new Error(`Generated tasks failed validation: ${validationErrors.join('; ')}`);
            error.statusCode = 502;
            throw error;
          }
          await workspaceStore.writeDocument('milestone', milestone);
          await workspaceStore.writeDocument('employees', employees);
          sendJson(res, 200, document);
          return;
        }

        if (pathname === '/api/save' && req.method === 'POST') {
          const document = normalizeTaskStatuses(await readJsonBody(req));
          const employees = await workspaceStore.readDocument(
            'employees',
            () => readLocalJson(cwd, 'employees.json')
          ) || undefined;
          const milestone = await workspaceStore.readDocument(
            'milestone',
            () => readLocalMilestone(cwd)
          ) || undefined;
          const validationErrors = validateTasksDocument(document, { employees, milestone });
          if (validationErrors.length) {
            const error = new Error(`Tasks failed validation: ${validationErrors.join('; ')}`);
            error.statusCode = 400;
            throw error;
          }
          const tasksPath = path.join(cwd, 'tasks.json');
          await workspaceStore.writeDocument('tasks', document);
          await fs.outputJson(tasksPath, document, { spaces: 2 });
          sendJson(res, 200, { success: true, path: path.relative(cwd, tasksPath) });
          return;
        }

        sendJson(res, 404, { error: 'API route not found.' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      let decodedPath;
      try {
        decodedPath = decodeURIComponent(pathname);
      } catch {
        res.writeHead(400);
        res.end('Invalid URL path.');
        return;
      }
      const relativePath = decodedPath.replace(/^[/\\]+/, '') || 'index.html';
      const resolvedRoot = path.resolve(webDir);
      const sharedCapacityModule = '/shared/analytics/capacity-forecast.js';
      const sharedModuleRoot = path.resolve(__dirname, '../../../shared/analytics');
      const isSharedCapacityModule = decodedPath === sharedCapacityModule;
      const fileRoot = isSharedCapacityModule ? sharedModuleRoot : resolvedRoot;
      const filePath = isSharedCapacityModule
        ? path.resolve(sharedModuleRoot, 'capacity-forecast.js')
        : path.resolve(resolvedRoot, relativePath);
      if (filePath !== fileRoot && !filePath.startsWith(`${fileRoot}${path.sep}`)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!await fileExists(filePath) || (await fs.stat(filePath)).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      if (path.basename(filePath) === 'index.html') {
        const html = (await fs.readFile(filePath, 'utf8')).replace('__APM_AUTH_TOKEN__', token);
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(html);
        }
        return;
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      sendJson(res, err.statusCode || 500, {
        error: err.statusCode || err instanceof WorkspaceStoreError
          ? err.message
          : 'The local UI request failed.'
      });
    }
  });

  server.once('close', () => {
    workspaceStore.close().catch(error => {
      logger.error(`Could not close the MongoDB workspace store: ${error.message}`);
    });
  });

  return { server, token };
}
