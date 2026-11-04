export const EXPERIENCE_LEVELS = ['fresher', 'mid-level', 'senior'];

const CAPACITY_MULTIPLIERS = {
  fresher: 0.75,
  'mid-level': 1,
  senior: 1.25
};
const DEFAULT_EXPERIENCE_LEVEL = 'mid-level';
const HOURS_PER_WORKDAY = 8;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readMilestone(milestone) {
  if (typeof milestone !== 'string') return milestone;
  try {
    return JSON.parse(milestone);
  } catch {
    return null;
  }
}

function firstWeekday(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  while (value.getUTCDay() === 0 || value.getUTCDay() === 6) {
    value.setUTCDate(value.getUTCDate() + 1);
  }
  return value;
}

function addWorkingDays(startDate, duration) {
  const date = firstWeekday(startDate);
  let remaining = Math.max(0, duration - 1);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

export function calculateCapacityForecast({ tasks = [], employees = [], milestone } = {}) {
  const projectTasks = Array.isArray(tasks)
    ? tasks.filter(task => task && typeof task === 'object')
    : [];
  const projectEmployees = Array.isArray(employees)
    ? employees.filter(employee => employee && typeof employee === 'object')
    : [];
  const assignedIds = new Set(
    projectTasks
      .map(task => task.assigned_to)
      .filter(id => typeof id === 'string' && id.trim())
  );
  const employeesById = new Map(
    projectEmployees
      .filter(employee => typeof employee.Employee_ID === 'string')
      .map(employee => [employee.Employee_ID, employee])
  );
  const proficiencyCounts = Object.fromEntries(EXPERIENCE_LEVELS.map(level => [level, 0]));
  let capacityHoursPerDay = 0;
  let knownAssignedEmployees = 0;

  for (const id of assignedIds) {
    const employee = employeesById.get(id);
    if (!employee) continue;
    const level = EXPERIENCE_LEVELS.includes(employee.experience_level)
      ? employee.experience_level
      : DEFAULT_EXPERIENCE_LEVEL;
    proficiencyCounts[level]++;
    capacityHoursPerDay += HOURS_PER_WORKDAY * CAPACITY_MULTIPLIERS[level];
    knownAssignedEmployees++;
  }

  const estimatedHours = projectTasks.reduce((total, task) => (
    total + (Number.isFinite(task.estimated_hours) && task.estimated_hours > 0
      ? task.estimated_hours
      : 0)
  ), 0);
  const milestoneData = readMilestone(milestone);
  const taskStart = projectTasks
    .map(task => task.start_date)
    .filter(isValidDate)
    .sort()[0];
  const milestoneStart = milestoneData && typeof milestoneData === 'object'
    ? milestoneData.MILESTONE_START
    : undefined;
  const startDate = isValidDate(milestoneStart) ? milestoneStart : taskStart || null;
  const milestoneEnd = milestoneData && typeof milestoneData === 'object' &&
    isValidDate(milestoneData.MILESTONE_END)
    ? milestoneData.MILESTONE_END
    : null;

  const base = {
    activeTeamCount: assignedIds.size,
    knownAssignedEmployees,
    estimatedHours,
    capacityHoursPerDay,
    proficiencyCounts,
    workingDays: null,
    projectedStart: null,
    projectedEnd: null,
    milestoneEnd,
    exceedsMilestone: false
  };
  if (!startDate || !knownAssignedEmployees || estimatedHours <= 0) return base;

  const workingDays = Math.ceil(estimatedHours / capacityHoursPerDay);
  const projectedStart = firstWeekday(startDate).toISOString().slice(0, 10);
  const projectedEnd = addWorkingDays(projectedStart, workingDays);
  return {
    ...base,
    workingDays,
    projectedStart,
    projectedEnd,
    exceedsMilestone: Boolean(milestoneEnd && projectedEnd > milestoneEnd)
  };
}
