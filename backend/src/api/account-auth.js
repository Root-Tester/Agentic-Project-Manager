import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';

const scrypt = promisify(scryptCallback);
const ISSUER = 'agentic-project-manager';
const AUDIENCE = 'agentic-project-manager-web';
const SCRYPT_KEY_LENGTH = 64;
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString('hex'));

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function publicProfile(account) {
  return {
    sub: account.subject,
    email: account.email,
    name: account.displayName
  };
}

export function validateRegistration({ email, displayName, password } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 120) {
    throw new Error('Display name must contain 1-120 characters.');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('Password must contain 12-128 characters.');
  }
  return {
    email: normalizedEmail,
    displayName: displayName.trim(),
    password
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

async function verifyPassword(password, encodedHash) {
  const [, n, r, p, saltValue, hashValue] = String(encodedHash).split('$');
  if (n !== '16384' || r !== '8' || p !== '1' || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(hashValue, 'base64url');
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = Buffer.from(await scrypt(password, salt, expected.length, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }));
  return timingSafeEqual(actual, expected);
}

export function createAccountAuth({ repository, secret, platformAdminEmails = [] }) {
  if (!repository || typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Account authentication requires a repository and a JWT secret of at least 32 bytes.');
  }
  const secretKey = Buffer.from(secret);
  const allowedPlatformAdminEmails = new Set(
    platformAdminEmails.map(email => email.toLowerCase())
  );

  async function issueToken(account) {
    const mustChangePassword = Boolean(account.mustChangePassword);
    const platformAdmin = allowedPlatformAdminEmails.has(account.email.toLowerCase());
    const demoReadOnly = account.subject === 'demo-guest-readonly';
    const accessToken = await new SignJWT({
      email: account.email,
      name: account.displayName,
      mustChangePassword,
      platformAdmin,
      demoReadOnly
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(account.subject)
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(secretKey);
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 7200,
      profile: publicProfile(account),
      must_change_password: mustChangePassword,
      platform_admin: platformAdmin,
      demo_read_only: demoReadOnly
    };
  }

  return {
    async registerPlatformAdmin(input) {
      const registration = validateRegistration(input);
      if (!allowedPlatformAdminEmails.has(registration.email)) {
        throw new Error('This email is not authorized for platform administrator setup.');
      }
      const passwordHash = await hashPassword(registration.password);
      const account = await repository.createPlatformAdminAccount({
        email: registration.email,
        displayName: registration.displayName,
        passwordHash
      });
      return issueToken(account);
    },

    async createCompany(input, actorSubject) {
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const companyType = input?.companyType;
      const website = typeof input?.website === 'string' ? input.website.trim() : '';
      if (!name || name.length > 120) throw new Error('Company name must contain 1-120 characters.');
      if (!['service-based', 'product-based', 'technology', 'non-technology'].includes(companyType)) {
        throw new Error('Choose a supported company type.');
      }
      if (website.length > 240) throw new Error('Company website must be at most 240 characters.');
      if (website) {
        let parsedWebsite;
        try {
          parsedWebsite = new URL(website);
        } catch {
          throw new Error('Company website must be a valid HTTP or HTTPS URL.');
        }
        if (!['http:', 'https:'].includes(parsedWebsite.protocol) ||
          parsedWebsite.username || parsedWebsite.password) {
          throw new Error('Company website must be a valid HTTP or HTTPS URL.');
        }
      }
      const owner = validateRegistration({
        email: input?.ownerEmail,
        displayName: input?.ownerName,
        password: 'temporary-password-placeholder'
      });
      const temporaryPassword = randomBytes(18).toString('base64url');
      const passwordHash = await hashPassword(temporaryPassword);
      const company = await repository.createCompany({
        name,
        companyType,
        website,
        ownerEmail: owner.email,
        ownerName: owner.displayName,
        ownerPasswordHash: passwordHash,
        actorSubject
      });
      return {
        company,
        ownerCredentials: {
          email: owner.email,
          temporaryPassword
        }
      };
    },

    async provisionEmployee(input, tenantId, actorSubject) {
      const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
      const email = normalizeEmail(input?.email);
      const employeeCode = typeof input?.employeeCode === 'string' ? input.employeeCode.trim() : '';
      const jobTitle = typeof input?.jobTitle === 'string' ? input.jobTitle.trim() : '';
      const department = typeof input?.department === 'string' ? input.department.trim() : '';
      const experienceLevel = input?.experienceLevel || 'mid-level';
      const accessRole = input?.accessRole || 'employee';
      if (!displayName || displayName.length > 120) throw new Error('Employee name must contain 1-120 characters.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new Error('Enter a valid employee email address.');
      }
      if (!employeeCode || employeeCode.length > 80) throw new Error('Employee ID must contain 1-80 characters.');
      if (!jobTitle || jobTitle.length > 100) throw new Error('Job title must contain 1-100 characters.');
      if (!department || department.length > 100) throw new Error('Department must contain 1-100 characters.');
      if (!['fresher', 'mid-level', 'senior'].includes(experienceLevel)) {
        throw new Error('Choose a supported experience level.');
      }
      if (!['employee', 'hr', 'hr-manager', 'manager', 'team-leader'].includes(accessRole)) {
        throw new Error('Choose a supported company access role.');
      }
      const existing = await repository.findAccountIdentityByEmail(email);
      const temporaryPassword = existing ? '' : randomBytes(18).toString('base64url');
      const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : '';
      const employee = await repository.createEmployee({
        tenantId,
        actorSubject,
        email,
        displayName,
        employeeCode,
        jobTitle,
        department,
        experienceLevel,
        accessRole,
        passwordHash
      });
      return {
        employee,
        ...(temporaryPassword ? { temporaryPassword } : {})
      };
    },

    async login(input) {
      const email = normalizeEmail(input?.email);
      const password = input?.password;
      if (!email || typeof password !== 'string' || password.length > 128) {
        throw new Error('Email or password is incorrect.');
      }
      const account = await repository.getAccountByEmail(email);
      const passwordHash = account?.passwordHash || await DUMMY_PASSWORD_HASH;
      const passwordMatches = await verifyPassword(password, passwordHash);
      if (!account || account.status !== 'active' || !passwordMatches) {
        throw new Error('Email or password is incorrect.');
      }
      return issueToken(account);
    },

    async changePassword(subject, password) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
        throw new Error('Password must contain 12-128 characters.');
      }
      await repository.updateAccountPassword(subject, await hashPassword(password));
      const account = await repository.getAccountBySubject(subject);
      if (!account || account.status !== 'active') throw new Error('Account is unavailable.');
      return issueToken(account);
    },

    async createDemoSession() {
      const account = await repository.getDemoAccount();
      if (!account) throw new Error('The read-only demo is not available.');
      return issueToken(account);
    },

    async verifyToken(token) {
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE
      });
      const account = typeof payload.sub === 'string' && payload.sub
        ? await repository.getAccountBySubject(payload.sub)
        : null;
      if (!account || account.status !== 'active') {
        throw new Error('Account session is no longer active.');
      }
      return {
        ...payload,
        email: account.email,
        name: account.displayName,
        mustChangePassword: Boolean(account.mustChangePassword),
        platformAdmin: allowedPlatformAdminEmails.has(account.email.toLowerCase()),
        demoReadOnly: account.subject === 'demo-guest-readonly'
      };
    }
  };
}
