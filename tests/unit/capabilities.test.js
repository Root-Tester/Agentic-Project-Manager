import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEffectiveCapabilities,
  hasCapability,
  RESPONSIBILITY_PROFILES
} from '../../shared/access/capabilities.js';

test('responsibility profiles refine organization access without granting administrator rights', () => {
  const projectManager = { role: 'editor', capabilityProfile: 'project-manager' };
  assert.equal(hasCapability(projectManager, 'tasks:write'), true);
  assert.equal(hasCapability(projectManager, 'members:read'), true);
  assert.equal(hasCapability(projectManager, 'audit:read'), false);

  const restrictedEditor = { role: 'editor', capabilityProfile: 'cybersecurity' };
  assert.equal(hasCapability(restrictedEditor, 'audit:read'), true);
  assert.equal(hasCapability(restrictedEditor, 'tasks:write'), false);
  assert.equal(hasCapability(restrictedEditor, 'members:manage'), false);

  const viewerWithElevatedProfile = { role: 'viewer', capabilityProfile: 'project-manager' };
  assert.equal(hasCapability(viewerWithElevatedProfile, 'tasks:write'), false);
  assert.equal(hasCapability(viewerWithElevatedProfile, 'workspace:write'), false);

  const administrator = { role: 'admin', capabilityProfile: 'backend-developer' };
  assert.equal(hasCapability(administrator, 'members:manage'), false);
  assert.equal(getEffectiveCapabilities({ role: 'owner' }).has('database:read'), true);
  assert.ok(Object.hasOwn(RESPONSIBILITY_PROFILES, 'database-administrator'));
});
