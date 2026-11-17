import assert from 'node:assert/strict';
import test from 'node:test';
import { getSecurityAndUserPolicies, POLICIES_VERSION } from '../../backend/src/security/policies.js';
import { decryptData, deriveKey, encryptData, maskSensitive } from '../../backend/src/security/encryption.js';

test('system exposes complete security, user policy, and terms of service', () => {
  const policies = getSecurityAndUserPolicies();
  assert.equal(policies.version, POLICIES_VERSION);
  assert.ok(policies.effectiveDate);

  // Terms of service verification
  assert.ok(policies.termsOfService);
  assert.match(policies.termsOfService.title, /Terms of Service/i);
  assert.ok(policies.termsOfService.sections.length >= 4);
  assert.ok(policies.termsOfService.sections.some(s => s.heading.includes('Acceptance')));
  assert.ok(policies.termsOfService.sections.some(s => s.heading.includes('Acceptable Use')));

  // Privacy policy verification
  assert.ok(policies.privacyPolicy);
  assert.match(policies.privacyPolicy.title, /Privacy Notice/i);
  assert.ok(policies.privacyPolicy.sections.length >= 3);
  assert.ok(policies.privacyPolicy.sections.some(s => s.body.includes('bcrypt')));

  // Security policy verification
  assert.ok(policies.securityPolicy);
  assert.match(policies.securityPolicy.title, /Security Architecture/i);
  assert.ok(policies.securityPolicy.sections.length >= 5);
  assert.ok(policies.securityPolicy.sections.some(s => s.heading.includes('Bcrypt')));
  assert.ok(policies.securityPolicy.sections.some(s => s.heading.includes('Encryption')));
  assert.ok(policies.securityPolicy.sections.some(s => s.heading.includes('Role-Based Access Control')));
});

test('encryption module encrypts and decrypts user data with authenticated AES-256-GCM', () => {
  const secret = 'a-super-secret-key-that-is-at-least-32-bytes-long';
  const plaintext = 'sensitive-user-token-or-secret-data-12345';

  const encrypted = encryptData(plaintext, secret);
  assert.match(encrypted, /^enc\$v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);

  const decrypted = decryptData(encrypted, secret);
  assert.equal(decrypted, plaintext);

  // Key derivation test
  const derived1 = deriveKey(secret);
  const derived2 = deriveKey(secret);
  assert.deepEqual(derived1, derived2);
  assert.equal(derived1.length, 32);

  // Direct buffer key encryption
  const encryptedWithKey = encryptData(plaintext, derived1);
  assert.equal(decryptData(encryptedWithKey, derived1), plaintext);

  // Encrypt JSON object
  const userPayload = { userId: 'usr-123', sensitiveNote: 'classified' };
  const encryptedObj = encryptData(userPayload, secret);
  assert.deepEqual(JSON.parse(decryptData(encryptedObj, secret)), userPayload);

  // Tamper detection
  const tampered = encrypted.slice(0, -4) + 'AAAA';
  assert.throws(() => decryptData(tampered, secret), /integrity check failed|decryption failed/i);

  // Invalid format detection
  assert.throws(() => decryptData('invalid-format', secret), /Unrecognized encryption payload format/i);
});

test('maskSensitive protects tokens and secrets from plain logging', () => {
  assert.equal(maskSensitive(''), '');
  assert.equal(maskSensitive('short'), '****');
  assert.equal(maskSensitive('sk-proj-1234567890abcdef'), 'sk-****cdef');
});
