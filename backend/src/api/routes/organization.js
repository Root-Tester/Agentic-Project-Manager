import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { COMPANY_ACCESS_ROLES, getJobCatalog } from '../../../../shared/organization/job-catalog.js';
import { ApiError } from '../errors.js';
import { createTenantAccessMiddleware } from '../middleware/tenant-access.js';

const TEAM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const EXPERIENCE_LEVELS = new Set(['fresher', 'mid-level', 'senior']);
const EMPLOYMENT_STATUSES = new Set(['working', 'on-leave', 'retired', 'fired']);
const ACCESS_ROLES = new Set(COMPANY_ACCESS_ROLES.map(role => role.id));
const employeeWriteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

function isCompanyManager(req) {
  return ['owner', 'admin'].includes(req.tenant.role) ||
    ['hr-manager'].includes(req.tenant.membership.capabilityProfile);
}

function assertCanChangeRole(req, role) {
  if (!ACCESS_ROLES.has(role)) throw new ApiError(400, 'Choose a supported company access role.');
  if (['owner', 'admin'].includes(req.tenant.role)) return;
  if (req.tenant.membership.capabilityProfile === 'hr-manager' &&
    !['hr', 'hr-manager'].includes(role)) return;
  if (req.tenant.membership.capabilityProfile === 'hr' && role === 'employee') return;
  throw new ApiError(403, 'Your company role cannot provision this access level.');
}

