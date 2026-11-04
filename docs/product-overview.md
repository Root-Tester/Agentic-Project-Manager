# Product overview

## What APM is

Agentic Project Manager (APM) is a project and team coordination tool for
companies. It brings company setup, employee onboarding, team organization,
project tasks, and delivery progress into one company environment. Optional
AI-assisted task generation can turn a milestone and team information into a
proposed task list; people review and manage the resulting work.

The hosted web application is company-first. Depending on deployment
configuration, an allowlisted platform administrator can create a company and
its first owner, or a company owner can register directly and verify their
email before accessing the new company. Company administrators and HR
provision employees. An HR manager or company administrator reviews new hires
before their company access is activated. Approved employees can be organized
into teams and associated with project workspaces.

## The problem it addresses

Project details, staff directories, task ownership, and progress updates are
often kept in separate tools or informal documents. That makes it harder for
company owners, HR, managers, and team members to share a consistent view of
who is working on what.

APM is designed to provide a shared, role-aware view of those workflows:

- Company owners and administrators set up the company and control access.
- HR adds hires and maintains employee records.
- HR managers review submitted hires and organize approved employees into
  teams.
- Managers and team leaders can review the projects and task progress made
  visible to their role.
- Employees use assigned project work, discussions, and task status to
  coordinate delivery.

## What the software does not decide

APM reports project and task information as work evidence. Its progress views
are not validated measures of individual performance, attendance, or fitness
for employment. The current software does not implement team-member complaints,
formal HR investigations, or transfer/removal case decisions. A company must
use its own fair, documented human review and employment procedures.

Optional AI-generated tasks are suggestions, not approved work instructions.
Users should check generated content for accuracy, safety, confidentiality,
and suitability before relying on or sharing it.

## Main parts of the repository

- **Hosted web app:** company accounts, employee onboarding, teams, projects,
  tasks, discussions, and role-aware progress views.
- **Hosted API:** validates authentication, tenant membership, permissions,
  and data before accessing company records.
- **CLI and release templates:** separate tools for installing and managing
  reusable project-management workflows in supported AI coding assistants.
- **Shared task and provider modules:** task data contracts and optional
  Gemini, OpenAI, and Anthropic integrations used by supported workflows.

## Intended use

Use APM to organize project work, onboard and group employees, and review
delivery information. Do not treat generated task suggestions or dashboard
metrics as the sole basis for HR, compensation, disciplinary, hiring, or
termination decisions. Do not enter sensitive personal or company information
unless the organization has approved the use of the application and any
selected AI provider for that information.

For the technology and deployment design, see
[Project architecture](./architecture.md). For setup and operational
responsibilities, see the [hosted deployment guide](./deployment/hosted-app.md)
and [security readiness guide](./security/readiness.md).
