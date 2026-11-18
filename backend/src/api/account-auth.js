import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const scrypt = promisify(scryptCallback);
const ISSUER = 'agentic-project-manager';
const AUDIENCE = 'agentic-project-manager-web';
const SCRYPT_KEY_LENGTH = 64;
const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

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

export function validateRegistration({ email, displayName, password, agreeToTerms } = {}) {
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
  if (agreeToTerms === false) {
    throw new Error('You must accept the Terms of Service, User Policy, and Security Policy to continue.');
  }
  return {
    email: normalizedEmail,
    displayName: displayName.trim(),
    password,
    agreeToTerms: agreeToTerms !== false
  };
}

export function validateCompanyInput(input) {
  const name = typeof input?.companyName === 'string'
    ? input.companyName.trim()
    : typeof input?.name === 'string'
      ? input.name.trim()
      : '';
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
  return { name, companyType, website };
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, encodedHash) {
  if (typeof encodedHash !== 'string' || !encodedHash) return false;
  if (encodedHash.startsWith('$2a$') || encodedHash.startsWith('$2b$')) {
    return bcrypt.compare(password, encodedHash);
  }
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
    const isOwnerOrExecutive = typeof repository?.isOwnerOrExecutive === 'function'
      ? await repository.isOwnerOrExecutive(account.subject)
      : false;
    const expiresIn = isOwnerOrExecutive ? 20 * 3600 : 15 * 3600;
    const expiryString = isOwnerOrExecutive ? '20h' : '15h';
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const sessionId = randomUUID();

    const accessToken = await new SignJWT({
      sessionId,
      session_id: sessionId,
      email: account.email,
      name: account.displayName,
      mustChangePassword,
      platformAdmin,
      demoReadOnly,
      isOwnerOrExecutive
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(account.subject)
      .setJti(sessionId)
      .setIssuedAt()
      .setExpirationTime(expiryString)
      .sign(secretKey);
    return {
      session_id: sessionId,
      sessionId,
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      expires_at: expiresAt,
      profile: publicProfile(account),
      must_change_password: mustChangePassword,
      terms_accepted: Boolean(account.termsAcceptedAt),
      platform_admin: platformAdmin,
      demo_read_only: demoReadOnly,
      is_owner_or_executive: isOwnerOrExecutive
    };
  }

  return {
    async registerCompany(input) {
      const registration = validateRegistration(input);
      const companyInput = validateCompanyInput(input);
      const now = new Date().toISOString();
      const passwordHash = await hashPassword(registration.password);

      const created = await repository.createCompany({
        name: companyInput.name,
        companyType: companyInput.companyType,
        website: companyInput.website,
        ownerEmail: registration.email,
        ownerName: registration.displayName,
        ownerPasswordHash: passwordHash,
        termsAcceptedAt: now
      });

      const account = await repository.getAccountByEmail(registration.email);
      return {
        ...(await issueToken(account)),
        company: created
      };
    },

    async registerPlatformAdmin(input) {
      const registration = validateRegistration(input);
      if (allowedPlatformAdminEmails.size > 0 && !allowedPlatformAdminEmails.has(registration.email)) {
        throw new Error('This email is not authorized for platform administrator setup.');
      }
      const passwordHash = await hashPassword(registration.password);
      const account = await repository.createPlatformAdminAccount({
        email: registration.email,
        displayName: registration.displayName,
        passwordHash,
        termsAcceptedAt: new Date().toISOString()
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
      if (!['employee', 'hr', 'hr-manager', 'manager', 'team-leader', 'managing-director', 'founder', 'board-member', 'shareholder'].includes(accessRole)) {
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

    async resetEmployeePassword(tenantId, employeeId) {
      const temporaryPassword = randomBytes(18).toString('base64url');
      const passwordHash = await hashPassword(temporaryPassword);
      const result = await repository.resetEmployeePassword(tenantId, employeeId, passwordHash);
      if (!result) throw new Error('Employee not found.');
      return {
        employeeId,
        email: result.email,
        temporaryPassword
      };
    },

    async batchProvisionEmployees(employees, tenantId, actorSubject) {
      if (!Array.isArray(employees) || employees.length === 0) {
        throw new Error('At least one employee must be provided for import.');
      }
      const results = [];
      const errors = [];
      for (const item of employees) {
        try {
          const res = await this.provisionEmployee(item, tenantId, actorSubject);
          results.push({
            employee: res.employee,
            temporaryPassword: res.temporaryPassword || '',
            email: res.employee.email,
            employeeCode: res.employee.employeeCode,
            displayName: res.employee.displayName
          });
        } catch (err) {
          errors.push({
            email: item.email,
            displayName: item.displayName,
            error: err.message
          });
        }
      }
      return { results, errors };
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

    async changePassword(subject, password, { agreeToTerms } = {}) {
      if (agreeToTerms === false) {
        throw new Error('You must accept the Terms of Service, User Policy, and Security Policy to continue.');
      }
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
        throw new Error('Password must contain 12-128 characters.');
      }
      await repository.updateAccountPassword(subject, await hashPassword(password), new Date().toISOString());
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
      const sessionId = payload.sessionId || payload.jti || payload.session_id;
      return {
        ...payload,
        sessionId,
        session_id: sessionId,
        email: account.email,
        name: account.displayName,
        mustChangePassword: Boolean(account.mustChangePassword),
        platformAdmin: allowedPlatformAdminEmails.has(account.email.toLowerCase()),
        demoReadOnly: account.subject === 'demo-guest-readonly'
      };
    }
  };
}
