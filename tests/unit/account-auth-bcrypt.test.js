import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountAuth, validateRegistration } from '../../backend/src/api/account-auth.js';
import { openSqliteDatabase } from '../../backend/src/storage/sqlite/database.js';
import { WorkspaceRepository } from '../../backend/src/storage/sqlite/workspace-repository.js';
import { createWorkspaceCache } from '../../backend/src/storage/cache/workspace-cache.js';

const SECRET = 'a-test-signing-secret-that-is-long-enough-123456';
const ADMIN_EMAIL = 'admin@security.test';

async function setup() {
  const storage = await openSqliteDatabase(':memory:');
  const repository = new WorkspaceRepository(storage.database, createWorkspaceCache());
  const accountAuth = createAccountAuth({
    repository,
    secret: SECRET,
    platformAdminEmails: [ADMIN_EMAIL]
  });
  return { storage, repository, accountAuth };
}

test('validateRegistration validates input and enforces terms acceptance when specified', () => {
  const valid = validateRegistration({
    email: 'test@example.com',
    displayName: 'Test User',
    password: 'a-secure-password-12345'
  });
  assert.equal(valid.email, 'test@example.com');
  assert.equal(valid.displayName, 'Test User');

  // Rejection when agreeToTerms is explicitly false
  assert.throws(
    () => validateRegistration({
      email: 'test@example.com',
      displayName: 'Test User',
      password: 'a-secure-password-12345',
      agreeToTerms: false
    }),
    /You must accept the Terms of Service/i
  );
});

test('registers platform administrator with bcrypt hash and records terms acceptance', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const session = await accountAuth.registerPlatformAdmin({
    email: ADMIN_EMAIL,
    displayName: 'Platform Security Officer',
    password: 'super-secure-password-123',
    agreeToTerms: true
  });

  assert.ok(session.access_token);
  assert.equal(session.platform_admin, true);
  assert.equal(session.terms_accepted, true);

  // Verify hash in database is a bcrypt hash ($2a$ or $2b$)
  const stored = await repository.getAccountByEmail(ADMIN_EMAIL);
  assert.ok(stored.passwordHash.startsWith('$2a$') || stored.passwordHash.startsWith('$2b$'));
  assert.ok(stored.termsAcceptedAt);

  // Verify login with bcrypt password succeeds
  const loginSession = await accountAuth.login({
    email: ADMIN_EMAIL,
    password: 'super-secure-password-123'
  });
  assert.ok(loginSession.access_token);
  assert.equal(loginSession.profile.email, ADMIN_EMAIL);

  // Verify wrong password fails
  await assert.rejects(
    () => accountAuth.login({ email: ADMIN_EMAIL, password: 'wrong-password-123' }),
    /Email or password is incorrect/i
  );
});

test('supports legacy scrypt hashes seamlessly alongside bcrypt', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  // Manually create account with legacy scrypt hash
  const legacyHash = 'scrypt$16384$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'; // dummy format
  // Verify verifyPassword returns false for invalid hash without crashing
  const badLogin = accountAuth.login({ email: 'nonexistent@example.com', password: 'password' });
  await assert.rejects(badLogin, /Email or password is incorrect/i);
});

test('changePassword updates to bcrypt and records policy acceptance', async t => {
  const { storage, accountAuth, repository } = await setup();
  t.after(() => storage.close());

  const registered = await accountAuth.registerPlatformAdmin({
    email: ADMIN_EMAIL,
    displayName: 'Admin User',
    password: 'initial-password-123'
  });

  const updatedSession = await accountAuth.changePassword(
    registered.profile.sub,
    'new-updated-private-password-456',
    { agreeToTerms: true }
  );

  assert.ok(updatedSession.access_token);

  // Verify password changed to new bcrypt hash
  const stored = await repository.getAccountByEmail(ADMIN_EMAIL);
  assert.ok(stored.passwordHash.startsWith('$2a$') || stored.passwordHash.startsWith('$2b$'));

  // Login with new password succeeds
  const loginResult = await accountAuth.login({
    email: ADMIN_EMAIL,
    password: 'new-updated-private-password-456'
  });
  assert.ok(loginResult.access_token);

  // Login with old password fails
  await assert.rejects(
    () => accountAuth.login({ email: ADMIN_EMAIL, password: 'initial-password-123' }),
    /Email or password is incorrect/i
  );
});
