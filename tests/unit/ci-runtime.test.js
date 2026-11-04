import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);
test('GitHub workflows use Node.js release lines that meet the package engine minimum', () => {
  const minimum = packageJson.engines.node.match(/^>=(\d+)\.(\d+)/);
  assert.ok(minimum, 'package.json must declare a numeric minimum Node.js version');
  const minimumMajor = Number(minimum[1]);
  const minimumMinor = Number(minimum[2]);
  const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
  const workflowFiles = readdirSync(workflowDirectory)
    .filter(file => /\.ya?ml$/i.test(file));
  assert.ok(workflowFiles.length > 0, 'GitHub workflows must be present');

  for (const file of workflowFiles) {
    const workflow = load(readFileSync(new URL(file, workflowDirectory), 'utf8'));
    const jobs = Object.values(workflow.jobs || {});
    const steps = jobs.flatMap(job => job.steps || []);
    const setupSteps = steps.filter(step => step.uses?.startsWith('actions/setup-node@'));

    if (steps.some(step => /\bnpm(?:\.cmd)?\b/.test(step.run || ''))) {
      assert.ok(setupSteps.length > 0, `${file} runs npm without configuring Node.js`);
    }

    for (const step of setupSteps) {
      const version = step.with?.['node-version'];
      const match = typeof version === 'string' && version.match(/^(\d+)(?:\.(\d+))?(?:\.x)?$/);
      assert.ok(match, `${file} has unsupported Node.js version selector: ${version}`);
      const major = Number(match[1]);
      const minor = match[2] === undefined ? undefined : Number(match[2]);
      assert.ok(
        major > minimumMajor || (major === minimumMajor && (minor === undefined || minor >= minimumMinor)),
        `${file} selects Node.js ${version}, below package minimum ${packageJson.engines.node}`
      );
    }
  }
});
