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
  return {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expired: false,
    profile: session.profile
  };
}

export function signIn(email, password) {
  return submitCredentials('login', { email, password });
}

export function registerPlatformAdmin({ email, displayName, password }) {
  return submitCredentials('register', { email, displayName, password });
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
  return {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expired: false,
    profile: session.profile,
    demo: true
  };
}

export async function updatePassword(accessToken, password) {
  const response = await fetch('/api/v1/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ password })
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(session.error || `Password update failed (${response.status}).`);
  }
  if (typeof session.access_token !== 'string' || !session.profile?.sub) {
    throw new Error('The server returned an invalid password update session.');
  }
  return {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expired: false,
    profile: session.profile,
    platform_admin: session.platform_admin
  };
}
