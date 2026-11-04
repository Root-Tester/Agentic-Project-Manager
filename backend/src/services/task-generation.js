import { callLLM } from '../../../shared/ai/index.js';
import { normalizeTaskStatuses, validateTasksDocument } from '../../../shared/schemas/tasks.js';
import { ApiError } from '../api/errors.js';

function formatMilestone(milestone) {
  if (!milestone) return '';
  if (typeof milestone === 'string') {
    try {
      milestone = JSON.parse(milestone);
    } catch {
      return milestone;
    }
  }
  if (!milestone || typeof milestone !== 'object' || Array.isArray(milestone)) {
    throw new ApiError(400, 'Milestone must be an object or text.');
  }
  return [
    `PROJECT_ID: ${milestone.PROJECT_ID || ''}`,
    `MILESTONE_NAME: ${milestone.MILESTONE_NAME || ''}`,
    `MILESTONE_DESCRIPTION: ${milestone.MILESTONE_DESCRIPTION || ''}`,
    `MILESTONE_OWNER: ${milestone.MILESTONE_OWNER || ''}`,
    `MILESTONE_PRIORITY: ${milestone.MILESTONE_PRIORITY || ''}`,
    `MILESTONE_START: ${milestone.MILESTONE_START || ''}`,
    `MILESTONE_END: ${milestone.MILESTONE_END || ''}`
  ].join('\n');
}

function buildPrompt(milestone, employees) {
  return `Break this project milestone into 3-8 concrete tasks.

Milestone:
${formatMilestone(milestone)}

Available employees (assign only to Employee_ID values in this list):
${JSON.stringify(employees, null, 2)}

Return only JSON matching:
{"tasks":[{"task_id":"string","project_id":"string","task_name":"string","description":"string","assigned_to":"Employee_ID","dependencies":["task_id"],"priority":"low|medium|high","status":"not-started","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","estimated_hours":1}]}
Keep task dates inside the milestone dates, use unique task IDs, and reference only valid dependencies.`;
}

export async function generateTasks({ milestone, employees, model, provider, apiKey }) {
  let text;
  try {
    text = await callLLM(
      buildPrompt(milestone, employees),
      model,
      provider ? { provider, ...(apiKey ? { apiKey } : {}) } : {}
    );
  } catch (error) {
    if (error.statusCode) throw new ApiError(error.statusCode, error.message);
    throw error;
  }
  let document;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    document = normalizeTaskStatuses(JSON.parse(cleaned));
  } catch {
    throw new ApiError(502, 'The model returned invalid task JSON.');
  }
  const errors = validateTasksDocument(document, {
    employees,
    milestone,
    enforceTaskCount: true
  });
  if (errors.length) throw new ApiError(502, `Generated tasks failed validation: ${errors.join('; ')}`);
  return document;
}
