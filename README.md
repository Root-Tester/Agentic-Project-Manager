---
title: Agentic Project Manager
emoji: 📋
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
hf_oauth: false
---

# Agentic Project Manager

Agentic Project Manager (APM) helps companies coordinate employee onboarding,
teams, projects, and task progress in one role-aware workspace. It also
includes a separate CLI and workflow templates for supported AI coding
assistants. Optional AI task generation provides suggestions for people to
review; it does not make project or employment decisions.

The hosted app uses a React/Vite web client, a Node.js/Express API, a local
SQLite database, and email/password accounts authenticated with signed JWTs.
The [product overview](./docs/product-overview.md) explains the problem the
software addresses, who it is for, and its limits.

## Requirements

- Node.js 22.13 or newer
- npm
- An API key from a supported provider only if you want AI-assisted task
  generation; ordinary project and onboarding features do not require one

For the technology design, data handling, and security limitations, see
[architecture](./docs/architecture.md),
[security readiness](./docs/security/readiness.md), and the
[hosted deployment guide](./docs/deployment/hosted-app.md). The repository
also contains current [Terms of Use](./docs/legal/terms-of-use.md) and a
[Privacy Notice](./docs/legal/privacy-notice.md). Both contain operator
action items and are not displayed or accepted in the application; complete
the deployment-specific details and review them before relying on them.

## Run the hosted app locally (Windows)

### 1. Install dependencies

Open PowerShell in the repository root and run:

```powershell
npm.cmd ci
```

### 2. Configure the environment

Create a local `.env` from the example:

```powershell
Copy-Item .env.example .env
```

Generate a signing secret:

```powershell
npm.cmd run generate:jwt-secret
```

Copy the generated value to `APM_JWT_SECRET` in `.env`. Never commit this
secret or place it in a `VITE_` variable. The SQLite database is created
automatically at `.data/agentic-project-manager.sqlite`; set
`APM_DATABASE_PATH` to choose another location.

Set `APM_PLATFORM_ADMIN_EMAILS` to a comma-separated list of trusted
administrator email addresses. Keep this setting in `.env` or the hosting
secret/configuration manager, never in the frontend or a committed file. Only
allowlisted addresses can register as platform administrators.

Company owners can register directly only when `APM_PUBLIC_COMPANY_SIGNUP=true`
and the backend SMTP settings documented in
[hosted deployment](./docs/deployment/hosted-app.md) are configured. The owner
must verify the email address before accessing the company. If public signup
is disabled, an allowlisted platform administrator must create the company.

The database, its WAL files, and `.env` are ignored by Git. Only schema code
and synthetic seed data may be versioned. Do not push actual users, password
hashes, messages, or project records to GitHub.

Run the configuration check without exposing secret values:

```powershell
npm.cmd run doctor
```

Local development uses HTTP on loopback. A remote deployment must use the
hosting platform's HTTPS endpoint to protect passwords and bearer tokens in
transit. JWT authentication does not replace HTTPS or encrypt network traffic.

### 3. Start the API and frontend

Use two PowerShell terminals in the repository root.

**Terminal 1 — API and backend server:**

```powershell
npm.cmd run dev
```

The API creates/opens the SQLite database and listens on port `4000`. Check
its health at `http://127.0.0.1:4000/healthz`.

**Terminal 2 — hosted frontend:**

```powershell
npm.cmd run start:web
```

Open `http://127.0.0.1:3000` for the landing page. Use **Explore demo** to
view the synthetic, read-only sample company without credentials. If public
company signup is enabled, choose **Create company**, submit the company and
owner details, and verify the owner email from the delivered link. Otherwise,
an allowlisted platform administrator creates the company and its first
owner. Company HR provisions employees, whose temporary passwords must be
changed at first sign-in. HR managers verify new hires and organize them into
teams. HR can update verified employees' working, leave, retired, or fired
status; non-working status disables that employee's access to the company.
Manager dashboards show project and task evidence, not automated employee
ratings or employment decisions. Public individual/personal-workspace signup
is disabled. The frontend proxies API calls to port `4000`. Stop either
server with **Ctrl+C**.

Gemini keys entered in the task-generation UI are held in page memory and sent
to the authenticated backend for provider requests; they are not saved to
browser storage or the application database. Provider requests may include
the milestone and employee details submitted for task generation. See the
[security readiness guide](./docs/security/readiness.md) before using real
company information with an external provider.

## Hugging Face Spaces

The Space runs the Dockerfile on port 7860. Set `APM_JWT_SECRET` as a Space
secret and `APM_PLATFORM_ADMIN_EMAILS` as a Space variable containing only
trusted platform administrator addresses. Enable persistent storage mounted
at `/data` if you need database records to survive container replacement.
The image defaults `APM_DATABASE_PATH` to
`/data/agentic-project-manager.sqlite`. Without a
persistent mount, data may be lost when the Space restarts or rebuilds.

Spaces provide HTTPS at the public endpoint; no user-managed TLS certificate
is needed. Treat the JWT secret and mounted database as private. Back up the
SQLite database, including a consistent snapshot of its WAL state, before
updates or migrations.

The public **Explore demo** button opens a separate synthetic company with
viewer-only access. It does not expose customer/company records or provide a
shared login/password. The demo is for safe product exploration, not for
testing write operations or AI generation.

## Tests and builds

Run the test suite and build the frontend and CLI release bundle:

```powershell
npm.cmd test
npm.cmd run build:web
npm.cmd run build
```

The frontend production files are written to `frontend/dist/`.

## Other project documentation

- [Project architecture](./docs/architecture.md)
- [Product overview](./docs/product-overview.md)
- [Development guide](./docs/development/README.md)
- [AI provider configuration](./docs/development/ai-providers.md)
- [Hosted app deployment and SQLite storage](./docs/deployment/hosted-app.md)
- [Security readiness](./docs/security/readiness.md)
- [Terms of Use](./docs/legal/terms-of-use.md)
- [Privacy Notice](./docs/legal/privacy-notice.md)
- [Standalone skills](./skills/README.md)

The hosted app is separate from the CLI and local task manager. See the
architecture and deployment guides for their differences and configuration.
