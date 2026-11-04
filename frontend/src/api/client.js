const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function apiRequest(path, accessToken, options = {}) {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${accessToken}`,
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `API request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

export async function apiStream(path, accessToken, { signal } = {}) {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `API request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('The server did not provide a live update stream.');
  return response.body;
}
