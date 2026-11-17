/**
 * System Legal, Privacy, and Security Policies
 * Defines the terms of service, privacy notice, user policy, and security standards
 * enforced across the Agentic Project Manager (APM) platform.
 */

export const POLICIES_VERSION = '2026-11-17';

export function getSecurityAndUserPolicies() {
  return {
    version: POLICIES_VERSION,
    effectiveDate: '2026-11-17',
    termsOfService: {
      title: 'Terms of Service & Acceptable Use Policy',
      lastUpdated: '2026-11-17',
      summary: 'Rules and requirements governing the use of the Agentic Project Manager hosted service.',
      sections: [
        {
          heading: '1. Acceptance of Terms',
          body: 'By registering an account, signing in, or using the Agentic Project Manager (APM) platform, you agree to comply with and be bound by these Terms of Service, Privacy Policy, and Security Policy. If you are accepting on behalf of an organization, you represent and warrant that you have full authority to bind that entity.'
        },
        {
          heading: '2. Account Security & Credential Protection',
          body: 'Users and company administrators are strictly responsible for maintaining credential confidentiality. Passwords must meet or exceed complexity requirements and are hashed using industry-standard bcrypt. Temporary passwords provided during employee onboarding must be securely transmitted and replaced upon initial login. Sharing accounts or attempting unauthorized access to other tenants is prohibited.'
        },
        {
          heading: '3. Acceptable Use Policy',
          body: 'You agree not to: (a) attempt to bypass authentication, tenant separation, or role-based access control; (b) upload malicious code, unauthorized personal data, or unlawful material; (c) probe, scan, or test the vulnerability of the system without authorization; (d) use AI-assisted generation outputs as the sole determining factor for employment, compensation, or termination decisions.'
        },
        {
          heading: '4. Tenant Isolation & Company Data',
          body: 'All project data, employee rosters, milestones, discussions, and audit logs are isolated strictly within tenant boundaries. Companies retain ownership of their content. The system maintains tenant segregation and transactional consistency in persistent storage.'
        },
        {
          heading: '5. AI Provider Integrations',
          body: 'When optional AI features (such as task generation) are invoked, project context is sent to the selected external model provider (Google Gemini, OpenAI, or Anthropic). Request-scoped credentials are never persisted to disk without encryption.'
        }
      ]
    },
    privacyPolicy: {
      title: 'Privacy Notice & Data Protection Policy',
      lastUpdated: '2026-11-17',
      summary: 'How user and organizational data is processed, stored, and protected in the APM platform.',
      sections: [
        {
          heading: '1. Information We Collect and Store',
          body: 'The platform stores only information necessary to deliver project management services: user email addresses, display names, bcrypt password hashes, tenant affiliations, employee records (job title, department, experience level, employment status), milestones, tasks, team discussions, and operational audit events.'
        },
        {
          heading: '2. Data Minimization & Security',
          body: 'Passwords are never stored in plaintext and are hashed using bcrypt with salt rounds. Access tokens are short-lived (2 hours) and stored in client memory rather than persistent browser storage. Sensitive configuration secrets and request keys are protected using AES-256-GCM authenticated encryption.'
        },
        {
          heading: '3. Data Sharing & Third Parties',
          body: 'We do not sell, rent, or track user data across third-party networks. Data is only communicated to external services when an authenticated user explicitly configures and initiates AI provider requests.'
        },
        {
          heading: '4. Retention and Storage Limits',
          body: 'Tenant data is maintained in isolated SQLite transactional databases. Bounded retention mechanisms purge oldest eligible activity records when configured storage caps are approached, preserving core company and project structures.'
        }
      ]
    },
    securityPolicy: {
      title: 'Security Architecture & Defense-in-Depth Policy',
      lastUpdated: '2026-11-17',
      summary: 'Security controls, encryption standards, and threat mitigation practices implemented across the application.',
      sections: [
        {
          heading: '1. Password Hashing with Bcrypt',
          body: 'User authentication employs bcrypt (cost factor 12) for salted, adaptive password hashing, protecting credentials against offline rainbow table and dictionary attacks. Legacy scrypt hashes remain verified through timing-safe comparison until updated.'
        },
        {
          heading: '2. Authenticated Encryption at Rest & In-Transit',
          body: 'Application secrets, sensitive tokens, and payload secrets are encrypted using authenticated AES-256-GCM with distinct initialization vectors (IVs) and integrity authentication tags. Network communication enforces TLS/HTTPS and restrictive transport headers.'
        },
        {
          heading: '3. Role-Based Access Control (RBAC) & Least Privilege',
          body: 'The API enforces tenant-scoped authorization on every request. Responsibility profiles (HR, Manager, Team Leader, Engineer, Administrator) grant explicit capabilities within the organization ceiling. Hiding UI elements is never treated as a security boundary.'
        },
        {
          heading: '4. Browser & Network Hardening',
          body: 'The server sets comprehensive security headers including Content-Security-Policy (CSP), X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, and X-Permitted-Cross-Domain-Policies to mitigate XSS, clickjacking, and injection vulnerabilities.'
        },
        {
          heading: '5. Rate Limiting & Brute-Force Defense',
          body: 'Authentication endpoints (registration, sign-in, password change) and write-intensive routes are protected by rate limiters to deter credential stuffing, brute-force attacks, and denial-of-service attempts.'
        },
        {
          heading: '6. Immutable Audit Trail',
          body: 'Security-relevant events—such as employee onboarding, status updates, team assignments, and permission changes—are recorded in a structured audit log containing actor identity, tenant context, timestamp, and action metadata.'
        }
      ]
    }
  };
}