export function createOrganizationRouter(repository, accountAuth) {
  const router = Router({ mergeParams: true });

  router.get(
    '/company',
    createTenantAccessMiddleware(repository, { capability: 'workspace:read' }),
    async (req, res) => {
      const company = await repository.getCompany(req.tenant.id);
      if (!company) throw new ApiError(404, 'Company profile not found.');
      res.json({ company });
    }
  );

  router.get(
    '/job-catalog',
    createTenantAccessMiddleware(repository, { capability: 'people:read' }),
    async (req, res) => {
      const company = await repository.getCompany(req.tenant.id);
      if (!company) throw new ApiError(404, 'Company profile not found.');
      res.json({ companyType: company.companyType, departments: getJobCatalog(company.companyType) });
    }
  );

  router.get(
    '/employees',
    createTenantAccessMiddleware(repository, { capability: 'people:read' }),
    async (req, res) => {
      const employees = await repository.listEmployees(req.tenant.id, {
        subject: req.user.subject,
        accessRole: req.tenant.membership.capabilityProfile
      });
      res.json({ employees });
    }
  );

  router.post(
    '/employees',
    createTenantAccessMiddleware(repository, { capability: 'people:write' }),
    employeeWriteRateLimiter,
    async (req, res, next) => {
      try {
        if (!accountAuth) throw new ApiError(503, 'Employee account provisioning is unavailable.');
        const role = req.body?.accessRole || 'employee';
        assertCanChangeRole(req, role);
        const company = await repository.getCompany(req.tenant.id);
        if (!company) throw new ApiError(404, 'Company profile not found.');
        const catalog = getJobCatalog(company.companyType) || [];
        const department = catalog.find(item => item.department === req.body?.department);
        if (!department || !department.titles.includes(req.body?.jobTitle)) {
          throw new ApiError(400, 'Choose a department and job title from the company catalog.');
        }
        const result = await accountAuth.provisionEmployee(
          req.body,
          req.tenant.id,
          req.user.subject
        );
        await repository.addAuditEvent({
          tenantId: req.tenant.id,
          actorSubject: req.user.subject,
          actorName: req.user.name,
          eventType: 'employee.submitted',
          targetId: result.employee.employeeId,
          details: { accessRole: role, verificationStatus: 'pending' }
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json(result);
      } catch (error) {
        if (error instanceof ApiError) next(error);
        else if (error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          next(new ApiError(409, 'Employee email or employee ID already exists in this company.'));
        } else if (error instanceof Error &&
          /^(Employee name|Enter a valid employee|Employee ID|Job title|Department|Choose a supported)/.test(error.message)) {
          next(new ApiError(400, error.message));
        } else {
          next(error);
        }
      }
    }
  );

  router.post(
    '/employees/:employeeId/verify',
    createTenantAccessMiddleware(repository, { capability: 'people:write' }),
    employeeWriteRateLimiter,
    async (req, res, next) => {
      try {
        if (!isCompanyManager(req)) {
          throw new ApiError(403, 'HR manager or company administrator access is required for verification.');
        }
        if (!/^[A-Za-z0-9-]{1,64}$/.test(req.params.employeeId)) {
          throw new ApiError(400, 'Invalid employee ID.');
        }
        const employee = await repository.verifyEmployee(
          req.tenant.id,
          req.params.employeeId,
          req.user.subject,
          req.body?.teamId || ''
        );
        if (!employee) throw new ApiError(404, 'Employee not found.');
        await repository.addAuditEvent({
          tenantId: req.tenant.id,
          actorSubject: req.user.subject,
          actorName: req.user.name,
          eventType: 'employee.verified',
          targetId: req.params.employeeId,
          details: { teamId: req.body?.teamId || '' }
        });
        res.json({ employee });
      } catch (error) {
        if (error instanceof ApiError) next(error);
        else if (error instanceof Error && /^(Only pending|The selected team)/.test(error.message)) {
          next(new ApiError(400, error.message));
        } else next(error);
      }
    }
  );

  router.post(
    '/employees/:employeeId/reject',
    createTenantAccessMiddleware(repository, { capability: 'people:write' }),
    employeeWriteRateLimiter,
    async (req, res, next) => {
      try {
        if (!isCompanyManager(req)) {
          throw new ApiError(403, 'HR manager or company administrator access is required for verification.');
        }
        if (!/^[A-Za-z0-9-]{1,64}$/.test(req.params.employeeId)) {
          throw new ApiError(400, 'Invalid employee ID.');
        }
        if (!await repository.rejectEmployee(req.tenant.id, req.params.employeeId, req.user.subject)) {
          throw new ApiError(404, 'Pending employee not found.');
        }
        await repository.addAuditEvent({
          tenantId: req.tenant.id,
          actorSubject: req.user.subject,
          actorName: req.user.name,
          eventType: 'employee.rejected',
          targetId: req.params.employeeId,
          details: { reason: 'HR manager review' }
        });
        res.json({ success: true });
      } catch (error) {
        if (error instanceof ApiError) next(error);
        else next(error);
      }
    }
  );

  router.put(
    '/employees/:employeeId/status',
    createTenantAccessMiddleware(repository, { capability: 'people:write' }),
    async (req, res, next) => {
      try {
        if (!/^[A-Za-z0-9-]{1,64}$/.test(req.params.employeeId)) {
          throw new ApiError(400, 'Invalid employee ID.');
        }
        const employmentStatus = req.body?.employmentStatus;
        if (!EMPLOYMENT_STATUSES.has(employmentStatus)) {
          throw new ApiError(400, 'Choose working, on leave, retired, or fired.');
        }
        const updated = await repository.updateEmployeeStatus(
          req.tenant.id,
          req.params.employeeId,
          employmentStatus
        );
        if (!updated) throw new ApiError(404, 'Employee not found.');
        await repository.addAuditEvent({
          tenantId: req.tenant.id,
          actorSubject: req.user.subject,
          actorName: req.user.name,
          eventType: 'employee.status_updated',
          targetId: req.params.employeeId,
          details: { employmentStatus }
        });
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/teams',
    createTenantAccessMiddleware(repository, { capability: 'people:read' }),
    async (req, res) => {
      const teams = await repository.listTeams(req.tenant.id);
      const accessRole = req.tenant.membership.capabilityProfile;
      const visibleTeams = ['manager', 'team-leader'].includes(accessRole)
        ? teams.filter(team =>
          team.leaderSubject === req.user.subject ||
          team.memberSubjects?.includes(req.user.subject)
        )
        : teams;
      res.json({ teams: visibleTeams });
    }
  );

  router.post(
    '/teams',
    createTenantAccessMiddleware(repository, { capability: 'people:write' }),
    async (req, res, next) => {
      try {
        if (!isCompanyManager(req)) {
          throw new ApiError(403, 'HR manager or company administrator access is required to create teams.');
        }
        const { name, description = '', leaderEmployeeId = '', workspaceId = '' } = req.body || {};
        const teamId = typeof req.body?.teamId === 'string' && req.body.teamId
          ? req.body.teamId
          : `team-${randomUUID()}`;
        if (!TEAM_ID.test(teamId)) throw new ApiError(400, 'Team ID must contain 2-128 valid characters.');
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
          throw new ApiError(400, 'Team name must contain 1-120 characters.');
        }
        if (typeof description !== 'string' || description.length > 500) {
          throw new ApiError(400, 'Team description must be at most 500 characters.');
        }
        const team = await repository.createTeam(req.tenant.id, {
          teamId,
          name: name.trim(),
          description: description.trim(),
          leaderEmployeeId,
          workspaceId,
          actorSubject: req.user.subject
        });
        if (!team) throw new ApiError(404, 'Workspace not found in this company.');
        await repository.addAuditEvent({
          tenantId: req.tenant.id,
          actorSubject: req.user.subject,
          actorName: req.user.name,
          eventType: 'team.created',
          targetId: teamId,
          details: { workspaceId: workspaceId || '' }
        });
        res.status(201).json({ team });
      } catch (error) {
        if (error instanceof ApiError) next(error);
        else if (error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          next(new ApiError(409, 'A team with this ID already exists.'));
        } else if (error instanceof Error &&
          error.message.startsWith('Team leader must')) {
          next(new ApiError(400, error.message));
        } else next(error);
      }
    }
  );

  router.post(
    '/teams/:teamId/members',
    createTenantAccessMiddleware(repository, { capability: 'people:write' }),
    async (req, res, next) => {
      try {
        if (!isCompanyManager(req)) {
          throw new ApiError(403, 'HR manager or company administrator access is required to organize teams.');
        }
        if (!TEAM_ID.test(req.params.teamId)) throw new ApiError(400, 'Invalid team ID.');
        const employeeId = req.body?.employeeId;
        if (typeof employeeId !== 'string' || !employeeId) {
          throw new ApiError(400, 'Employee ID is required.');
        }
        const added = await repository.assignEmployeeToTeam(
          req.tenant.id,
          req.params.teamId,
          employeeId,
          req.user.subject
        );
        if (!added) {
          const teams = await repository.listTeams(req.tenant.id);
          if (!teams.some(team => team.teamId === req.params.teamId)) {
            throw new ApiError(404, 'Team not found.');
          }
          const employees = await repository.listEmployees(req.tenant.id);
          if (!employees.some(employee =>
            employee.employeeId === employeeId &&
            employee.verificationStatus === 'verified' &&
            employee.employmentStatus === 'working'
          )) {
            throw new ApiError(400, 'Only verified, currently working employees can be assigned.');
          }
        }
        res.status(200).json({ success: true });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/organization/overview',
    createTenantAccessMiddleware(repository, { capability: 'kpi:read' }),
    async (req, res) => {
      const accessRole = req.tenant.membership.capabilityProfile;
      const overview = await repository.getOrganizationOverview(req.tenant.id, {
        subject: req.user.subject,
        accessRole
      });
      if (!['hr-manager', 'manager', 'team-leader'].includes(accessRole) &&
        !['owner', 'admin'].includes(req.tenant.role)) {
        throw new ApiError(403, 'Company overview access is not available for this role.');
      }
      res.json({ overview });
    }
  );

  return router;
}
