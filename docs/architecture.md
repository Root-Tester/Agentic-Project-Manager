# Project architecture

APM combines a company project-management web application with a separate CLI
and assistant-workflow release builder. The web application coordinates
company accounts, HR onboarding, teams, projects, tasks, discussions, and
delivery progress. The CLI and workflow templates are separate product
components; they do not share the hosted application's SQLite database.

## Repository map

```text
backend/
  src/
    api/                      Hosted REST routes and authentication/tenant middleware
    config/                   Server-side environment validation
    services/                 Hosted application use cases
    storage/sqlite/           SQLite schema, connection, and repositories
    storage/cache/            Bounded process-local cache
frontend/
  src/
    api/                      Bearer-authenticated API client
    app/                      React application shell and session
    pages/ components/ styles/
  vite.config.js              Frontend dev proxy and independent production bundle
cli/
  src/
    commands/                 APM CLI adapters
    core/ services/ ui/       Existing CLI operations and local user interface
    web/frontend/             Compatibility UI used by the local CLI server
shared/
  ai/
    index.js                  Provider selection shared by CLI and API
    providers/                Gemini, OpenAI, Anthropic adapters
  schemas/                    Task and employee contracts shared by CLI/API
build/
  core/                      Build configuration and errors
  generators/                Release manifest and ZIP generation
  processors/                Template parsing and bundle assembly
  utils/                     Build-only utilities
plugins/
  assistant-platforms/       One JSON build-target manifest per platform
templates/
  agents/ commands/ guides/ skills/ apm/
                             Release content, not application source
docs/
  deployment/                Deployment and database setup
  development/               Contributor standards and extension guides
tests/
  unit/                      Isolated validation and service tests
  integration/               CLI and local HTTP API behavior tests
.github/workflows/           GitHub Actions automation
package.json                 CLI entry points and shared runtime/build dependencies
package-lock.json            Reproducible npm dependency graph
```

The repository is a layered Node.js application, not a multi-package workspace.
`cli/src/index.js` is the CLI entry point and imports command adapters from
`cli/src/commands/`. `build/` and `templates/` are separate on purpose:
application code manages installations, while the build system transforms
Markdown source templates into assistant-specific release archives.

## Technology choices

These points explain how the current design fits the deployment; they are not
claims that the project completed a formal benchmark against every alternative.

- **Node.js 22 and JavaScript modules:** one runtime supports the API, CLI,
  shared validation/provider code, and release tooling. Node's built-in
  `node:sqlite` module avoids a separate database server or a native SQLite
  package for the hosted single-instance deployment.
- **Express:** provides the JSON API and middleware boundary for authentication,
  tenant membership, permissions, request validation, and response handling.
- **React and Vite:** provide the interactive browser application and a
  production bundle that can be served by the API or hosted separately behind
  a same-origin proxy.
- **SQLite:** stores hosted accounts, companies, memberships, employee
  onboarding, teams, workspaces, task documents, discussions, notifications,
  and audit events in a local database file. Transactions and tenant-scoped
  queries suit a small, single API instance without requiring a managed
  database service. SQLite is not a shared database for independently
  replicated API instances; multi-instance deployments need a different
  shared transactional storage design. The CLI has separate file-backed
  storage by default and can optionally use MongoDB when explicitly
  configured; that adapter is not used by the hosted web application.
- **HS256 JWTs and `scrypt`:** provide signed, time-limited bearer sessions and
  password hashing without an external identity provider. JWT signatures do
  not encrypt traffic; remote use still requires HTTPS.
- **Docker:** packages the web app and API for a container platform such as
  Hugging Face Spaces. Persistent storage must be configured separately from
  the image for data to survive container replacement.

## Runtime flow

```text
Hosted browser -> Vite/static frontend -> Node API -> SQLite
                                      |-> signed JWT account sessions
                                      `-> shared AI provider adapters

CLI entry -> command adapter -> task/release services
                         |-> shared AI provider adapters
                         |-> CLI-owned local workspace storage
                         `-> local web server -> compatibility UI
```

- `cli/src/commands/` owns CLI options, terminal interaction, and command-level
  orchestration. Its compatibility UI remains at `cli/src/web/`.
- `shared/schemas/` validates task and employee data at both CLI and API
  boundaries. CLI-only release schema remains with CLI code.
- `shared/ai/` selects a hosted model provider; each adapter implements the same
  `generate(prompt, model, apiKey)` contract. The hosted backend owns its
  provider secrets while the local CLI may use locally configured keys.
  Provider adapters send generation requests to the selected external service.
  See [AI provider adapters](./development/ai-providers.md).
