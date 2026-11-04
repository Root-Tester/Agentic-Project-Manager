import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiStream } from '../api/client.js';
import { RESPONSIBILITY_PROFILES } from '../../../shared/access/capabilities.js';

function tenantPath(tenantId, suffix) {
  return `/tenants/${encodeURIComponent(tenantId)}${suffix}`;
}

function workspacePath(tenantId, workspaceId, suffix) {
  return tenantPath(
    tenantId,
    `/workspaces/${encodeURIComponent(workspaceId)}${suffix}`
  );
}

function formatShortDate(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function KpiDashboard({ user, tenantId, workspaceId, onError }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    setData(null);
    setBusy(true);
    apiRequest(
      `${tenantPath(tenantId, '/analytics/kpis')}?workspaceId=${encodeURIComponent(workspaceId)}`,
      user.access_token
    )
      .then(result => active && setData(result))
      .catch(error => active && onError(error.message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [onError, tenantId, user, workspaceId]);

  if (busy) return <section className="panel feature-panel"><p>Loading workflow KPIs…</p></section>;
  if (!data) return <section className="panel feature-panel"><p>No KPI data is available.</p></section>;

  return (
    <section className="feature-page">
      <header className="feature-heading">
        <div><p className="eyebrow">WORKFLOW OVERVIEW</p><h2>Project KPIs</h2></div>
        <p>Metrics are scoped to this workspace. Effort remains task-estimated; forecast capacity assumes 8h per person per weekday.</p>
      </header>
      <div className="kpi-grid">
        <article className="panel kpi-card">
          <span>Active team</span>
          <strong>{data.activeTeamCount ?? 0}</strong>
          <small>{Object.entries(data.proficiencyCounts || {})
            .map(([level, count]) => `${count} ${level}`).join(' · ')}</small>
        </article>
        <article className="panel kpi-card"><span>Project workspaces</span><strong>{data.workspaces}</strong></article>
        <article className="panel kpi-card"><span>Total tasks</span><strong>{data.tasks}</strong></article>
        <article className="panel kpi-card"><span>Completed</span><strong>{data.completed} <small>{data.completionRate}%</small></strong></article>
        <article className="panel kpi-card"><span>Blocked</span><strong>{data.blocked}</strong></article>
        <article className="panel kpi-card"><span>Overdue</span><strong>{data.overdue}</strong></article>
        <article className="panel kpi-card"><span>Estimated hours</span><strong>{data.estimatedHours}</strong></article>
        <article className="panel kpi-card">
          <span>Projected window</span>
          <strong>{data.forecastWindow
            ? `${formatShortDate(data.forecastWindow.start)} – ${formatShortDate(data.forecastWindow.end)}`
            : 'No forecast'}</strong>
          <small>{data.forecastWindow
            ? `${data.forecastWindow.workingDays} weekdays · ${data.forecastWindow.capacityHoursPerDay}h/day${data.forecastWindow.targetEnd ? ` · target ${formatShortDate(data.forecastWindow.targetEnd)}` : ''}${data.forecastWindow.exceedsMilestone ? ' · Over target' : ''}`
            : 'Assign team members with capacity'}</small>
        </article>
      </div>
      <div className="feature-columns">
        <section className="panel feature-panel">
          <h3>Status distribution</h3>
          {Object.entries(data.byStatus).length
            ? <ul className="metric-list">{Object.entries(data.byStatus).map(([status, count]) =>
              <li key={status}><span>{status.replaceAll('-', ' ')}</span><strong>{count}</strong></li>
            )}</ul>
            : <p>No task status data yet.</p>}
        </section>
        <section className="panel feature-panel">
          <h3>Assignee workload</h3>
          {Object.entries(data.workload).length
            ? <ul className="metric-list">{Object.entries(data.workload).map(([assignee, workload]) =>
              <li key={assignee}><span>{assignee}</span><strong>{workload.tasks} tasks · {workload.estimatedHours}h</strong></li>
            )}</ul>
            : <p>No assigned work yet.</p>}
        </section>
      </div>
    </section>
  );
}

function parseSseFrame(frame) {
  let event = 'message';
  let data = '';
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

function DiscussionPanel({ user, tenantId, workspaceId, canWrite, onError }) {
  const [conversations, setConversations] = useState([]);
  const [members, setMembers] = useState([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [recipientSubject, setRecipientSubject] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const activeConversation = useMemo(
    () => conversations.find(item => item.conversationId === conversationId),
    [conversationId, conversations]
  );

  useEffect(() => {
    let active = true;
    apiRequest(workspacePath(tenantId, workspaceId, '/discussions'), user.access_token)
      .then(result => {
        if (!active) return;
        setConversations(result.conversations);
        setMembers(result.members);
        setConversationId(current =>
          result.conversations.some(item => item.conversationId === current)
            ? current
            : result.conversations[0]?.conversationId || ''
        );
      })
      .catch(error => active && onError(error.message));
    return () => { active = false; };
  }, [onError, tenantId, user, workspaceId]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setHasOlderMessages(false);
      return undefined;
    }
    setHasOlderMessages(false);
    const controller = new AbortController();
    let active = true;
    let cursor = '';
    const messagesPath = workspacePath(
      tenantId,
      workspaceId,
      `/discussions/${encodeURIComponent(conversationId)}/messages`
    );
    async function startStream() {
      try {
        const history = await apiRequest(messagesPath, user.access_token, { signal: controller.signal });
        if (!active) return;
        setMessages(history.messages);
        setHasOlderMessages(history.messages.length === 50);
        cursor = history.messages.at(-1)?.id || '';
        const stream = await apiStream(
          `${workspacePath(tenantId, workspaceId, `/discussions/${encodeURIComponent(conversationId)}/stream`)}${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`,
          user.access_token,
          { signal: controller.signal }
        );
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const parsed = parseSseFrame(frame);
            if (!parsed) continue;
            if (parsed.event === 'stream-error') throw new Error(parsed.data.error);
            if (parsed.event === 'message') {
              cursor = parsed.data.id;
              setMessages(current => current.some(message => message.id === parsed.data.id)
                ? current
                : [...current, parsed.data]);
            }
          }
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') onError(error.message);
      }
    }
    startStream();
    return () => {
      active = false;
      controller.abort();
    };
  }, [conversationId, onError, tenantId, user, workspaceId]);

  async function loadOlderMessages() {
    const firstId = messages[0]?.id;
    if (!firstId || !hasOlderMessages) return;
    try {
      const history = await apiRequest(
        `${workspacePath(tenantId, workspaceId, `/discussions/${encodeURIComponent(conversationId)}/messages`)}?before=${encodeURIComponent(firstId)}&limit=50`,
        user.access_token
      );
      setMessages(current => [...history.messages, ...current]);
      setHasOlderMessages(history.messages.length === 50);
    } catch (error) {
      onError(error.message);
    }
  }

  async function startDirectMessage(event) {
    event.preventDefault();
    if (!recipientSubject) return;
    setBusy(true);
    try {
      const conversation = await apiRequest(
        workspacePath(tenantId, workspaceId, '/discussions/direct'),
        user.access_token,
        { method: 'POST', body: JSON.stringify({ recipientSubject }) }
      );
      setConversations(current => [
        conversation,
        ...current.filter(item => item.conversationId !== conversation.conversationId)
      ]);
      setConversationId(conversation.conversationId);
      setRecipientSubject('');
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!draft.trim() || !conversationId) return;
    setBusy(true);
    try {
      const result = await apiRequest(
        workspacePath(
          tenantId,
          workspaceId,
          `/discussions/${encodeURIComponent(conversationId)}/messages`
        ),
        user.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ content: draft, parentMessageId: replyTo?.id || null })
        }
      );
      setMessages(current => current.some(message => message.id === result.message.id)
        ? current
        : [...current, result.message]);
      setDraft('');
      setReplyTo(null);
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel discussion-panel">
      <aside className="discussion-sidebar">
        <h3>Discussions</h3>
        <ul className="conversation-list">
          {conversations.map(conversation => (
            <li key={conversation.conversationId}>
              <button
                className={conversationId === conversation.conversationId ? 'conversation-active' : ''}
                onClick={() => setConversationId(conversation.conversationId)}
              >
                <span>{conversation.type === 'project' ? 'Project room' : 'Direct message'}</span>
                <strong>{conversation.title}</strong>
              </button>
            </li>
          ))}
        </ul>
        {canWrite && (
          <form className="direct-message-form" onSubmit={startDirectMessage}>
            <label>Start a direct message
              <select value={recipientSubject} onChange={event => setRecipientSubject(event.target.value)}>
                <option value="">Select a team member</option>
                {members.filter(member => member.subject !== user.profile?.sub).map(member => (
                  <option key={member.subject} value={member.subject}>
                    {member.displayName}{member.department ? ` · ${member.department}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" disabled={!recipientSubject || busy}>Open conversation</button>
          </form>
        )}
      </aside>
      <div className="discussion-main">
        <header className="discussion-heading">
          <div><p className="eyebrow">{activeConversation?.type === 'direct' ? 'DIRECT MESSAGE' : 'PROJECT ROOM'}</p><h3>{activeConversation?.title || 'Select a discussion'}</h3></div>
          <span>{messages.length} messages loaded</span>
        </header>
        <div className="message-list" aria-live="polite">
          {hasOlderMessages && <button className="secondary load-older-button" onClick={loadOlderMessages}>Load older messages</button>}
          {messages.length ? messages.map(message => (
            <article className={`message-card${message.parentMessageId ? ' message-reply' : ''}`} key={message.id}>
              <header><strong>{message.senderName}</strong><time>{new Date(message.createdAt).toLocaleString()}</time></header>
              {message.parentMessageId && <small>Thread reply</small>}
              <p>{message.content}</p>
              {canWrite && <button className="text-button" onClick={() => setReplyTo(message)}>Reply in thread</button>}
            </article>
          )) : <p className="empty-status">No messages yet. Start the project conversation.</p>}
        </div>
        {canWrite && (
          <form className="message-composer" onSubmit={sendMessage}>
            {replyTo && <p>Replying in thread <button type="button" className="text-button" onClick={() => setReplyTo(null)}>Cancel</button></p>}
            <textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={5000} placeholder="Write a project update or question…" required />
            <button disabled={busy || !draft.trim()}>Send message</button>
          </form>
        )}
      </div>
    </section>
  );
}

const EMPLOYMENT_STATUSES = [
  ['working', 'Currently working'],
  ['on-leave', 'On leave'],
  ['retired', 'Retired'],
  ['fired', 'Fired']
];

const EMPTY_EMPLOYEE = {
  Employee_ID: '',
  Employee_Name: '',
  Email: '',
  Phone: '',
  Role: '',
  Department: '',
  experience_level: 'mid-level',
  employment_status: 'working',
  Manager: '',
  Location: '',
  employment_type: '',
  start_date: ''
};

function nextEmployeeId(employees) {
  const maxId = employees.reduce((max, employee) => {
    const match = /^EMP-(\d+)$/i.exec(employee?.Employee_ID || '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `EMP-${String(maxId + 1).padStart(3, '0')}`;
}

export function EmployeeRoster({ employees, canManage, busy, onChange, onSave, onError }) {
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState('');
  const roster = Array.isArray(employees) ? employees : [];
  const activeCount = roster.filter(employee =>
    !employee.employment_status || employee.employment_status === 'working'
  ).length;

  function updateEmployee(employeeId, changes) {
    onChange(roster.map(employee => employee.Employee_ID === employeeId
      ? { ...employee, ...changes }
      : employee));
  }

  function startNewEmployee() {
    setEditingId('');
    setForm({ ...EMPTY_EMPLOYEE, Employee_ID: nextEmployeeId(roster) });
  }

  function startEditing(employee) {
    setEditingId(employee.Employee_ID);
    setForm({ ...EMPTY_EMPLOYEE, ...employee });
  }

  function saveEmployeeDetails(event) {
    event.preventDefault();
    const normalized = {
      ...form,
      Employee_ID: form.Employee_ID.trim(),
      Employee_Name: form.Employee_Name.trim(),
      Role: form.Role.trim(),
      Department: form.Department.trim()
    };
    if (!normalized.Employee_ID || !normalized.Employee_Name ||
      !normalized.Role || !normalized.Department) {
      onError('Employee ID, name, job title, and department are required.');
      return;
    }
    if (roster.some(employee =>
      employee.Employee_ID === normalized.Employee_ID &&
      employee.Employee_ID !== editingId
    )) {
      onError(`Employee ID ${normalized.Employee_ID} is already in this team.`);
      return;
    }
    onChange(editingId
      ? roster.map(employee => employee.Employee_ID === editingId ? normalized : employee)
      : [...roster, normalized]);
    setForm(null);
    setEditingId('');
  }

  return (
    <section className="panel employee-roster">
      <header className="roster-heading">
        <div>
          <p className="eyebrow">PROJECT TEAM</p>
          <h2>Team roster</h2>
          <p>{activeCount} currently working · {roster.length} total records</p>
        </div>
        {canManage && (
          <div className="actions">
            <button className="secondary" type="button" onClick={startNewEmployee}>Add employee</button>
            <button type="button" onClick={onSave} disabled={busy || !Array.isArray(employees)}>
              {busy ? 'Saving…' : 'Save team'}
            </button>
          </div>
        )}
      </header>
      {!Array.isArray(employees) ? (
        <p className="error">Employee data must be a JSON array. Correct the Employees editor before managing the roster.</p>
      ) : roster.length ? (
        <ul className="roster-list">
          {roster.map((employee, index) => {
            const status = EMPLOYMENT_STATUSES.some(([value]) => value === employee.employment_status)
              ? employee.employment_status
              : 'working';
            return (
              <li className="roster-card" key={employee.Employee_ID || index}>
                <div className="roster-identity">
                  <strong>{employee.Employee_Name || 'Unnamed employee'}</strong>
                  <span>{employee.Role || 'Role not set'} · {employee.Department || 'Department not set'}</span>
                  <small>{employee.Employee_ID}{employee.Email ? ` · ${employee.Email}` : ''}{employee.Phone ? ` · ${employee.Phone}` : ''}</small>
                  <small>
                    {employee.experience_level || 'mid-level'} experience
                    {employee.Manager ? ` · Manager: ${employee.Manager}` : ''}
                    {employee.Location ? ` · ${employee.Location}` : ''}
                    {employee.employment_type ? ` · ${employee.employment_type}` : ''}
                    {employee.start_date ? ` · Since ${employee.start_date}` : ''}
                  </small>
                </div>
                <div className="roster-actions">
                  <label>Employment status
                    <select
                      value={status}
                      disabled={!canManage || busy}
                      onChange={event => updateEmployee(employee.Employee_ID, {
                        employment_status: event.target.value
                      })}
                    >
                      {EMPLOYMENT_STATUSES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  {canManage && <button className="secondary" type="button" onClick={() => startEditing(employee)}>Edit details</button>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="empty-status">No employees in this workspace yet. Add a team member to get started.</p>}

      {form && canManage && (
        <form className="roster-editor" onSubmit={saveEmployeeDetails}>
          <h3>{editingId ? 'Edit employee details' : 'Add employee to this project team'}</h3>
          <div className="roster-fields">
            <label>Employee ID<input value={form.Employee_ID} onChange={event => setForm(current => ({ ...current, Employee_ID: event.target.value }))} maxLength={80} required /></label>
            <label>Full name<input value={form.Employee_Name} onChange={event => setForm(current => ({ ...current, Employee_Name: event.target.value }))} maxLength={120} required /></label>
            <label>Email<input type="email" value={form.Email} onChange={event => setForm(current => ({ ...current, Email: event.target.value }))} maxLength={254} /></label>
            <label>Phone<input type="tel" value={form.Phone} onChange={event => setForm(current => ({ ...current, Phone: event.target.value }))} maxLength={40} /></label>
            <label>Job title<input value={form.Role} onChange={event => setForm(current => ({ ...current, Role: event.target.value }))} maxLength={100} required /></label>
            <label>Department<input value={form.Department} onChange={event => setForm(current => ({ ...current, Department: event.target.value }))} maxLength={100} required /></label>
            <label>Experience level
              <select value={form.experience_level} onChange={event => setForm(current => ({ ...current, experience_level: event.target.value }))}>
                <option value="fresher">Fresher</option>
                <option value="mid-level">Mid-level</option>
                <option value="senior">Senior</option>
              </select>
            </label>
            <label>Employment status
              <select value={form.employment_status} onChange={event => setForm(current => ({ ...current, employment_status: event.target.value }))}>
                {EMPLOYMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Manager<input value={form.Manager} onChange={event => setForm(current => ({ ...current, Manager: event.target.value }))} maxLength={120} /></label>
            <label>Location<input value={form.Location} onChange={event => setForm(current => ({ ...current, Location: event.target.value }))} maxLength={120} /></label>
            <label>Employment type<input value={form.employment_type} onChange={event => setForm(current => ({ ...current, employment_type: event.target.value }))} maxLength={80} placeholder="Full-time, contract…" /></label>
            <label>Start date<input type="date" value={form.start_date} onChange={event => setForm(current => ({ ...current, start_date: event.target.value }))} /></label>
          </div>
          <div className="actions">
            <button type="submit">{editingId ? 'Apply details' : 'Add to roster'}</button>
            <button className="secondary" type="button" onClick={() => { setForm(null); setEditingId(''); }}>Cancel</button>
          </div>
          <p className="feature-note">Changes are staged in this workspace. Select “Save team” to persist them. Employment history is retained; mark departures instead of deleting records.</p>
        </form>
      )}
      {!canManage && <p className="feature-note">Only members with people-management permission can add or update employee records.</p>}
    </section>
  );
}

function MembersPanel({ user, tenantId, role, onError }) {
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [form, setForm] = useState({
    displayName: '', email: '', role: 'editor',
    capabilityProfile: '', responsibility: '', department: ''
  });
  const [busy, setBusy] = useState(false);
  const canManage = role === 'owner' || role === 'admin';
  const selectedMember = members.find(member => member.subject === selectedSubject);
  const selectedProfile = RESPONSIBILITY_PROFILES[form.capabilityProfile];

  async function loadMembers() {
    const result = await apiRequest(tenantPath(tenantId, '/members'), user.access_token);
    setMembers(result.members);
    setProfiles(result.profiles);
  }

  useEffect(() => {
    let active = true;
    apiRequest(tenantPath(tenantId, '/members'), user.access_token)
      .then(result => {
        if (!active) return;
        setMembers(result.members);
        setProfiles(result.profiles);
      })
      .catch(error => active && onError(error.message));
    return () => { active = false; };
  }, [onError, tenantId, user]);

  function editMember(member) {
    setSelectedSubject(member.subject);
    setForm({
      subject: member.subject,
      displayName: member.displayName,
      email: member.email,
      role: member.role,
      capabilityProfile: member.capabilityProfile,
      responsibility: member.responsibility,
      department: member.department
    });
  }

  function newMember() {
    setSelectedSubject('');
    setForm({
      displayName: '', email: '', role: 'editor',
      capabilityProfile: '', responsibility: '', department: ''
    });
  }

  async function saveMember(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const editing = Boolean(selectedSubject);
      await apiRequest(
        tenantPath(tenantId, editing ? `/members/${encodeURIComponent(selectedSubject)}` : '/members'),
        user.access_token,
        { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) }
      );
      await loadMembers();
      newMember();
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feature-page">
      <header className="feature-heading">
        <div><p className="eyebrow">TEAM DIRECTORY</p><h2>People and access</h2></div>
        <p>Job responsibilities shape the workspace; organization roles and capability profiles control access.</p>
      </header>
      <div className="member-layout">
        <section className="panel feature-panel">
          <div className="member-list-heading"><h3>Tenant members</h3>{canManage && <button className="secondary" onClick={newMember}>Add member</button>}</div>
          <ul className="member-list">
            {members.map(member => (
              <li key={member.subject}>
                <button className={selectedSubject === member.subject ? 'member-selected' : ''} onClick={() => canManage && editMember(member)}>
                  <strong>{member.displayName}</strong>
                  <span>{member.responsibility || member.capabilityProfile || 'No responsibility profile'} · {member.role}</span>
                  <small>{member.department || member.email || member.subject}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {canManage && (
          <form className="panel member-form" onSubmit={saveMember}>
            <h3>{selectedMember ? 'Edit member' : 'Add tenant member'}</h3>
            {!selectedMember && <p className="feature-note">The person must register first. Enter their account email to grant access to this tenant.</p>}
            <label>Display name<input value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} required maxLength={120} /></label>
            <label>Email<input type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} maxLength={254} /></label>
            <label>Organization access role
              <select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))}>
                {['admin', 'editor', 'viewer'].map(item => <option key={item} value={item}>{item}</option>)}
                {role === 'owner' && <option value="owner">owner</option>}
              </select>
            </label>
            <label>Capability profile
              <select value={form.capabilityProfile} onChange={event => setForm(current => ({ ...current, capabilityProfile: event.target.value }))}>
                <option value="">Use organization-role defaults</option>
                {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select>
            </label>
            <label>Job title / responsibility<input value={form.responsibility} onChange={event => setForm(current => ({ ...current, responsibility: event.target.value }))} maxLength={100} placeholder="e.g. Frontend developer" /></label>
            <label>Department<input value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value }))} maxLength={100} /></label>
            {selectedProfile && <p className="permission-preview">
              <strong>{selectedProfile.label} capabilities:</strong> {selectedProfile.capabilities.join(', ')}
              {['owner', 'admin'].includes(form.role) && ' Organization owner/admin access remains unrestricted by this profile.'}
            </p>}
            <div className="actions"><button disabled={busy}>{selectedMember ? 'Save member' : 'Create member'}</button>{selectedMember && <button className="secondary" type="button" onClick={newMember}>Cancel</button>}</div>
          </form>
        )}
      </div>
      {!canManage && <p className="feature-note">Member access changes are managed by tenant owners and administrators.</p>}
    </section>
  );
}

function AuditPanel({ user, tenantId, workspaceId, onError }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let active = true;
    const query = `?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`;
    apiRequest(tenantPath(tenantId, `/audit${query}`), user.access_token)
      .then(result => active && setEvents(result.events))
      .catch(error => active && onError(error.message));
    return () => { active = false; };
  }, [onError, tenantId, user, workspaceId]);

  return (
    <section className="feature-page">
      <header className="feature-heading"><div><p className="eyebrow">ACTIVITY HISTORY</p><h2>Audit events</h2></div><p>Message content is not copied into audit records.</p></header>
      <section className="panel feature-panel">
        {events.length ? <ul className="audit-list">{events.map(event => (
          <li key={event.id}>
            <time>{new Date(event.createdAt).toLocaleString()}</time>
            <strong>{event.actorName || event.actorSubject}</strong>
            <span>{event.eventType.replaceAll('.', ' ')}</span>
            {event.targetId && <small>Target: {event.targetId}</small>}
          </li>
        ))}</ul> : <p>No audit events for this workspace yet.</p>}
      </section>
    </section>
  );
}

function OperationsPanel({ user, tenantId, profile, onError }) {
  const profileData = RESPONSIBILITY_PROFILES[profile];
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let active = true;
    apiRequest(tenantPath(tenantId, '/operations/summary'), user.access_token)
      .then(result => active && setSummary(result))
      .catch(error => active && onError(error.message));
    return () => { active = false; };
  }, [onError, tenantId, user]);
  return (
    <section className="feature-page">
      <header className="feature-heading"><div><p className="eyebrow">OPERATIONS</p><h2>{profileData?.label || 'Operations workspace'}</h2></div><p>Scoped project operations access</p></header>
      <section className="panel feature-panel">
        <h3>Tenant operations summary</h3>
        {summary ? (
          <ul className="metric-list">
            <li><span>API service</span><strong>{summary.service}</strong></li>
            {summary.workspaces !== undefined && <li><span>Workspaces</span><strong>{summary.workspaces}</strong></li>}
            {summary.tenantMessages !== undefined && <li><span>Tenant messages</span><strong>{summary.tenantMessages}</strong></li>}
            {summary.tenantAuditEvents !== undefined && <li><span>Tenant audit events</span><strong>{summary.tenantAuditEvents}</strong></li>}
            {summary.storage && <>
              <li><span>Database logical usage</span><strong>{(summary.storage.logicalBytes / 1024 / 1024).toFixed(1)} / {(summary.storage.limitBytes / 1024 / 1024).toFixed(0)} MiB</strong></li>
              <li><span>Purged oldest records</span><strong>{summary.storage.lastRetention?.purgedRecords || 0}</strong></li>
            </>}
            <li><span>Last checked</span><strong>{new Date(summary.observedAt).toLocaleString()}</strong></li>
          </ul>
        ) : <p>Loading tenant operations data…</p>}
        <h3>Granted workspace capabilities</h3>
        <ul className="metric-list">
          {(profileData?.capabilities || []).map(capability => <li key={capability}><span>{capability}</span><strong>Enabled</strong></li>)}
        </ul>
        <p className="feature-note">Infrastructure and database administration use project-scoped permissions; this workspace does not expose database credentials or raw database access.</p>
      </section>
    </section>
  );
}

function OrganizationDashboard({ user, tenantId, onError }) {
  const [overview, setOverview] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    setBusy(true);
    apiRequest(tenantPath(tenantId, '/organization/overview'), user.access_token)
      .then(result => active && setOverview(result.overview))
      .catch(error => active && onError(error.message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [onError, tenantId, user]);

  if (busy) return <section className="panel feature-panel"><p>Loading company progress…</p></section>;
  if (!overview) return <section className="panel feature-panel"><p>No company overview is available.</p></section>;
  return (
    <section className="feature-page">
      <header className="feature-heading">
        <div><p className="eyebrow">ORGANIZATION WORKFLOW</p><h2>Company overview</h2></div>
        <p>Progress comes from project task statuses. It is not an automatic employee performance rating.</p>
      </header>
      <div className="kpi-grid">
        <article className="panel kpi-card"><span>Visible employees</span><strong>{overview.employeeCount}</strong></article>
        <article className="panel kpi-card"><span>Awaiting HR verification</span><strong>{overview.pendingVerification}</strong></article>
        <article className="panel kpi-card"><span>Teams</span><strong>{overview.teams.length}</strong></article>
        <article className="panel kpi-card"><span>Visible projects</span><strong>{overview.workspaces.length}</strong></article>
      </div>
      <div className="feature-columns">
        <section className="panel feature-panel">
          <h3>Project progress</h3>
          {overview.workspaces.length ? <ul className="metric-list">{overview.workspaces.map(project => (
            <li key={project.workspaceId}>
              <span>{project.name}<small className="metric-subtext">{project.taskCount} tasks · {project.completed} completed · {project.blocked} blocked</small></span>
              <strong>{project.taskCount ? Math.round(project.completed * 100 / project.taskCount) : 0}%</strong>
            </li>
          ))}</ul> : <p>No projects are assigned to the teams visible to your role.</p>}
        </section>
        <section className="panel feature-panel">
          <h3>Teams and leaders</h3>
          {overview.teams.length ? <ul className="metric-list">{overview.teams.map(team => (
            <li key={team.teamId}><span>{team.name}<small className="metric-subtext">{team.leaderName || 'Leader not set'} · {team.memberCount} team members</small></span><strong>{team.workspaceName || 'No project'}</strong></li>
          ))}</ul> : <p>No teams have been created yet.</p>}
        </section>
        <section className="panel feature-panel">
          <h3>Employees by department</h3>
          {Object.keys(overview.employeesByDepartment).length
            ? <ul className="metric-list">{Object.entries(overview.employeesByDepartment).map(([department, count]) =>
              <li key={department}><span>{department}</span><strong>{count}</strong></li>)}</ul>
            : <p>No employee records are available to this role.</p>}
        </section>
        <section className="panel feature-panel">
          <h3>Task progress by employee</h3>
          {overview.workspaces.some(project => project.employeeProgress?.length)
            ? <ul className="metric-list">{overview.workspaces.flatMap(project =>
              project.employeeProgress.map(progress => (
                <li key={`${project.workspaceId}:${progress.employeeCode}`}>
                  <span>{progress.employeeName}<small className="metric-subtext">{project.name}</small></span>
                  <strong>{progress.completed}/{progress.tasks} completed · {progress.blocked} blocked</strong>
                </li>
              ))
            )}</ul>
            : <p>Task progress appears after work is assigned to employees in this company.</p>}
        </section>
      </div>
      <p className="feature-note">Use the People & access section to onboard staff, review pending hires, and organize verified employees. This view reports work evidence only and does not determine individual performance.</p>
    </section>
  );
}

function EmployeeManagementPanel({ user, tenantId, role, profile, workspaceId, onError }) {
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    employeeCode: '', displayName: '', email: '', jobTitle: '',
    department: '', experienceLevel: 'mid-level', accessRole: 'employee'
  });
  const [teamForm, setTeamForm] = useState({ name: '', leaderEmployeeId: '', workspaceId: '' });
  const [assignments, setAssignments] = useState({});
  const [statusEdits, setStatusEdits] = useState({});
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);
  const isOwner = role === 'owner' || role === 'admin';
  const canProvision = isOwner || profile === 'hr' || profile === 'hr-manager';
  const canVerify = isOwner || profile === 'hr-manager';
  const canCreateTeams = canVerify;
  const availableEmployees = employees.filter(employee =>
    employee.verificationStatus === 'verified' && employee.employmentStatus === 'working'
  );

  async function loadAll() {
    const [employeeResult, teamResult, catalogResult] = await Promise.all([
      apiRequest(tenantPath(tenantId, '/employees'), user.access_token),
      apiRequest(tenantPath(tenantId, '/teams'), user.access_token),
      apiRequest(tenantPath(tenantId, '/job-catalog'), user.access_token)
    ]);
    setEmployees(employeeResult.employees);
    setTeams(teamResult.teams);
    setDepartments(catalogResult.departments);
    setForm(current => {
      const currentDepartment = catalogResult.departments.find(item => item.department === current.department);
      return currentDepartment?.titles.includes(current.jobTitle)
        ? current
        : {
          ...current,
          department: catalogResult.departments[0]?.department || '',
          jobTitle: catalogResult.departments[0]?.titles[0] || ''
        };
    });
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest(tenantPath(tenantId, '/employees'), user.access_token),
      apiRequest(tenantPath(tenantId, '/teams'), user.access_token),
      apiRequest(tenantPath(tenantId, '/job-catalog'), user.access_token)
    ])
      .then(([employeeResult, teamResult, catalogResult]) => {
        if (!active) return;
        setEmployees(employeeResult.employees);
        setTeams(teamResult.teams);
        setDepartments(catalogResult.departments);
        setForm(current => {
          const currentDepartment = catalogResult.departments.find(item => item.department === current.department);
          return currentDepartment?.titles.includes(current.jobTitle)
            ? current
            : {
              ...current,
              department: catalogResult.departments[0]?.department || '',
              jobTitle: catalogResult.departments[0]?.titles[0] || ''
            };
        });
      })
      .catch(error => active && onError(error.message));
    return () => { active = false; };
  }, [onError, tenantId, user]);

  async function addEmployee(event) {
    event.preventDefault();
    setBusy(true);
    setCredentials(null);
    try {
      const result = await apiRequest(tenantPath(tenantId, '/employees'), user.access_token, {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setCredentials(result.temporaryPassword
        ? { email: result.employee.email, password: result.temporaryPassword }
        : { email: result.employee.email, password: '', existing: true });
      setForm(current => ({ ...current, employeeCode: '', displayName: '', email: '' }));
      await loadAll();
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function reviewEmployee(employee, action) {
    setBusy(true);
    try {
      await apiRequest(
        tenantPath(tenantId, `/employees/${encodeURIComponent(employee.employeeId)}/${action}`),
        user.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ teamId: assignments[employee.employeeId] || '' })
        }
      );
      await loadAll();
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function createTeam(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(tenantPath(tenantId, '/teams'), user.access_token, {
        method: 'POST',
        body: JSON.stringify({ ...teamForm, workspaceId: teamForm.workspaceId || workspaceId })
      });
      setTeamForm({ name: '', leaderEmployeeId: '', workspaceId: '' });
      await loadAll();
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function assignEmployee(employee) {
    const teamId = assignments[employee.employeeId];
    if (!teamId) return;
    setBusy(true);
    try {
      await apiRequest(tenantPath(tenantId, `/teams/${encodeURIComponent(teamId)}/members`), user.access_token, {
        method: 'POST',
        body: JSON.stringify({ employeeId: employee.employeeId })
      });
      await loadAll();
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateEmploymentStatus(employee) {
    const employmentStatus = statusEdits[employee.employeeId] || employee.employmentStatus;
    if (employmentStatus === employee.employmentStatus) return;
    setBusy(true);
    try {
      await apiRequest(
        tenantPath(tenantId, `/employees/${encodeURIComponent(employee.employeeId)}/status`),
        user.access_token,
        {
          method: 'PUT',
          body: JSON.stringify({ employmentStatus })
        }
      );
      await loadAll();
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  const titles = departments.find(item => item.department === form.department)?.titles || [];
  return (
    <section className="feature-page">
      <header className="feature-heading">
        <div><p className="eyebrow">COMPANY DIRECTORY</p><h2>Employees and teams</h2></div>
        <p>HR provisions hires; an HR manager verifies access and organizes approved staff into teams.</p>
      </header>
      {credentials && <div className="temporary-credentials" role="status">
        {credentials.existing
          ? <strong>This employee already has an account. No password was created or revealed; share the verification outcome after approval.</strong>
          : <><strong>Temporary password (shown once)</strong><span>{credentials.email}</span><code>{credentials.password}</code><small>Share it privately. The employee must replace it at first sign-in.</small></>}
        <button className="secondary" onClick={() => setCredentials(null)}>Hide</button>
      </div>}
      {canProvision && <form className="panel member-form" onSubmit={addEmployee}>
        <h3>Add a hire for verification</h3>
        <div className="roster-fields">
          <label>Employee ID<input value={form.employeeCode} onChange={event => setForm(current => ({ ...current, employeeCode: event.target.value }))} maxLength={80} required /></label>
          <label>Full name<input value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} maxLength={120} required /></label>
          <label>Work email<input type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} maxLength={254} required /></label>
          <label>Department<select value={form.department} onChange={event => {
            const department = departments.find(item => item.department === event.target.value);
            setForm(current => ({ ...current, department: event.target.value, jobTitle: department?.titles[0] || '' }));
          }}>{departments.map(item => <option key={item.department} value={item.department}>{item.department}</option>)}</select></label>
          <label>Job title<select value={form.jobTitle} onChange={event => setForm(current => ({ ...current, jobTitle: event.target.value }))}>{titles.map(title => <option key={title} value={title}>{title}</option>)}</select></label>
          <label>Experience level<select value={form.experienceLevel} onChange={event => setForm(current => ({ ...current, experienceLevel: event.target.value }))}><option value="fresher">Fresher</option><option value="mid-level">Mid-level</option><option value="senior">Senior</option></select></label>
          <label>Company responsibility<select value={form.accessRole} onChange={event => setForm(current => ({ ...current, accessRole: event.target.value }))}>
            <option value="employee">Employee</option><option value="team-leader">Team leader</option><option value="manager">Manager</option>
            {isOwner && <><option value="hr">HR</option><option value="hr-manager">HR manager</option></>}
            {profile === 'hr-manager' && <><option value="hr">HR</option><option value="hr-manager">HR manager</option></>}
          </select></label>
        </div>
        <p className="feature-note">New accounts receive a generated one-time password. Existing accounts keep their current password. Both remain company-pending until verified.</p>
        <button disabled={busy}>{busy ? 'Saving…' : 'Submit hire for verification'}</button>
      </form>}
      <section className="panel feature-panel">
        <h3>Employee records</h3>
        {employees.length ? <ul className="member-list">{employees.map(employee => (
          <li key={employee.employeeId} className="organization-employee">
            <div className="employee-directory-entry">
              <strong>{employee.displayName}</strong>
              <span>{employee.jobTitle} · {employee.department} · {employee.accessRole}</span>
              <small>{employee.employeeCode} · {employee.email} · {employee.experienceLevel}</small>
              <small>{employee.verificationStatus.replaceAll('-', ' ')} · {employee.employmentStatus.replaceAll('-', ' ')}</small>
              {employee.teams.length > 0 && <small>Teams: {employee.teams.map(team => team.name).join(', ')}</small>}
            </div>
            {employee.verificationStatus === 'verified' && canProvision && <div className="actions">
              <label>
                Employment status
                <select
                  aria-label={`Employment status for ${employee.displayName}`}
                  value={statusEdits[employee.employeeId] || employee.employmentStatus}
                  onChange={event => setStatusEdits(current => ({
                    ...current,
                    [employee.employeeId]: event.target.value
                  }))}
                >
                  <option value="working">Currently working</option>
                  <option value="on-leave">On leave</option>
                  <option value="retired">Retired</option>
                  <option value="fired">Fired</option>
                </select>
              </label>
              <button
                className="secondary"
                disabled={busy || (statusEdits[employee.employeeId] || employee.employmentStatus) === employee.employmentStatus}
                onClick={() => updateEmploymentStatus(employee)}
              >
                Update status
              </button>
            </div>}
            {employee.verificationStatus === 'pending' && canVerify && <div className="actions">
              <select aria-label={`Team for ${employee.displayName}`} value={assignments[employee.employeeId] || ''} onChange={event => setAssignments(current => ({ ...current, [employee.employeeId]: event.target.value }))}>
                <option value="">Verify without team</option>{teams.map(team => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}
              </select>
              <button disabled={busy} onClick={() => reviewEmployee(employee, 'verify')}>Verify hire</button>
              <button className="secondary" disabled={busy} onClick={() => reviewEmployee(employee, 'reject')}>Reject</button>
            </div>}
            {employee.verificationStatus === 'verified' && canCreateTeams && teams.length > 0 &&
              !employee.teams.length && <div className="actions">
                <select aria-label={`Assign ${employee.displayName} to a team`} value={assignments[employee.employeeId] || ''} onChange={event => setAssignments(current => ({ ...current, [employee.employeeId]: event.target.value }))}>
                  <option value="">Choose team</option>{teams.map(team => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}
                </select>
                <button className="secondary" disabled={busy || !assignments[employee.employeeId]} onClick={() => assignEmployee(employee)}>Assign team</button>
              </div>}
          </li>
        ))}</ul> : <p>No company employees have been submitted yet.</p>}
      </section>
      {canCreateTeams && <div className="feature-columns">
        <form className="panel member-form" onSubmit={createTeam}>
          <h3>Create a team</h3>
          <label>Team name<input value={teamForm.name} onChange={event => setTeamForm(current => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
          <label>Team leader<select value={teamForm.leaderEmployeeId} onChange={event => setTeamForm(current => ({ ...current, leaderEmployeeId: event.target.value }))}>
            <option value="">No leader assigned</option>{availableEmployees.map(employee => <option key={employee.employeeId} value={employee.employeeId}>{employee.displayName} · {employee.jobTitle}</option>)}
          </select></label>
          <button disabled={busy}>{busy ? 'Saving…' : 'Create team'}</button>
        </form>
        <section className="panel feature-panel">
          <h3>Teams</h3>
          {teams.length ? <ul className="metric-list">{teams.map(team => (
            <li key={team.teamId}><span>{team.name}<small className="metric-subtext">{team.leaderName || 'Leader not set'} · {team.memberCount} members</small></span><strong>{team.workspaceName || 'No project'}</strong></li>
          ))}</ul> : <p>Create a team to organize verified employees around a project.</p>}
        </section>
      </div>}
      {!canProvision && <p className="feature-note">Employee onboarding is managed by HR, HR managers, and company administrators.</p>}
    </section>
  );
}

export function WorkspaceFeaturePanel({ view, user, tenantId, workspaceId, role, profile, canWriteDiscussions, onError }) {
  if (view === 'org-overview') return <OrganizationDashboard user={user} tenantId={tenantId} onError={onError} />;
  if (view === 'overview') return <KpiDashboard user={user} tenantId={tenantId} workspaceId={workspaceId} onError={onError} />;
  if (view === 'discussions') {
    return <DiscussionPanel user={user} tenantId={tenantId} workspaceId={workspaceId} canWrite={canWriteDiscussions} onError={onError} />;
  }
  if (view === 'people') return (
    <>
      <EmployeeManagementPanel user={user} tenantId={tenantId} role={role} profile={profile} workspaceId={workspaceId} onError={onError} />
      {['owner', 'admin'].includes(role) && <details className="panel advanced-membership">
        <summary>Advanced existing-account access</summary>
        <MembersPanel user={user} tenantId={tenantId} role={role} onError={onError} />
      </details>}
    </>
  );
  if (view === 'audit') return <AuditPanel user={user} tenantId={tenantId} workspaceId={workspaceId} onError={onError} />;
  if (view === 'operations') return <OperationsPanel user={user} tenantId={tenantId} profile={profile} onError={onError} />;
  return null;
}

export function InAppNotifications({ user, tenantId, onOpenWorkspace, onError }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await apiRequest(tenantPath(tenantId, '/notifications'), user.access_token);
        if (active) {
          setNotifications(result.notifications);
          setUnreadCount(result.unreadCount);
        }
      } catch (error) {
        if (active) onError(error.message);
      }
    }
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onError, tenantId, user]);

  async function openNotification(notification) {
    if (!notification.readAt) {
      try {
        await apiRequest(
          tenantPath(tenantId, `/notifications/${encodeURIComponent(notification.id)}/read`),
          user.access_token,
          { method: 'PUT' }
        );
        setNotifications(current => current.map(item =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
        ));
        setUnreadCount(current => Math.max(0, current - 1));
      } catch (error) {
        onError(error.message);
      }
    }
    onOpenWorkspace(notification.workspaceId);
    setOpen(false);
  }

  return (
    <div className="notification-menu">
      <button className="secondary notification-trigger" aria-expanded={open} onClick={() => setOpen(current => !current)}>
        Notifications{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
      </button>
      {open && <section className="panel notification-popover">
        <h3>Notifications</h3>
        {notifications.length ? <ul>{notifications.map(notification => (
          <li key={notification.id} className={notification.readAt ? '' : 'notification-unread'}>
            <button onClick={() => openNotification(notification)}>
              <strong>{notification.actorName} sent a message</strong>
              <span>{notification.preview}</span>
              <small>{new Date(notification.createdAt).toLocaleString()}</small>
            </button>
          </li>
        ))}</ul> : <p>No notifications yet.</p>}
      </section>}
    </div>
  );
}
