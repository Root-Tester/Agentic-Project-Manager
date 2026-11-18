# Security, privacy, and operational readiness

This guide describes controls present in the application and responsibilities
that remain with the operator and each company. It is not a penetration-test
report, independent audit, certification, or guarantee that a deployment is
secure or compliant. Security depends on the code version, configuration,
hosting environment, and how the service is operated.

## Current security posture

The application has baseline controls for authentication, tenant
authorization, request validation, and data handling. It has not been
independently assessed or certified, and the project cannot support a numeric
security score from the available evidence. Do not treat it as approved for
sensitive workforce data until the deployment controls below are in place and
the responsible organization has completed its own security and privacy
review.

## Application controls

- **Passwords and sessions:** account passwords are validated for length and
  stored as salted `bcrypt` hashes (cost factor 12) with backward compatibility
  for legacy `scrypt` hashes. Authentication uses unique session IDs and signed
  HS256 JWT bearer tokens with issuer, audience, and expiry validation. Session
  validity is 12 hours for standard members and at least 18 hours for CEO,
  executive, and owner accounts. Active sessions persist across page refreshes
  until voluntary sign-out or session expiration, at which point the client
  automatically logs out and refreshes the application. Newly provisioned owner
  and employee accounts receive a temporary password and must change it before
  accessing tenant data. Terms of Service, Privacy Policy, and Security Policy
  acceptance is recorded upon setup and first login.
- **Data encryption and secret handling:** sensitive user payloads, request
  tokens, and secret values are protected using authenticated AES-256-GCM
  encryption with distinct 96-bit IVs and 128-bit authentication tags.
- **Account provisioning and lifecycle:** organizations and teams register through
  self-service company creation where the registering user becomes the initial owner.
  Team members do not need to self-register; company owners and administrators
  add team members directly or via verified spreadsheet import (Excel .xlsx / CSV)
  with an interactive online review and verification table. The platform generates
  secure login credentials (login ID and temporary password) requiring a mandatory
  password change upon first login. Administrators and HR can reset/recover lost
  initial passwords. When employees leave or are fired, authorized administrators,
  HR, and hiring managers can access their active task list for work handover and
  reassignment, and delete the account once task handouts are complete.
  Tenant boundaries and multiple role-based access levels enforce least privilege.
- **Authorization and separation:** the API authenticates protected requests
  and checks the user's active membership, organization role, and applicable
  capabilities. Company and workspace queries include the tenant boundary.
  Hiding a screen or button is not the access-control mechanism.
- **Database queries:** hosted storage is SQLite. The repository uses prepared
  statements for data values, transactions for related changes, and
  tenant-scoped filters. User input must not be concatenated into SQL
  statements or used as an unrestricted SQL identifier.
- **Request controls:** JSON request bodies are limited to 2 MB; routes
  validate input before persistence. Account registration, login, and demo
  session endpoints have rate limits. These limits are held in process memory
  and are not shared across API instances.
- **Browser and origin controls:** the API sets a Content Security Policy,
  frame denial, `X-Content-Type-Options`, referrer policy, and a restrictive
  Permissions Policy. Cross-origin requests are restricted to configured
  origins. Use HTTPS for all remote deployments; JWTs are signed, not
  encrypted, and do not protect credentials or tokens sent over plain HTTP.
- **Secrets and credentials:** `APM_JWT_SECRET`, provider keys, and
  `APM_PLATFORM_ADMIN_EMAILS` belong in server-side secret configuration.
  Never place them in frontend `VITE_` variables, source control, or
  application responses. New temporary passwords are shown once and are not
  delivered by email; operators must share them through a private channel.
- **Demo environment:** the public guest demo uses synthetic data in a
  separate viewer-only tenant. Keep real people and confidential information
  out of its seed data.

## Data handled

The SQLite database can contain account identifiers and password hashes,
company profiles, employee directory and onboarding details, memberships and
team assignments, project/task documents, discussions, notifications, and
limited audit metadata. The web application and API access the database; the
browser does not connect to SQLite directly.

The application does not provide database encryption at rest. The SQLite
file's operating-system permissions are restricted when the file is opened,
but protection of disks, persistent volumes, backups, logs, and host access
depends on the deployment operator and hosting provider. Configure
infrastructure encryption and access controls where available, and keep
backups private.

User-entered Gemini keys are held in frontend memory and sent to the
authenticated backend for provider requests; they are not saved to browser
storage or the application database. Backend-managed provider keys must stay
server-side. When task generation is used, milestone and employee details
included in the submitted prompt are sent to the selected external AI
provider. Review that provider's terms, privacy controls, and retention
practices before sending company data.

## Storage, retention, and backups

`APM_STORAGE_LIMIT_BYTES` sets a logical SQLite storage limit. When new writes
would exceed it, the application may irreversibly purge the oldest eligible
messages, notifications, audit events, and workspaces with their related
activity until the write fits. User, tenant, and membership records are
protected from this capacity cleanup. The cap estimates live database pages;
the physical SQLite file or hosting allocation may not shrink after purging.

This cleanup is not a complete retention policy or a user-directed deletion
feature. The application does not provide a complete self-service account,
company, or data-deletion workflow. Backups can retain records removed from
the live database. Operators must set and publish an appropriate retention
schedule, protect backups, verify restore procedures, monitor hosting quotas,
and define data-request and incident-response processes.

SQLite is designed for a single API instance in this deployment. Do not run
independent replicas with separate local database files and assume they share
company data. On container platforms, attach persistent storage and test it;
an application data directory alone does not make ephemeral storage durable.

## Important limitations

- The application has no multi-factor authentication, email verification,
  self-service password reset, or email delivery for temporary credentials.
- JWTs expire after two hours. Clearing the browser session at logout does not
  revoke a token copied by someone else before expiry. Rotating the signing
  secret invalidates outstanding sessions.
- Rate limits are process-local and reset when the service restarts. They do
  not replace a gateway, WAF, or platform-level abuse controls.
- The application does not provide centralized security monitoring, alerting,
  or a complete incident-response workflow.
- Project and task progress are delivery evidence, not validated employee
  performance, attendance, or suitability scores. A human must review context
  before any consequential employment decision.
- No independent security assessment, compliance certification, or legal
  determination is provided by this project documentation.

## Operator checklist

Before collecting real company data:

1. Generate a unique random JWT secret and store it as a server-side secret.
2. Restrict the platform-admin allowlist to trusted operators.
3. Configure HTTPS, exact production origins, persistent database storage,
   host permissions, and provider credentials only as needed.
4. Approve an organizational policy for employee information and for data
   submitted to external AI providers.
5. Establish least-privilege account provisioning, credential delivery,
   account recovery, access review, and deprovisioning procedures.
6. Define retention and deletion handling, private backups, tested restoration,
   vulnerability updates, monitoring, and incident response.
7. Obtain an independent security and privacy review appropriate to the
   deployment and applicable legal obligations.

The operator must review the deployed version and settings; this guide alone
does not establish that a specific deployment meets any security standard.
