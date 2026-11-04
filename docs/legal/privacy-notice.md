# Privacy notice

> **Operator action required before relying on this notice.** This is the
> current Privacy Notice text in the repository. It contains deployment
> placeholders and is not displayed by the application, which also does not
> record notice acknowledgement. The operator must complete the marked fields,
> verify actual data flows, and obtain qualified privacy/legal review before
> collecting real user or employee information under this notice.

**ACTION REQUIRED — service operator:** `[Insert legal entity name and contact details]`

**ACTION REQUIRED — effective date:** `[Insert date after review]`

**ACTION REQUIRED — deployment and jurisdiction:** `[Identify the hosted instance and jurisdiction]`

## 1. Who is responsible

The company using APM determines why employee information is entered and is
responsible for confirming that it is authorized to do so. The service
operator is responsible for the hosted application's infrastructure and
handling of information as configured for that deployment.

**ACTION REQUIRED:** The operator must identify the controller and processor
or equivalent legal roles for the specific deployment, name the responsible
legal entities, and provide a privacy contact after review with qualified
counsel.

## 2. Information the application can store

Depending on how a company uses APM, its SQLite database may contain:

- account email addresses, display names, and password hashes;
- company profile, employee ID, work contact, job title, department,
  experience level, employment status, access role, verification, and team
  assignment details;
- project milestones, employee roster data, tasks, assignees, dates, status,
  and estimated effort;
- project discussions, direct messages, notifications, and limited audit
  metadata about selected actions; and
- operational state needed by the application, such as storage-retention
  information.

The application does not connect the browser directly to the database.
Operators must confirm what network and infrastructure metadata their hosting
provider or reverse proxy records; those practices are deployment-specific.

## 3. How information is used

APM uses information to authenticate users, create company and employee
records, enforce tenant roles and permissions, organize teams and project
work, display task progress, deliver discussions and notifications, and
operate the application. Limited audit metadata supports review of selected
changes.

The application does not validate project metrics as employee performance,
attendance, or fitness-for-employment measures. Companies should not use these
metrics as the sole basis for employment decisions.

## 4. Optional AI task generation

If a user requests AI-assisted task generation, the task request can include
the milestone and employee details submitted for that operation. A user-entered
Gemini key is sent to the authenticated backend for the provider request and
is not saved to browser storage or the application database. Server-managed
provider credentials are configured separately by the operator.

The selected external provider processes the submitted request under its own
terms, settings, and retention practices. The operator must identify the
providers enabled by the deployment and link their applicable privacy
information here: **ACTION REQUIRED —** `[List enabled providers and current provider privacy links]`.
Companies should obtain appropriate approval before sending personal,
confidential, or otherwise restricted information to a provider.

## 5. Storage, access, and security

Hosted account and company information is stored in the configured SQLite
database on the application server or its mounted storage. Company roles and
API authorization limit application access by tenant and capability. The app
uses password hashing, signed expiring sessions, input validation,
parameterized SQL, and browser security headers. These measures do not make a
deployment risk-free.

The application does not provide database encryption at rest. Disk,
persistent-volume, backup, host, and infrastructure protections depend on the
operator and hosting provider. Details and current limitations are in the
[security readiness guide](../security/readiness.md).

## 6. Retention and deletion

The deployment operator must set the storage cap and retention practices.
When the configured logical database cap is reached, the application may
irreversibly delete older messages, notifications, audit events, or project
workspaces and related activity to make room. Company accounts, users,
tenants, and memberships are not removed by this capacity cleanup. Backups
may retain data after it is removed from the live database.

The current application does not provide a complete self-service account,
company, or personal-data deletion workflow. The operator must publish the
actual retention period, backup expiration, deletion-request contact, and
procedure for the specific deployment before using real data.
**ACTION REQUIRED:** Publish actual retention durations and backup expiration
times for the deployment; the application does not define those periods.

## 7. User and company requests

Employees should direct questions about why their information is used to
their company administrator or HR contact. The operator must add a contact
address and explain how users can submit access, correction, deletion, or
other privacy requests under the laws that apply to the deployment.

**ACTION REQUIRED:** `[Add the privacy contact, request method, and any
applicable response timelines confirmed by legal counsel.]`

## 8. Updates and contact

**ACTION REQUIRED:** The operator must specify how it will publish changes to
this notice and provide contact details. This notice is not shown in the
application, and the application does not collect acknowledgements.
