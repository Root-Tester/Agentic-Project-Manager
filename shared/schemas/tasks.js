const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(['low', 'medium', 'high']);
export const TASK_STATUSES = [
  'not-started',
  'just-started',
  'in-progress',
  'testing',
  'debugging',
  'client-review',
  'completed',
  'blocked'
];
const STATUSES = new Set(TASK_STATUSES);

export function normalizeTaskStatuses(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.tasks)) {
    return document;
  }
  let changed = false;
  const tasks = document.tasks.map(task => {
    if (!task || typeof task !== 'object' || task.status !== 'pending') return task;
    changed = true;
    return { ...task, status: 'not-started' };
  });
  return changed ? { ...document, tasks } : document;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateEmployees(employees) {
  const errors = [];
  if (!Array.isArray(employees) || employees.length === 0) {
    return ['employees: must be a non-empty array'];
  }

  const ids = new Set();
  employees.forEach((employee, index) => {
    const prefix = `employees[${index}]`;
    if (!employee || typeof employee !== 'object' || Array.isArray(employee)) {
      errors.push(`${prefix}: must be an object`);
      return;
    }

    for (const field of ['Employee_ID', 'Employee_Name', 'Role', 'Department']) {
      if (typeof employee[field] !== 'string' || !employee[field].trim()) {
        errors.push(`${prefix}.${field}: required non-empty string`);
      }
    }

    if (typeof employee.Employee_ID === 'string') {
      if (ids.has(employee.Employee_ID)) {
        errors.push(`${prefix}.Employee_ID: must be unique`);
      }
      ids.add(employee.Employee_ID);
    }
  });

  return errors;
}

export function validateTasksDocument(document, {
  employees,
  milestone,
  enforceTaskCount = false
} = {}) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return ['response: must be an object'];
  }
  if (!Array.isArray(document.tasks)) {
    return ['tasks: must be an array'];
  }
  if (enforceTaskCount && (document.tasks.length < 3 || document.tasks.length > 8)) {
    errors.push('tasks: must contain between 3 and 8 tasks');
  }

  const employeeErrors = employees === undefined ? [] : validateEmployees(employees);
  errors.push(...employeeErrors);
  const employeeIds = employees === undefined
    ? null
    : new Set(Array.isArray(employees)
      ? employees.filter(e => e && typeof e.Employee_ID === 'string').map(e => e.Employee_ID)
      : []);
  const taskIds = new Set();

  document.tasks.forEach((task, index) => {
    const prefix = `tasks[${index}]`;
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      errors.push(`${prefix}: must be an object`);
      return;
    }

    for (const field of ['task_id', 'project_id', 'task_name', 'description', 'assigned_to']) {
      if (typeof task[field] !== 'string') {
        errors.push(`${prefix}.${field}: required string`);
      } else if (field !== 'project_id' && !task[field].trim()) {
        errors.push(`${prefix}.${field}: must not be empty`);
      }
    }

    if (typeof task.task_id === 'string' && task.task_id) {
      if (taskIds.has(task.task_id)) {
        errors.push(`${prefix}.task_id: must be unique`);
      }
      taskIds.add(task.task_id);
    }

    if (!PRIORITIES.has(task.priority)) {
      errors.push(`${prefix}.priority: must be low, medium, or high`);
    }
    if (!STATUSES.has(task.status)) {
      errors.push(`${prefix}.status: must be one of ${TASK_STATUSES.join(', ')}`);
    }
    if (!isValidDate(task.start_date)) {
      errors.push(`${prefix}.start_date: must be a valid YYYY-MM-DD date`);
    }
    if (!isValidDate(task.end_date)) {
      errors.push(`${prefix}.end_date: must be a valid YYYY-MM-DD date`);
    }
    if (isValidDate(task.start_date) && isValidDate(task.end_date) && task.end_date < task.start_date) {
      errors.push(`${prefix}.end_date: must not be before start_date`);
    }
    if (typeof task.estimated_hours !== 'number' || !Number.isFinite(task.estimated_hours) || task.estimated_hours < 0) {
      errors.push(`${prefix}.estimated_hours: must be a non-negative finite number`);
    }
    if (!Array.isArray(task.dependencies) || task.dependencies.some(dependency => typeof dependency !== 'string')) {
      errors.push(`${prefix}.dependencies: must be an array of task IDs`);
    }
    if (employeeIds && typeof task.assigned_to === 'string' && !employeeIds.has(task.assigned_to)) {
      errors.push(`${prefix}.assigned_to: must match an available employee`);
    }
  });

  const milestoneDetails = getMilestoneDetails(milestone);
  if (milestoneDetails?.window) {
    const { start, end } = milestoneDetails.window;
    if (end < start) {
      errors.push('milestone: end date must not be before start date');
    }
    document.tasks.forEach((task, index) => {
      if (!task || typeof task !== 'object') return;
      if (isValidDate(task.start_date) && task.start_date < start) {
        errors.push(`tasks[${index}].start_date: must be on or after milestone start`);
      }
      if (isValidDate(task.end_date) && task.end_date > end) {
        errors.push(`tasks[${index}].end_date: must be on or before milestone end`);
      }
    });
  }
  if (milestoneDetails?.projectId) {
    document.tasks.forEach((task, index) => {
      if (task && typeof task === 'object' && task.project_id !== milestoneDetails.projectId) {
        errors.push(`tasks[${index}].project_id: must match milestone project ID`);
      }
    });
  }

  document.tasks.forEach((task, index) => {
    if (!task || !Array.isArray(task.dependencies)) return;
    task.dependencies.forEach(dependency => {
      if (typeof dependency === 'string' && !taskIds.has(dependency)) {
        errors.push(`tasks[${index}].dependencies: unknown task ID "${dependency}"`);
      }
      if (dependency === task.task_id) {
        errors.push(`tasks[${index}].dependencies: task cannot depend on itself`);
      }
    });
  });

  const taskById = new Map(
    document.tasks
      .filter(task => task && typeof task === 'object' && typeof task.task_id === 'string')
      .map(task => [task.task_id, task])
  );
  const dependents = new Map([...taskById.keys()].map(taskId => [taskId, []]));
  const dependencyCounts = new Map([...taskById.keys()].map(taskId => [taskId, 0]));
  for (const [taskId, task] of taskById) {
    if (!Array.isArray(task.dependencies)) continue;
    for (const dependency of task.dependencies) {
      if (!taskById.has(dependency)) continue;
      dependencyCounts.set(taskId, dependencyCounts.get(taskId) + 1);
      dependents.get(dependency).push(taskId);
    }
  }
  const ready = [...dependencyCounts].filter(([, count]) => count === 0).map(([taskId]) => taskId);
  let visitedCount = 0;
  for (let index = 0; index < ready.length; index++) {
    const taskId = ready[index];
    visitedCount++;
    for (const dependent of dependents.get(taskId)) {
      const count = dependencyCounts.get(dependent) - 1;
      dependencyCounts.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  if (visitedCount !== taskById.size) {
    errors.push('tasks.dependencies: must not contain cycles');
  }

  return errors;
}

function getMilestoneDetails(milestone) {
  let data = milestone;
  if (typeof milestone === 'string') {
    try {
      data = JSON.parse(milestone);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const window = isValidDate(data.MILESTONE_START) && isValidDate(data.MILESTONE_END)
    ? { start: data.MILESTONE_START, end: data.MILESTONE_END }
    : null;
  return {
    window,
    projectId: typeof data.PROJECT_ID === 'string' ? data.PROJECT_ID : null
  };
}
