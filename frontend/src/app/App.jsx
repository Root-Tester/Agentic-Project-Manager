import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { registerPlatformAdmin, signIn, startDemo, updatePassword } from '../auth.js';
import { normalizeTaskStatuses, TASK_STATUSES } from '../../../shared/schemas/tasks.js';
import { RESPONSIBILITY_PROFILES } from '../../../shared/access/capabilities.js';
import { COMPANY_TYPES } from '../../../shared/organization/job-catalog.js';
import { EmployeeRoster, InAppNotifications, WorkspaceFeaturePanel } from './WorkspaceFeatures.jsx';

const DOCUMENT_TYPES = ['milestone', 'employees', 'tasks'];
const EMPTY_DOCUMENTS = { milestone: null, employees: null, tasks: { tasks: [] } };

function pretty(value) {
  return value == null ? '' : JSON.stringify(value, null, 2);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('landing');
  const [authEmail, setAuthEmail] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [companyForm, setCompanyForm] = useState({
    name: '', companyType: 'technology', website: '', ownerName: '', ownerEmail: ''
  });
  const [ownerCredentials, setOwnerCredentials] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [documents, setDocuments] = useState(EMPTY_DOCUMENTS);
  const [editors, setEditors] = useState({ milestone: '', employees: '[]', tasks: '{\n  "tasks": []\n}' });
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState([]);
  const [modelStatus, setModelStatus] = useState('');
  const [model, setModel] = useState('');
  const modelRequestId = useRef(0);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const geminiApiKeyRef = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState(null);
  const [activeView, setActiveView] = useState('overview');
  const selectedTenant = useMemo(() => tenants.find(tenant => tenant.tenantId === tenantId), [tenants, tenantId]);
  const selectedWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.workspaceId === workspaceId),
    [workspaces, workspaceId]
  );
  const can = capability => access?.capabilities?.includes('*') ||
    access?.capabilities?.includes(capability);
  const canViewOrganizationOverview = ['owner', 'admin'].includes(access?.role) ||
    ['hr-manager', 'manager', 'team-leader', 'demo-readonly'].includes(access?.capabilityProfile);
  const providerOptions = useMemo(() => providers.some(item => item.id === 'gemini')
    ? providers
    : [{ id: 'gemini', name: 'Google Gemini' }, ...providers], [providers]);
  const viewOptions = [
    ...(can('kpi:read') && can('people:read') && canViewOrganizationOverview
      ? [{ id: 'org-overview', label: 'Company overview' }]
      : []),
    ...(can('kpi:read') ? [{ id: 'overview', label: 'Overview' }] : []),
    ...(can('workspace:read') ? [{ id: 'projects', label: 'Projects' }] : []),
    ...(can('discussions:read') ? [{ id: 'discussions', label: 'Discussions' }] : []),
    ...(can('members:read') ? [{ id: 'people', label: 'People & access' }] : []),
    ...(can('audit:read') ? [{ id: 'audit', label: 'Audit history' }] : []),
    ...((can('system:read') || can('database:read'))
      ? [{ id: 'operations', label: 'Operations' }]
      : [])
  ];

  const loadTenants = useCallback(async activeUser => {
    const result = await apiRequest('/tenants', activeUser.access_token);
    setTenants(result.tenants);
    setTenantId(current => result.tenants.some(item => item.tenantId === current)
      ? current
      : result.tenants[0]?.tenantId || '');
  }, []);

  useEffect(() => {
    if (!user || !tenantId) {
      setProviders([]);
      setProvider('');
      setModels([]);
      setModel('');
      return;
    }
    let active = true;
    apiRequest(`/tenants/${encodeURIComponent(tenantId)}/ai/providers`, user.access_token)
      .then(result => {
        if (!active) return;
        setProviders(result.providers);
        setProvider(current => result.providers.some(item => item.id === current)
          ? current
          : result.providers[0]?.id || 'gemini');
        if (!result.providers.some(item => item.id === 'gemini')) {
          setModelStatus('Enter your Gemini API key to load available models.');
        }
      })
      .catch(cause => active && setError(cause.message));
    return () => { active = false; };
  }, [user, tenantId]);

  useEffect(() => {
    geminiApiKeyRef.current = '';
    setGeminiApiKey('');
    setModels([]);
    setModel('');
    setModelStatus('');
  }, [tenantId, user?.profile?.sub]);

  useEffect(() => {
    if (!user || !tenantId) {
      setAccess(null);
      return;
    }
    let active = true;
    apiRequest(`/tenants/${encodeURIComponent(tenantId)}/access`, user.access_token)
      .then(result => {
        if (!active) return;
        setAccess(result);
        const defaultView = ['hr-manager', 'manager', 'team-leader'].includes(result.capabilityProfile)
          ? 'org-overview'
          : result.capabilityProfile === 'backend-developer' ||
          result.capabilityProfile === 'frontend-developer'
          ? 'projects'
          : result.capabilityProfile === 'cybersecurity' ||
            result.capabilityProfile === 'database-administrator'
            ? 'audit'
            : 'overview';
        setActiveView(defaultView);
      })
      .catch(cause => active && setError(cause.message));
    return () => { active = false; };
  }, [user, tenantId]);

  useEffect(() => {
    if (viewOptions.length && !viewOptions.some(view => view.id === activeView)) {
      setActiveView(viewOptions[0].id);
    }
  }, [activeView, access]);

  const refreshModels = useCallback(async () => {
    if (!user || !tenantId || !provider) return;
    const apiKey = provider === 'gemini' ? geminiApiKeyRef.current.trim() : '';
    const hasBackendKey = providers.some(item => item.id === provider);
    if (!apiKey && !hasBackendKey) {
      setModels([]);
      setModel('');
      setModelStatus('Enter your Gemini API key to load available models.');
      return;
    }
    const requestId = ++modelRequestId.current;
    setModelStatus(apiKey
      ? 'Loading models available to your Gemini key…'
      : 'Loading models available to the backend API key…');
    try {
      const result = await apiRequest(
        `/tenants/${encodeURIComponent(tenantId)}/ai/models?provider=${encodeURIComponent(provider)}`,
        user.access_token,
        { method: 'POST', body: JSON.stringify(apiKey ? { apiKey } : {}) }
      );
      if (requestId !== modelRequestId.current) return;
      setModels(result.models);
      setModel(current => result.models.some(item => item.id === current)
        ? current
        : result.models[0]?.id || '');
      setModelStatus(`${result.models.length} available models loaded.`);
    } catch (cause) {
      if (requestId !== modelRequestId.current) return;
      setModels([]);
      setModel('');
      setModelStatus(cause.message);
    }
  }, [user, tenantId, provider, providers]);

  useEffect(() => {
    if (provider && providers.some(item => item.id === provider)) refreshModels();
  }, [provider, providers, refreshModels]);

  useEffect(() => {
    if (!user || !tenantId) {
      setWorkspaces([]);
      setWorkspaceId('');
      return;
    }
    let active = true;
    setBusy(true);
    apiRequest(`/tenants/${encodeURIComponent(tenantId)}/workspaces`, user.access_token)
      .then(result => {
        if (!active) return;
        setWorkspaces(result.workspaces);
        setWorkspaceId(current => result.workspaces.some(item => item.workspaceId === current)
          ? current
          : result.workspaces[0]?.workspaceId || '');
      })
      .catch(cause => active && setError(cause.message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [user, tenantId]);

  const loadDocuments = useCallback(async () => {
    if (!user || !tenantId || !workspaceId) {
      setDocuments(EMPTY_DOCUMENTS);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest(
        `/tenants/${encodeURIComponent(tenantId)}/workspaces/${encodeURIComponent(workspaceId)}/documents`,
        user.access_token
      );
      const next = { ...EMPTY_DOCUMENTS, ...result.documents };
      next.tasks = normalizeTaskStatuses(next.tasks || { tasks: [] });
      setDocuments(next);
      setEditors({
        milestone: pretty(next.milestone),
        employees: pretty(next.employees || []),
        tasks: pretty(next.tasks || { tasks: [] })
      });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }, [user, tenantId, workspaceId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  async function createWorkspace(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/tenants/${encodeURIComponent(tenantId)}/workspaces`, user.access_token, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: workspaceSlug, name: workspaceName })
      });
      setWorkspaceName('');
      setWorkspaceSlug('');
      const result = await apiRequest(`/tenants/${encodeURIComponent(tenantId)}/workspaces`, user.access_token);
      setWorkspaces(result.workspaces);
      setWorkspaceId(workspaceSlug);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDocuments() {
    setBusy(true);
    setError('');
    try {
      const editableTypes = DOCUMENT_TYPES.filter(type => ({
        milestone: can('workspace:write'),
        employees: can('people:write'),
        tasks: can('tasks:write')
      })[type]);
      const values = {};
      for (const type of editableTypes) {
        values[type] = type === 'tasks'
          ? normalizeTaskStatuses(JSON.parse(editors[type]))
          : JSON.parse(editors[type]);
      }
      for (const type of editableTypes) {
        await apiRequest(
          `/tenants/${encodeURIComponent(tenantId)}/workspaces/${encodeURIComponent(workspaceId)}/documents/${type}`,
          user.access_token,
          { method: 'PUT', body: JSON.stringify({ value: values[type] }) }
        );
      }
      setDocuments(current => ({ ...current, ...values }));
      if (values.tasks) {
        setEditors(current => ({ ...current, tasks: pretty(values.tasks) }));
      }
    } catch (cause) {
      setError(cause instanceof SyntaxError ? `Invalid JSON: ${cause.message}` : cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEmployeeRoster() {
    if (!user || !can('people:write') || !tenantId || !workspaceId || busy) return;
    setBusy(true);
    setError('');
    try {
      const employees = JSON.parse(editors.employees);
      if (!Array.isArray(employees)) throw new Error('Employee data must be a JSON array.');
      await apiRequest(
        `/tenants/${encodeURIComponent(tenantId)}/workspaces/${encodeURIComponent(workspaceId)}/documents/employees`,
        user.access_token,
        { method: 'PUT', body: JSON.stringify({ value: employees }) }
      );
      setDocuments(current => ({ ...current, employees }));
      setEditors(current => ({ ...current, employees: pretty(employees) }));
    } catch (cause) {
      setError(cause instanceof SyntaxError
        ? `Invalid employee JSON: ${cause.message}`
        : cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateTaskStatus(taskId, status) {
    if (!user || !can('tasks:write') || busy) return;
    let taskDocument;
    try {
      taskDocument = normalizeTaskStatuses(JSON.parse(editors.tasks));
    } catch (cause) {
      setError(`Invalid task JSON: ${cause.message}`);
      return;
    }
    const task = taskDocument?.tasks?.find(item => item && typeof item === 'object' && item.task_id === taskId);
    if (!task || !TASK_STATUSES.includes(status)) return;
    task.status = status;
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        `/tenants/${encodeURIComponent(tenantId)}/workspaces/${encodeURIComponent(workspaceId)}/documents/tasks`,
        user.access_token,
        { method: 'PUT', body: JSON.stringify({ value: taskDocument }) }
      );
      setDocuments(current => ({ ...current, tasks: taskDocument }));
      setEditors(current => ({ ...current, tasks: pretty(taskDocument) }));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  const taskDocumentForStatus = useMemo(() => {
    try {
      const document = normalizeTaskStatuses(JSON.parse(editors.tasks));
      return Array.isArray(document?.tasks) ? document : null;
    } catch {
      return null;
    }
  }, [editors.tasks]);

  const employeeRoster = useMemo(() => {
    try {
      const employees = JSON.parse(editors.employees);
      return Array.isArray(employees) ? employees : null;
    } catch {
      return null;
    }
  }, [editors.employees]);

  async function generateTasks() {
    if (!can('tasks:write') || !can('people:read') || !can('workspace:read')) return;
    if (!provider || !model) {
      setError('Select an available AI provider and model before generating tasks.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const milestone = JSON.parse(editors.milestone);
      const roster = JSON.parse(editors.employees);
      if (!Array.isArray(roster)) throw new Error('Employee data must be a JSON array.');
      const employees = roster.filter(employee =>
        !employee.employment_status || employee.employment_status === 'working'
      );
      if (!employees.length) {
        throw new Error('Add at least one currently working employee before generating tasks.');
      }
      const result = await apiRequest(
        `/tenants/${encodeURIComponent(tenantId)}/workspaces/${encodeURIComponent(workspaceId)}/tasks/generate`,
        user.access_token,
        {
          method: 'POST',
          body: JSON.stringify({
            milestone,
            employees,
            provider,
            model,
            ...(provider === 'gemini' && geminiApiKeyRef.current.trim()
              ? { apiKey: geminiApiKeyRef.current.trim() }
              : {})
          })
        }
      );
      setDocuments(current => ({ ...current, tasks: result }));
      setEditors(current => ({ ...current, tasks: pretty(result) }));
    } catch (cause) {
      setError(cause instanceof SyntaxError ? `Invalid JSON: ${cause.message}` : cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAccount(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = authMode === 'register'
        ? await registerPlatformAdmin({
          email: authEmail,
          displayName: authName,
          password: authPassword
        })
        : await signIn(authEmail, authPassword);
      setAuthPassword('');
      setUser(session);
      if (!session.must_change_password) await loadTenants(session);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function enterDemo() {
    setBusy(true);
    setError('');
    try {
      const session = await startDemo();
      setUser(session);
      await loadTenants(session);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await updatePassword(user.access_token, newPassword);
      setNewPassword('');
      setUser(session);
      await loadTenants(session);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCompany(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setOwnerCredentials(null);
    try {
      const result = await apiRequest('/platform/companies', user.access_token, {
        method: 'POST',
        body: JSON.stringify(companyForm)
      });
      setOwnerCredentials(result.ownerCredentials);
      setCompanyForm({ name: '', companyType: 'technology', website: '', ownerName: '', ownerEmail: '' });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setUser(null);
    setTenants([]);
    setTenantId('');
    setWorkspaces([]);
    setWorkspaceId('');
    setAccess(null);
    setOwnerCredentials(null);
    setAuthMode('landing');
  }

  if (!user && authMode === 'landing') {
    return (
      <main className="landing-page">
        <nav className="landing-nav">
          <a className="landing-brand" href="/" aria-label="Agentic Project Manager home">
            <span aria-hidden="true">APM</span><strong>Agentic Project Manager</strong>
          </a>
          <div className="actions">
            <button className="secondary" onClick={() => { setAuthMode('login'); setError(''); }}>Sign in</button>
            <button onClick={enterDemo} disabled={busy}>{busy ? 'Opening demo…' : 'Explore demo'}</button>
          </div>
        </nav>
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="eyebrow">PLAN · ASSIGN · DELIVER</p>
            <h1>One workspace for your people, projects, and progress.</h1>
            <p>Agentic Project Manager helps teams organize company work, assign responsibilities, follow task status, and keep project conversations together.</p>
            <div className="actions">
              <button onClick={enterDemo} disabled={busy}>{busy ? 'Opening demo…' : 'Try the read-only demo'}</button>
              <button className="secondary" onClick={() => { setAuthMode('login'); setError(''); }}>Team sign in</button>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <small>Guest demo user: <strong>Guest Demo · viewer-only</strong>. Demo data is synthetic and read-only; no shared password is required. Sign in with credentials provided by your company administrator.</small>
          </div>
          <div className="landing-preview" aria-label="Product capabilities preview">
            <div className="preview-top"><span>COMPANY WORKSPACE</span><span className="preview-live">● SAMPLE</span></div>
            <h2>Project delivery</h2>
            <div className="preview-progress"><span style={{ width: '68%' }} /></div>
            <div className="preview-stats"><span>Tasks<strong>12</strong></span><span>In progress<strong>5</strong></span><span>Completed<strong>6</strong></span></div>
            <ul><li><i className="status-dot done" /> Product planning <b>Complete</b></li><li><i className="status-dot active" /> Dashboard delivery <b>In progress</b></li><li><i className="status-dot review" /> Quality review <b>Testing</b></li></ul>
          </div>
        </section>
        <section className="landing-section">
          <header><p className="eyebrow">BUILT FOR SHARED DELIVERY</p><h2>Tools to move work forward</h2></header>
          <div className="landing-features">
            <article><span>01</span><h3>Company and team access</h3><p>Company administrators provision accounts. HR maintains employee records and HR managers verify hires and organize teams.</p></article>
            <article><span>02</span><h3>Project workflow</h3><p>Keep milestones, team assignments, task owners, estimates, dependencies, and progress statuses in one workspace.</p></article>
            <article><span>03</span><h3>Team collaboration</h3><p>Use project discussions and direct messages to clarify questions and coordinate delivery with teammates.</p></article>
            <article><span>04</span><h3>Role-aware dashboards</h3><p>Owners, HR, managers, team leaders, and employees get views and actions matched to their company responsibilities.</p></article>
          </div>
        </section>
        <section className="landing-section how-to">
          <header><p className="eyebrow">GETTING STARTED</p><h2>How to use the workspace</h2></header>
          <ol>
            <li><strong>Company setup</strong><span>A platform administrator creates the company and its first owner. Company staff do not create personal workspaces.</span></li>
            <li><strong>People and teams</strong><span>HR adds a hire and shares the one-time password securely. The employee changes it at first sign-in; an HR manager verifies and assigns the employee.</span></li>
            <li><strong>Plan the project</strong><span>Open a workspace, enter milestone and project details, maintain the team roster, then add tasks or generate a task draft with a configured AI provider.</span></li>
            <li><strong>Track and collaborate</strong><span>Update task statuses as work moves through development, testing, debugging, and review. Use Overview and Discussions to follow progress and resolve questions.</span></li>
          </ol>
        </section>
        <footer className="landing-footer">
          <span>Company access is provisioned by an administrator; public individual registration is disabled.</span>
          <button className="text-button" onClick={() => { setAuthMode('register'); setError(''); }}>Platform administrator setup</button>
        </footer>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="panel auth-panel">
          <button className="text-button" onClick={() => { setAuthMode('landing'); setError(''); }}>← Back to overview</button>
          <p className="eyebrow">{authMode === 'register' ? 'PLATFORM ADMINISTRATOR' : 'COMPANY WORKSPACE'}</p>
          <h1>{authMode === 'register' ? 'Set up an administrator account' : 'Sign in to your company'}</h1>
          <p>{authMode === 'register'
            ? 'Administrator setup is restricted to email addresses configured by the service operator.'
            : 'Use the company account and temporary or permanent password provided by your administrator.'}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <form className="auth-form" onSubmit={submitAccount}>
            {authMode === 'register' && <label>Display name
              <input autoComplete="name" value={authName} onChange={event => setAuthName(event.target.value)} maxLength={120} required />
            </label>}
            <label>Email
              <input type="email" autoComplete="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} maxLength={254} required />
            </label>
            <label>Password
              <input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authPassword} onChange={event => setAuthPassword(event.target.value)} minLength={authMode === 'register' ? 12 : 1} maxLength={128} required />
            </label>
            {authMode === 'register' && <p className="feature-note">Use at least 12 characters. Administrator emails are configured only in the backend environment.</p>}
            <button disabled={busy}>{busy ? 'Please wait…' : authMode === 'register' ? 'Create administrator account' : 'Sign in'}</button>
          </form>
          {authMode === 'login' && <p className="auth-switch">Platform administrator?{' '}
            <button className="text-button" type="button" onClick={() => { setAuthMode('register'); setError(''); }}>Create administrator account</button>
          </p>}
        </section>
      </main>
    );
  }

  if (user.must_change_password) {
    return (
      <main className="auth-page">
        <section className="panel auth-panel">
          <p className="eyebrow">FIRST SIGN-IN</p>
          <h1>Choose a new password</h1>
          <p>Your temporary password has been used. Set a private password before opening company data.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <form className="auth-form" onSubmit={submitPasswordChange}>
            <label>New password
              <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} maxLength={128} required />
            </label>
            <button disabled={busy || newPassword.length < 12}>{busy ? 'Saving…' : 'Update password'}</button>
          </form>
        </section>
      </main>
    );
  }

  if (user.platform_admin && tenants.length === 0) {
    return (
      <main className="auth-page">
        <section className="panel company-setup-panel">
          <div className="section-heading">
            <div><p className="eyebrow">PLATFORM ADMINISTRATION</p><h1>Create a company profile</h1></div>
            <button className="secondary" onClick={signOut}>Sign out</button>
          </div>
          <p>Company profiles are created by platform administrators. Create the company and its first owner; employee accounts are provisioned by company HR.</p>
          {error && <p className="error" role="alert">{error}</p>}
          {ownerCredentials && <div className="temporary-credentials" role="status">
            <strong>Company created. Share this owner password securely; it is shown only once.</strong>
            <span>{ownerCredentials.email}</span><code>{ownerCredentials.temporaryPassword}</code>
            <small>The owner must set a new password at first sign-in. Do not send credentials over public channels.</small>
            <button className="secondary" onClick={() => setOwnerCredentials(null)}>Hide credentials</button>
          </div>}
          <form className="auth-form company-create-form" onSubmit={submitCompany}>
            <label>Company name<input value={companyForm.name} onChange={event => setCompanyForm(current => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
            <label>Company type<select value={companyForm.companyType} onChange={event => setCompanyForm(current => ({ ...current, companyType: event.target.value }))}>{COMPANY_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
            <label>Website (optional)<input type="url" value={companyForm.website} onChange={event => setCompanyForm(current => ({ ...current, website: event.target.value }))} maxLength={240} /></label>
            <label>First owner name<input value={companyForm.ownerName} onChange={event => setCompanyForm(current => ({ ...current, ownerName: event.target.value }))} maxLength={120} required /></label>
            <label>First owner email<input type="email" value={companyForm.ownerEmail} onChange={event => setCompanyForm(current => ({ ...current, ownerEmail: event.target.value }))} maxLength={254} required /></label>
            <button disabled={busy}>{busy ? 'Creating company…' : 'Create company and owner'}</button>
          </form>
        </section>
      </main>
    );
  }

  if (tenants.length === 0 && !busy) {
    return (
      <main className="auth-page">
        <section className="panel auth-panel empty-state">
          <p className="eyebrow">COMPANY ACCESS</p><h1>No company has assigned access</h1>
          <p>Ask your company administrator or HR manager to provision your employee account and verify your access.</p>
          <button className="secondary" onClick={signOut}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <div className="hosted-app">
      <aside className="hosted-sidebar">
        <div className="sidebar-brand">
          <span aria-hidden="true">▲</span>
          <div><strong>APM Suite</strong><small>Project workspace</small></div>
        </div>
        <nav className="workspace-nav" aria-label="Workspace sections">
          {viewOptions.map(view => (
            <button
              key={view.id}
              className={activeView === view.id ? 'workspace-nav-active' : ''}
              aria-current={activeView === view.id ? 'page' : undefined}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-profile">
          <span aria-hidden="true">{(user.profile?.name || 'M').slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{access?.responsibility ||
              (access?.capabilityProfile
                ? RESPONSIBILITY_PROFILES[access.capabilityProfile]?.label
                : 'Workspace member')}</strong>
            <small>{selectedTenant?.name || 'Local workspace'}</small>
          </div>
        </div>
      </aside>
      <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">AGENTIC PROJECT MANAGER</p><h1>Workspace</h1></div>
        <div className="account">
          <span>{user.demo ? 'Guest demo (read only)' : user.profile?.name || user.profile?.email || user.profile?.sub}</span>
          {tenantId && <InAppNotifications
            user={user}
            tenantId={tenantId}
            onError={setError}
            onOpenWorkspace={nextWorkspaceId => {
              if (workspaces.some(item => item.workspaceId === nextWorkspaceId)) {
                setWorkspaceId(nextWorkspaceId);
                setActiveView('discussions');
              }
            }}
          />}
          <button className="secondary" onClick={signOut}>Sign out</button>
        </div>
      </header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
      {tenants.length === 0 && !busy ? (
        <section className="panel empty-state">
          <h2>Your account has no organization access yet</h2>
          <p>Ask an organization owner to add your verified sign-in identity before you can open a role-based dashboard.</p>
        </section>
      ) : (
      <>
      <section className="panel selectors">
        <label>Organization
          <select value={tenantId} onChange={event => setTenantId(event.target.value)}>
            {tenants.map(tenant => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.name}</option>)}
          </select>
        </label>
        <label>Workspace
          <select value={workspaceId} onChange={event => setWorkspaceId(event.target.value)}>
            <option value="">Select a workspace</option>
            {workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}
          </select>
        </label>
        <span className="role-badge">
          {access?.responsibility || (access?.capabilityProfile
            ? RESPONSIBILITY_PROFILES[access.capabilityProfile]?.label
            : selectedTenant?.role || 'No organization access')}
          {' · '}{access?.role || selectedTenant?.role || ''}
        </span>
      </section>
      {selectedTenant && ['owner', 'admin'].includes(selectedTenant.role) && (
        <form className="panel create-workspace" onSubmit={createWorkspace}>
          <h2>Create workspace</h2>
          <label>Name<input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} required maxLength={120} /></label>
          <label>Workspace ID<input value={workspaceSlug} onChange={event => setWorkspaceSlug(event.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9._:-]{1,127}" /></label>
          <button disabled={busy}>Create</button>
        </form>
      )}
      {selectedWorkspace ? (
        <>
          <div className="section-heading">
            <div><p className="eyebrow">{selectedTenant?.name}</p><h2>{selectedWorkspace.name}</h2></div>
            {activeView === 'projects' && <div className="actions">
              <button className="secondary" onClick={loadDocuments} disabled={busy}>Reload</button>
              {can('tasks:write') && can('people:read') && can('workspace:read') &&
                <button className="secondary" onClick={generateTasks} disabled={busy}>Generate tasks</button>}
              {(can('workspace:write') || can('people:write') || can('tasks:write')) &&
                <button onClick={saveDocuments} disabled={busy}>Save workspace</button>}
            </div>}
          </div>
          <section className="panel role-dashboard-summary">
            <div>
              <p className="eyebrow">ROLE-BASED DASHBOARD</p>
              <h2>{access?.responsibility ||
                (access?.capabilityProfile
                  ? RESPONSIBILITY_PROFILES[access.capabilityProfile]?.label
                  : `${access?.role || selectedTenant?.role || 'Member'} dashboard`)}</h2>
              <p>Your navigation and actions are limited to the permissions assigned to your organization role and responsibility profile.</p>
            </div>
            <div className="dashboard-capabilities" aria-label="Available dashboard sections">
              {viewOptions.map(view => <span key={view.id}>{view.label}</span>)}
            </div>
          </section>
          {activeView === 'projects' ? (
            <div className="project-workspace">
              <section className="editor-grid">
                {DOCUMENT_TYPES.filter(type => ({
                  milestone: can('workspace:read'),
                  employees: can('people:read'),
                  tasks: can('tasks:read')
                })[type]).map(type => {
                  const editable = ({
                    milestone: can('workspace:write'),
                    employees: can('people:write'),
                    tasks: can('tasks:write')
                  })[type];
                  return (
                    <label className="panel editor" key={type}>
                      <span>{type[0].toUpperCase() + type.slice(1)}</span>
                      <textarea
                        spellCheck="false"
                        readOnly={!editable}
                        value={editors[type]}
                        onChange={event => setEditors(current => ({ ...current, [type]: event.target.value }))}
                      />
                    </label>
                  );
                })}
              </section>
              {can('people:read') && (
                <EmployeeRoster
                  key={workspaceId}
                  employees={employeeRoster}
                  canManage={can('people:write')}
                  busy={busy}
                  onChange={nextEmployees => setEditors(current => ({
                    ...current,
                    employees: pretty(nextEmployees)
                  }))}
                  onSave={saveEmployeeRoster}
                  onError={setError}
                />
              )}
              {can('tasks:read') && <section className="panel task-status-panel">
                <div className="section-heading">
                  <div><p className="eyebrow">WORKFLOW</p><h2>Task status</h2></div>
                  <p>Status changes save immediately. Priority remains a separate task field.</p>
                </div>
                {taskDocumentForStatus ? (
                  taskDocumentForStatus.tasks.length ? (
                    <ul className="task-status-list">
                      {taskDocumentForStatus.tasks.map((task, index) => task && typeof task === 'object' ? (
                        <li key={task.task_id || index}>
                          <div><strong>{task.task_name || task.task_id || 'Unnamed task'}</strong><span>{task.task_id || 'Missing task ID'}</span></div>
                          <select
                            aria-label={`Workflow status for ${task.task_name || task.task_id || 'Unnamed task'}`}
                            value={TASK_STATUSES.includes(task.status) ? task.status : 'not-started'}
                            disabled={busy || !can('tasks:write')}
                            onChange={event => task.task_id && updateTaskStatus(task.task_id, event.target.value)}
                          >
                            {TASK_STATUSES.map(status => (
                              <option key={status} value={status}>
                                {status.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')}
                              </option>
                            ))}
                          </select>
                        </li>
                      ) : null)}
                    </ul>
                  ) : <p className="empty-status">No tasks are available in this workspace.</p>
                ) : <p className="error">Enter valid task JSON to edit task statuses.</p>}
              </section>}
              {can('tasks:write') && can('people:read') && can('workspace:read') && <section className="panel model-settings">
                <h2>Task generation</h2>
                <label>AI provider
                  <select value={provider} onChange={event => {
                    modelRequestId.current++;
                    setModels([]);
                    setModel('');
                    setProvider(event.target.value);
                  }}>
                    {providerOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                {provider === 'gemini' && (
                  <label>Gemini API key
                    <input
                      type="password"
                      autoComplete="new-password"
                      spellCheck="false"
                      value={geminiApiKey}
                      onChange={event => {
                        const nextKey = event.target.value;
                        geminiApiKeyRef.current = nextKey;
                        setGeminiApiKey(nextKey);
                        modelRequestId.current++;
                        setModels([]);
                        setModel('');
                        setModelStatus(nextKey.trim()
                          ? 'Load models to verify this Gemini key.'
                          : 'Enter your Gemini API key to load available models.');
                      }}
                    />
                  </label>
                )}
                <label>Available model
                  <select value={model} onChange={event => setModel(event.target.value)} disabled={!models.length}>
                    {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <div className="actions model-key-actions">
                  <button
                    className="secondary"
                    onClick={refreshModels}
                    disabled={!provider || busy ||
                      (provider === 'gemini' && !geminiApiKey.trim() &&
                        !providers.some(item => item.id === 'gemini'))}
                  >Load available models</button>
                  {geminiApiKey && <button
                    className="secondary"
                    onClick={() => {
                      geminiApiKeyRef.current = '';
                      setGeminiApiKey('');
                      modelRequestId.current++;
                      setModels([]);
                      setModel('');
                      setModelStatus('Gemini key cleared.');
                    }}
                    disabled={busy}
                  >Clear Gemini key</button>}
                </div>
                <p role="status" aria-live="polite">{modelStatus}</p>
                {!providers.length && !geminiApiKey && <p className="credential-note">
                  Enter a Gemini key to use AI. The key stays in this page's memory, is sent only to the authenticated API for Gemini requests, and is cleared when you reload or switch organizations.
                </p>}
                {provider === 'gemini' && <p className="credential-note">
                  Gemini receives the milestone and employee details used to generate tasks. Only submit information you are authorized to share with Google.
                </p>}
                <p>Models are fetched live from the selected provider. Other providers appear only when configured by the backend.</p>
              </section>}
            </div>
          ) : (
            <WorkspaceFeaturePanel
              view={activeView}
              user={user}
              tenantId={tenantId}
              workspaceId={workspaceId}
              role={access?.role || selectedTenant?.role}
              profile={access?.capabilityProfile}
              canWriteDiscussions={can('discussions:write')}
              onError={setError}
            />
          )}
        </>
      ) : (
        <section className="panel empty-state">
          <h2>{busy ? 'Loading workspaces…' : workspaces.length ? 'Choose a workspace' : 'No workspaces are available'}</h2>
          <p>{workspaces.length
            ? 'Select a workspace to open the dashboard sections available to your role.'
            : selectedTenant && ['owner', 'admin'].includes(selectedTenant.role)
              ? 'Create a workspace above to get started.'
              : 'Ask an organization owner or administrator to create a workspace for your team.'}</p>
        </section>
      )}
      </>
      )}
      </main>
    </div>
  );
}
