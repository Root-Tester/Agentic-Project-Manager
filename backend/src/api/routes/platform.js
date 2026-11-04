import { Router } from 'express';
import { createAuthenticationMiddleware } from '../middleware/authenticate.js';
import { ApiError } from '../errors.js';

function platformAdminOnly(platformAdminEmails) {
  const allowed = new Set(platformAdminEmails);
  return (req, res, next) => {
    if (req.user.mustChangePassword) {
      next(new ApiError(403, 'Change your temporary password before continuing.'));
      return;
    }
    if (!allowed.has(String(req.user.email || '').toLowerCase())) {
      next(new ApiError(403, 'Platform administrator access required.'));
      return;
    }
    next();
  };
}

export function createPlatformRouter({ config, repository, accountAuth }) {
  const router = Router();
  router.use(createAuthenticationMiddleware({
    issuer: config.issuer,
    audience: config.audience,
    verifyToken: token => accountAuth.verifyToken(token)
  }));
  router.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      platformAdmin: config.platformAdminEmails.includes(String(req.user.email || '').toLowerCase()),
      mustChangePassword: req.user.mustChangePassword
    });
  });
  router.get(
    '/companies',
    platformAdminOnly(config.platformAdminEmails),
    async (req, res) => res.json({ companies: await repository.listCompanies() })
  );
  router.post(
    '/companies',
    platformAdminOnly(config.platformAdminEmails),
    async (req, res, next) => {
      try {
        const result = await accountAuth.createCompany(req.body, req.user.subject);
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json(result);
      } catch (error) {
        if (error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          next(new ApiError(409, 'An account already exists with the company owner email.'));
        } else if (error instanceof Error &&
          /^(Company name|Choose a supported company type|Company website|Enter a valid|Display name)/.test(error.message)) {
          next(new ApiError(400, error.message));
        } else {
          next(error);
        }
      }
    }
  );
  return router;
}
