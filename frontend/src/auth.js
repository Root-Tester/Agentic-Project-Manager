const SESSION_STORAGE_KEY = 'apm_session';

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || typeof session.access_token !== 'string') {
      clearStoredSession();
      return null;
    }
    if (session.expires_at) {
      const expiresTime = new Date(session.expires_at).getTime();
      if (!isNaN(expiresTime) && Date.now() >= expiresTime) {
        clearStoredSession();
        return null;
      }
    }
    return session;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function saveStoredSession(session) {
  try {
    if (session && session.access_token) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // storage not available or quota exceeded
  }
}

export function updateStoredSession(updates) {
  try {
    const current = getStoredSession();
    if (current && updates) {
      const merged = { ...current, ...updates };
      saveStoredSession(merged);
      return merged;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function formatSession(session, extra = {}) {
  const defaultDuration = (session.is_owner_or_executive ? 20 : 15) * 3600;
  const expiresIn = session.expires_in || defaultDuration;
  const expiresAt = session.expires_at || new Date(Date.now() + expiresIn * 1000).toISOString();

  const formatted = {
    session_id: session.session_id || session.sessionId || '',
    sessionId: session.sessionId || session.session_id || '',
    access_token: session.access_token,
    token_type: session.token_type || 'Bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    expired: false,
    profile: session.profile,
    must_change_password: Boolean(session.must_change_password),
    terms_accepted: Boolean(session.terms_accepted),
    platform_admin: Boolean(session.platform_admin),
    demo_read_only: Boolean(session.demo_read_only),
    is_owner_or_executive: Boolean(session.is_owner_or_executive),
    ...extra
  };
  saveStoredSession(formatted);
  return formatted;
}

async function submitCredentials(endpoint, credentials) {
  const response = await fetch(`/api/v1/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(session.error || `Account request failed (${response.status}).`);
  }
  if (typeof session.access_token !== 'string' || !session.profile?.sub) {
    throw new Error('The server returned an invalid sign-in session.');
  }
  return formatSession(session, session.company ? { company: session.company } : {});
}

export function signIn(email, password) {
  return submitCredentials('login', { email, password });
}

export function registerCompany({ email, displayName, password, companyName, companyType, website, agreeToTerms }) {
  return submitCredentials('register', { email, displayName, password, companyName, companyType, website, agreeToTerms });
}

export function registerPlatformAdmin({ email, displayName, password, agreeToTerms }) {
  return submitCredentials('register', { email, displayName, password, agreeToTerms });
}

export async function fetchPolicies() {
  const response = await fetch('/api/v1/policies');
  if (!response.ok) {
    throw new Error('Failed to load system security and user policies.');
  }
  return response.json();
}

export async function startDemo() {
  const response = await fetch('/api/v1/auth/demo', { method: 'POST' });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(session.error || `Demo session failed (${response.status}).`);
  }
  if (typeof session.access_token !== 'string' || !session.profile?.sub) {
    throw new Error('The server returned an invalid demo session.');
  }
  return formatSession(session, { demo: true });
}

export async function updatePassword(accessToken, password, agreeToTerms) {
  const response = await fetch('/api/v1/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ password, agreeToTerms })
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(session.error || `Password update failed (${response.status}).`);
  }
  if (typeof session.access_token !== 'string' || !session.profile?.sub) {
    throw new Error('The server returned an invalid password update session.');
  }
  return formatSession(session);
}