- `backend/src/storage/sqlite/` stores hosted accounts, company profiles,
  memberships, employee onboarding records, teams, workspaces, documents,
  conversations, messages, notifications, and audit events. SQL
  values use prepared statements; tenant and workspace keys scope queries.
  `backend/src/storage/cache/` provides a bounded cache keyed by tenant,
  workspace, and document type. The CLI's optional store remains isolated
  under `cli/src/storage/`.
- `backend/src/api/` is the hosted REST backend. `frontend/` is a separately
  built React/Vite app; `cli/src/web/` is the local compatibility UI. Neither
  frontend receives database credentials or the JWT signing secret.
- Public individual signup is disabled. A server-side email allowlist controls
  platform administrator bootstrap; those administrators create company
  profiles and their first owner. HR provisions employee accounts with a
  one-time temporary password; HR managers verify pending hires before company
  access is activated. Signed bearer JWTs are kept in frontend memory and are
  not an encryption or transport-security mechanism.
- `shared/organization/job-catalog.js` provides company-type-specific job title
  and department choices. Company employee access, verification, team
  assignment, and organization progress routes live under the tenant API and
  are authorized server-side. The public demo uses a separate synthetic,
  viewer-only company tenant.
- `cli/src/services/` contains local release, GitHub, archive, and cleanup
  operations.
- Task workflow status is shared across the CLI and hosted API: `not-started`,
  `just-started`, `in-progress`, `testing`, `debugging`, `client-review`,
  `completed`, and `blocked`. Legacy `pending` values are presented as
  `not-started` and are stored canonically on the next save. Task priority is a
  separate field and remains the grouping used by the local Kanban columns.
- Hosted members retain the organization access role (`owner`, `admin`,
  `editor`, or `viewer`) and may separately receive a responsibility profile
  and job/department metadata. A profile tailors the interface and grants only
  its explicit capabilities within the organization's role ceiling. Owner and
  admin roles keep their administrative access; a title such as CEO, HR, or
  database administrator does not itself grant administrator rights.
- Responsibility profiles are defined in
  `shared/access/capabilities.js`. Built-ins cover project management,
  executives, HR, backend/frontend development, cybersecurity, system
  administration, and database administration. The API checks capabilities
  after membership verification; hiding a page or control is not the security
  boundary. Existing members with no profile keep their existing organization
  role behavior.
- Hosted project rooms and member-to-member direct messages are scoped by
  tenant and workspace. Messages and threaded replies are stored separately
  from workspace task documents. Authenticated Server-Sent Events deliver
  message updates by polling a tenant/workspace-scoped SQLite index; deployment
  proxies must allow long-lived event-stream responses and disable buffering.
  In-app notification counts refresh periodically; no email provider is used.
- Audit events record the actor, tenant/workspace, event type, target, and
  limited metadata for task-status, member/permission, and message changes.
  Message bodies are not copied to the audit stream. Audit access requires the
  `audit:read` capability. A storage-cap cleanup mechanism can purge old audit
  events and other eligible activity; this is not a complete organization
  retention schedule or user-directed deletion workflow.
- Workflow KPIs are derived from task documents: status counts, completion
  rate, blocked/overdue tasks, and assignee task/hour totals. They are project
  delivery measures, not HR performance or attendance scores.
- The KPI endpoint keeps its tenant-wide response when `workspaceId` is
  omitted. Supplying a workspace ID scopes the response and adds a capacity
  forecast based on unique assigned employees. Employee `experience_level`
  values may be `fresher`, `mid-level`, or `senior`; missing or unknown values
  use the mid-level baseline. Forecast capacity assumes 8 hours per person per
  weekday with proficiency multipliers of 0.75, 1.0, and 1.25. It does not
  rewrite estimated task effort or dates and can show a projected window beyond
  the milestone target.

## Build plugins and release content

`build/build-config.json` contains shared build settings. Each JSON manifest in
`plugins/assistant-platforms/` registers one assistant target. The build loader
sorts manifests by filename, validates the combined target list, and produces
archives in `dist/`.

The manifests are data-driven plugins, not executable code. Add a new target by
copying a manifest, changing its `id`, and providing the platform-specific
directories and guidance. See [Plugin development](./development/plugins.md).
The GitHub workflow remains in `.github/workflows/`, where GitHub Actions
expects it.

## Dependency boundaries

Runtime packages are declared in `dependencies`; build and test-only packages
are in `devDependencies`. Keep `package.json` and `package-lock.json` at the
repository root so local development, CI, and npm installation use one
reproducible dependency graph. The frontend build uses Rollup's official
WebAssembly package rather than a platform-native binary. Do not commit
credentials; use environment variables or the deployment platform's secret
manager.
