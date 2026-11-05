import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import rateLimit from 'express-rate-limit';
import { createAuthenticationMiddleware } from './middleware/authenticate.js';
import { ApiError } from './errors.js';
import { createTenantRouter } from './routes/tenants.js';
import { createPlatformRouter } from './routes/platform.js';

export function createApiApp({
  config,
  repository,
  verifyToken,
  accountAuth,
  staticDirectory
} = {}) {
  if (!config || !repository) throw new Error('Backend config and workspace repository are required.');

  const app = express();
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many registration attempts. Try again later.' }
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' }
  });
  const demoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many demo sessions. Try again later.' }
  });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    const origin = req.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) {
      next(new ApiError(403, 'Origin is not allowed.'));
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  if (accountAuth) {
    app.post('/api/v1/auth/register', registerLimiter, async (req, res, next) => {
      try {
        const session = await accountAuth.registerPlatformAdmin(req.body);
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json(session);
      } catch (error) {
        if (error instanceof Error &&
          error.message.startsWith('This email is not authorized')) {
          next(new ApiError(403, error.message));
        } else if (error instanceof Error &&
          /^(Enter a valid|Display name|Password)/.test(error.message)) {
          next(new ApiError(400, error.message));
        } else if (error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          next(new ApiError(409, 'An account could not be created with those details.'));
        } else {
          next(error);
        }
      }
    });

    app.post('/api/v1/auth/demo', demoLimiter, async (req, res, next) => {
      try {
        const session = await accountAuth.createDemoSession();
        res.setHeader('Cache-Control', 'no-store');
        res.json(session);
      } catch (error) {
        next(error);
      }
    });

    app.post('/api/v1/auth/login', loginLimiter, async (req, res, next) => {
      try {
        const session = await accountAuth.login(req.body);
        res.setHeader('Cache-Control', 'no-store');
        res.json(session);
      } catch (error) {
        if (error instanceof Error && error.message === 'Email or password is incorrect.') {
          next(new ApiError(401, 'Email or password is incorrect.'));
        } else {
          next(error);
        }
      }
    });

    app.post('/api/v1/auth/change-password', async (req, res, next) => {
      try {
        const authorization = req.headers.authorization || '';
        if (!authorization.startsWith('Bearer ')) {
          throw new ApiError(401, 'Authentication required.');
        }
        const claims = await accountAuth.verifyToken(authorization.slice('Bearer '.length));
        const session = await accountAuth.changePassword(claims.sub, req.body?.password);
        res.setHeader('Cache-Control', 'no-store');
        res.json(session);
      } catch (error) {
        if (error instanceof ApiError) next(error);
        else if (error instanceof Error && error.message.startsWith('Password must')) {
          next(new ApiError(400, error.message));
        } else next(error);
      }
    });
  }

  const tokenVerifier = accountAuth
    ? token => accountAuth.verifyToken(token)
    : verifyToken;
  const authenticatedApiLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs || 15 * 60 * 1000,
    max: config.rateLimitMax || 100,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(
    '/api/v1/tenants',
    authenticatedApiLimiter,
    createAuthenticationMiddleware({
      issuer: config.issuer || 'agentic-project-manager',
      audience: config.audience || 'agentic-project-manager-web',
      jwksUri: config.jwksUri || '',
      ...(tokenVerifier ? { verifyToken: tokenVerifier } : {})
    }),
    createTenantRouter(repository, { accountAuth })
  );
  if (accountAuth) {
    app.use(
      '/api/v1/platform',
      authenticatedApiLimiter,
      createPlatformRouter({
        config: { ...config, platformAdminEmails: config.platformAdminEmails || [] },
        repository,
        accountAuth
      })
    );
  }

  if (staticDirectory && existsSync(path.join(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory, { index: false, fallthrough: true }));
    app.get(/^(?!\/api\/|\/auth\/|\/healthz).*/, (req, res) => {
      res.sendFile(path.join(staticDirectory, 'index.html'));
    });
  }

  app.use((req, res, next) => next(new ApiError(404, 'Route not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = error instanceof ApiError
      ? error.status
      : error.statusCode === 507 ? 507
      : error.type === 'entity.too.large' ? 413
        : error instanceof SyntaxError && error.status === 400 ? 400 : 500;
    const message = error instanceof ApiError
      ? error.message
      : status === 507 ? error.message
      : status === 413 ? 'Request body exceeds the 2 MB limit.'
        : status === 400 ? 'Request body must be valid JSON.'
          : 'The API request failed.';
    res.status(status).json({ error: message });
  });
  return app;
}
