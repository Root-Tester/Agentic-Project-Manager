import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError } from '../errors.js';

export function createAuthenticationMiddleware({
  issuer,
  audience,
  jwksUri,
  verifyToken
}) {
  const jwks = jwksUri ? createRemoteJWKSet(new URL(jwksUri)) : null;
  const verify = verifyToken || (async token => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    return payload;
  });
  return async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      next(new ApiError(401, 'Authentication required.'));
      return;
    }
    const token = authorization.slice('Bearer '.length);
    if (!token || token.length > 16_384) {
      next(new ApiError(401, 'Invalid access token.'));
      return;
    }
    try {
      const claims = await verify(token);
      if (typeof claims.sub !== 'string' || !claims.sub) {
        throw new ApiError(401, 'Access token has no subject.');
      }
      if (claims.mustChangePassword) {
        throw new ApiError(403, 'Change your temporary password before continuing.');
      }
      if (claims.demoReadOnly && req.method !== 'GET' && req.method !== 'HEAD') {
        throw new ApiError(403, 'The public demo is read-only.');
      }
      req.user = {
        subject: claims.sub,
        email: claims.email,
        name: claims.name || claims.preferred_username || claims.email || claims.sub,
        mustChangePassword: Boolean(claims.mustChangePassword),
        platformAdmin: Boolean(claims.platformAdmin),
        demoReadOnly: Boolean(claims.demoReadOnly)
      };
      next();
    } catch (error) {
      next(error instanceof ApiError ? error : new ApiError(401, 'Access token is invalid or expired.'));
    }
  };
}
