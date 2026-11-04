import { ApiError } from '../errors.js';
import {
  getEffectiveCapabilities,
  hasCapability
} from '../../../../shared/access/capabilities.js';

const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);
const ADMIN_ROLES = new Set(['owner', 'admin']);

export function createTenantAccessMiddleware(
  repository,
  { write = false, admin = false, capability } = {}
) {
  return async (req, res, next) => {
    try {
      if (req.user.mustChangePassword) {
        throw new ApiError(403, 'Change your temporary password before continuing.');
      }
      const tenantId = req.params.tenantId;
      if (typeof tenantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(tenantId)) {
        throw new ApiError(400, 'Invalid tenant ID.');
      }
      const membership = await repository.getMembership(tenantId, req.user.subject);
      if (!membership) throw new ApiError(404, 'Tenant not found.');
      if (admin && !ADMIN_ROLES.has(membership.role)) {
        throw new ApiError(403, 'Tenant administrator role required.');
      }
      if (capability && !hasCapability(membership, capability)) {
        throw new ApiError(403, `Tenant permission required: ${capability}.`);
      }
      if (write && !WRITE_ROLES.has(membership.role)) {
        throw new ApiError(403, 'Tenant write access required.');
      }
      req.tenant = {
        id: tenantId,
        role: membership.role,
        membership,
        capabilities: [...getEffectiveCapabilities(membership)]
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
