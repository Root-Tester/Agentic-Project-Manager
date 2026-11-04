import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCapacityForecast } from '../../shared/analytics/capacity-forecast.js';

const employee = (id, experience_level) => ({
  Employee_ID: id,
  Employee_Name: id,
  experience_level
});
const task = (assigned_to, estimated_hours, start_date = '2026-10-05') => ({
  assigned_to,
  estimated_hours,
  start_date
});

test('calculates assigned-team capacity and an inclusive weekday window', () => {
  const result = calculateCapacityForecast({
    tasks: [task('fresh', 20), task('mid', 0)],
    employees: [employee('fresh', 'fresher'), employee('mid', 'mid-level')],
    milestone: { MILESTONE_START: '2026-10-05', MILESTONE_END: '2026-10-31' }
  });

  assert.equal(result.activeTeamCount, 2);
  assert.equal(result.estimatedHours, 20);
  assert.equal(result.capacityHoursPerDay, 14);
  assert.deepEqual(result.proficiencyCounts, { fresher: 1, 'mid-level': 1, senior: 0 });
  assert.equal(result.workingDays, 2);
  assert.equal(result.projectedStart, '2026-10-05');
  assert.equal(result.projectedEnd, '2026-10-06');
  assert.equal(result.exceedsMilestone, false);
});

test('team proficiency and size change forecast duration without changing effort', () => {
  const hours = 40;
  const singleFresher = calculateCapacityForecast({
    tasks: [task('a', hours)],
    employees: [employee('a', 'fresher')],
    milestone: { MILESTONE_START: '2026-10-05' }
  });
  const twoSeniors = calculateCapacityForecast({
    tasks: [task('a', hours), task('b', 0)],
    employees: [employee('a', 'senior'), employee('b', 'senior')],
    milestone: { MILESTONE_START: '2026-10-05' }
  });
  assert.equal(singleFresher.estimatedHours, hours);
  assert.equal(twoSeniors.estimatedHours, hours);
  assert.equal(singleFresher.workingDays, 7);
  assert.equal(twoSeniors.workingDays, 2);
  assert.equal(twoSeniors.activeTeamCount, 2);
});

test('treats missing legacy proficiency as mid-level and reports target overruns', () => {
  const result = calculateCapacityForecast({
    tasks: [task('legacy', 24)],
    employees: [employee('legacy')],
    milestone: { MILESTONE_START: '2026-10-05', MILESTONE_END: '2026-10-06' }
  });
  assert.equal(result.capacityHoursPerDay, 8);
  assert.equal(result.proficiencyCounts['mid-level'], 1);
  assert.equal(result.projectedEnd, '2026-10-07');
  assert.equal(result.exceedsMilestone, true);
});

test('skips weekends and falls back to task start when milestone start is absent', () => {
  const result = calculateCapacityForecast({
    tasks: [task('senior', 16, '2026-10-09')],
    employees: [employee('senior', 'senior')]
  });
  assert.equal(result.projectedStart, '2026-10-09');
  assert.equal(result.projectedEnd, '2026-10-12');
});

test('does not invent capacity for missing assignees or empty task documents', () => {
  const missingEmployee = calculateCapacityForecast({
    tasks: [task('unknown', 12)],
    employees: [],
    milestone: { MILESTONE_START: '2026-10-05' }
  });
  const empty = calculateCapacityForecast();
  assert.equal(missingEmployee.activeTeamCount, 1);
  assert.equal(missingEmployee.knownAssignedEmployees, 0);
  assert.equal(missingEmployee.projectedEnd, null);
  assert.equal(empty.estimatedHours, 0);
  assert.equal(empty.projectedEnd, null);
});
