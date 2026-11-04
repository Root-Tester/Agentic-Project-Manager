# Hosted application deployment

The hosted product consists of a React/Vite browser app, a Node.js/Express
API, and a local SQLite database. The browser sends requests to the API; it
does not connect to SQLite. See [Project architecture](../architecture.md)
for the design and [Security readiness](../security/readiness.md) for data
handling and operational limitations.

## Requirements and configuration

- Node.js 22.13 or newer and npm.
- `APM_JWT_SECRET`: a unique random value of at least 32 bytes. Generate it
  with `npm run generate:jwt-secret` and store it only in server-side
  configuration.
- `APM_DATABASE_PATH`: optional SQLite file path. The default is
  `.data/agentic-project-manager.sqlite`.
- `APM_STORAGE_LIMIT_BYTES`: optional logical storage cap. The default is
  500 MiB; the minimum accepted value is 1 MiB.
- `APM_PLATFORM_ADMIN_EMAILS`: comma-separated server-side allowlist of
  trusted addresses that may bootstrap platform administrator accounts. If
  unset, new platform administrator setup and company creation are disabled.
- `CORS_ORIGINS`: optional comma-separated exact origins for cross-origin API
  requests. Prefer serving the frontend and API on one origin.
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: optional
  server-managed provider credentials. The app also supports a user-entered
  Gemini key for an authenticated request.

Do not put secrets in frontend variables, source files, or committed
configuration. `.env`, the SQLite database, and its WAL files are ignored by
Git. Version schema and synthetic demo data only; never commit live employee,
account, project, message, or credential data.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `APM_JWT_SECRET` to the output of `npm run generate:jwt-secret`.
3. Set `APM_PLATFORM_ADMIN_EMAILS` to one or more trusted addresses.
4. Run `npm run dev` and `npm run start:web` in separate terminals.
5. Open `http://127.0.0.1:3000`. Use the read-only demo or bootstrap an
   allowlisted platform administrator to create a company.

The API listens on port 4000 by default; its health endpoint is
`http://127.0.0.1:4000/healthz`. Local HTTP is intended for loopback
development only. Remote access must use HTTPS to protect passwords and
bearer tokens in transit.

On startup, the API creates the database directory and applies schema
migrations. A corrupt or newer unsupported database fails explicitly; the
application does not replace it with an empty database. Back up the database
before an upgrade and use a SQLite-consistent backup procedure when WAL mode
is active.

## Hugging Face Spaces

The Docker image listens on port 7860 and defaults the database path to
`/data/agentic-project-manager.sqlite`. Configure:

- `APM_JWT_SECRET` as a Space secret, generated specifically for the Space.
- `APM_PLATFORM_ADMIN_EMAILS` as a Space variable containing only trusted
  platform administrator addresses.
- Persistent storage mounted at `/data` if records must survive container
  replacement or rebuild.
- AI provider credentials and an adjusted storage cap only when needed.

Spaces provide HTTPS at the public endpoint. A directory created inside a
container does not make its filesystem persistent; verify the Space's storage
configuration before collecting real data. Protect and back up the mounted
SQLite file, and test restoration.

## SQLite deployment model and retention

The hosted API is designed to use one SQLite database file with one API
instance. Independent replicas with separate local files do not share data.
For multi-instance service, use a shared transactional database architecture
instead of expecting local SQLite files to synchronize.

When a write would exceed the logical storage cap, the repository removes the
oldest eligible messages, notifications, audit events, or workspaces with
their related activity until the write fits. This purge is irreversible and
can remove project history. User, tenant, and membership records are protected
from this capacity cleanup. Deleted SQLite pages may be reused without
shrinking the physical file or the hosting storage allocation.

The cap is not a full retention schedule and does not provide user-requested
deletion. Operators remain responsible for backups, data retention and
deletion procedures, monitoring the host's storage quota, and communicating
the policy to users. See the [security guide](../security/readiness.md).

## Company and employee setup

Platform administrators create company profiles and provision the first
company owner. Company HR provisions employees using one-time temporary
passwords; those passwords must be delivered privately and replaced at first
sign-in. HR managers or company administrators verify hires before company
access is activated. HR can update verified employees' working, on-leave,
retired, or fired status; non-working status disables their company
membership.

Managers' project and task views are work evidence for human review, not
automated employee ratings or employment decisions. Formal employee reports,
HR investigations, and transfer/removal case workflows are not currently
provided.

## Optional AI providers

Task generation sends the supplied milestone and employee details to the
selected model provider. A user-entered Gemini key is held in browser memory
and sent to the authenticated API for provider requests; it is not stored in
browser storage or the application database. Server-managed keys must remain
in server-side secret configuration. Review the provider's data terms and
organizational approval before submitting company information. See
[AI provider adapters](../development/ai-providers.md).
