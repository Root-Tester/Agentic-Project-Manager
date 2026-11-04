# Terms of Use

> **Operator action required before relying on these terms.** This is the
> current Terms of Use text in the repository, but it contains deployment
> placeholders and has not been approved for a jurisdiction. The application
> does not display these terms or record user acceptance. The operator must
> complete the marked fields, obtain qualified legal review, and implement any
> required user notice and agreement process before claiming these terms are
> binding on service users.

**ACTION REQUIRED — service operator:** `[Insert legal entity name and contact details]`

**ACTION REQUIRED — effective date:** `[Insert date after legal approval]`

**ACTION REQUIRED — applicable jurisdiction:** `[Complete with legal counsel]`

## 1. Scope

These terms describe conditions for using the Agentic Project Manager hosted
service ("APM"). The operator must identify the legal entity
responsible for the service and publish a deployment-specific
[privacy notice](./privacy-notice.md) before relying on them.

Any hosted-service terms must remain separate from the software license and
must not purport to change it.

## 2. Accounts and access

Company owners and administrators are responsible for keeping account
credentials confidential, assigning access only to authorized people, and
notifying the operator when an account may have been compromised. Users must
provide accurate account details and must not share credentials or attempt to
access another company or account.

Company administrators and HR users are responsible for verifying that they
have authority to enter employee information, provision accounts, set access
roles, and change employment status. Temporary passwords must be delivered
through a private channel and replaced at first sign-in.

The application has no email verification, self-service password
recovery, multi-factor authentication, or email delivery for temporary
credentials. The operator should describe and maintain a secure recovery and
support process before using APM with real company data.

## 3. Acceptable use

Users must use APM lawfully and only for authorized project and workforce
coordination. Users must not:

- attempt to bypass authentication, tenant separation, or role permissions;
- upload malware, unlawful content, or information they are not authorized to
  process;
- interfere with the service, probe it without authorization, or use it to
  violate another person's rights; or
- rely on generated task suggestions or progress metrics as the sole basis
  for employment, disciplinary, compensation, or other consequential
  decisions.

The operator must define a contact and response process for suspected abuse
or security incidents before relying on these terms.

## 4. Company and employee information

APM stores account and company records, employee directory and onboarding
details, project and task documents, discussions, notifications, and limited
audit metadata in the configured SQLite database. The service operator and
company administrators must restrict access to that database and its backups.
The deployment operator is responsible for host security, secret management,
HTTPS, persistence, backup, recovery, and access to infrastructure.

Companies should not enter sensitive personal, health, financial, or
confidential information unless they have established a lawful basis,
appropriate safeguards, and approval for that processing. The operator must
publish an accurate privacy notice covering the deployment, applicable
retention, user rights, and contact information before collecting real data.

## 5. Optional AI features and external providers

If a user invokes task generation, the task prompt may include milestone and
employee details supplied to the feature. Those details are sent to the
selected AI provider for processing. The operator and company are responsible
for selecting an approved provider, reviewing its terms and privacy
practices, and ensuring they have authority to share the submitted data.

Provider availability, model output, and provider-side retention or use are
controlled by the provider's own terms and settings. Generated output may be
incorrect, incomplete, biased, or unsuitable and must be reviewed by a person.

## 6. Storage, retention, and deletion

The hosted application uses a local SQLite database. On deployments without
persistent storage, data may be lost when the service restarts or is replaced.
The service has a configurable logical storage cap. When space is needed, it
may irreversibly purge the oldest eligible messages, notifications, audit
events, or project workspaces and related activity. This automatic cleanup is
not a user-directed deletion or recovery process, and database backups may
retain copies.

The current application does not provide a complete self-service account,
company, or data-deletion workflow. The operator must establish and publish a
retention schedule, deletion request procedure, backup lifecycle, and response
time before using APM as a production service.

## 7. Availability and security

The safeguards and limitations currently documented for APM are described in
the [security readiness guide](../security/readiness.md). They are not a
security certification, independent audit, or guarantee that the service will
be uninterrupted or free from vulnerabilities. The operator must maintain
updates, monitoring, backups, incident response, and secure deployment
configuration.

## 8. Suspension and termination

The operator must specify, with legal counsel, when it may suspend or end
access, how it will notify affected companies, and how the company can export
or request deletion of data. No export or deletion right should be promised
unless the service can fulfill it and the operator has
approved the applicable process.

## 9. Changes and legal review

Before relying on these terms, the operator must complete the marked fields,
confirm the service entity and jurisdiction, reconcile the terms with the
privacy notice and hosting/provider contracts, and implement any required
user notice and acceptance process. Qualified legal counsel must review the
final version, including employment, privacy, consumer, and data-protection
obligations applicable to the deployment. These repository terms are not
currently shown to users and do not record acceptance.
