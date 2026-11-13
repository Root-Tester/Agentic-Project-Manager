function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required backend configuration: ${key}`);
  return value;
}

export function isPlaceholder(value) {
  return /<[^>]+>|replace-with|placeholder|example\.(?:com|net|org)/i.test(value || '');
}

function assertHttpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.origin;
}

export function loadBackendConfig(env = process.env) {
  const nodeEnv = (env.NODE_ENV || 'development').toLowerCase();
  const rawPort = env.API_PORT || '4000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }

  const jwtSecret = required(env, 'APM_JWT_SECRET');
  if (Buffer.byteLength(jwtSecret) < 32) {
    throw new Error('APM_JWT_SECRET must contain at least 32 bytes. Generate a random secret; do not reuse an API key.');
  }
  if (isPlaceholder(jwtSecret)) {
    throw new Error('Replace the placeholder APM_JWT_SECRET with a randomly generated secret.');
  }

  const storageLimitBytes = Number(env.APM_STORAGE_LIMIT_BYTES || 524_288_000);
  if (!Number.isSafeInteger(storageLimitBytes) || storageLimitBytes < 1_048_576) {
    throw new Error('APM_STORAGE_LIMIT_BYTES must be an integer of at least 1048576 bytes.');
  }

  const corsOrigins = (env.CORS_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000,http://0.0.0.0:3000,https://agentic-project-manager.onrender.com')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => assertHttpUrl(origin, 'CORS_ORIGINS entry'));
  const platformAdminEmails = [...new Set(
    (env.APM_PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  )];
  if (platformAdminEmails.some(email =>
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )) {
    throw new Error('APM_PLATFORM_ADMIN_EMAILS must be a comma-separated list of valid email addresses.');
  }

  return {
    port,
    databasePath: env.APM_DATABASE_PATH?.trim() || '.data/agentic-project-manager.sqlite',
    storageLimitBytes,
    issuer: 'agentic-project-manager',
    audience: 'agentic-project-manager-web',
    jwtSecret,
    platformAdminEmails,
    corsOrigins: [...new Set(corsOrigins)],
    nodeEnv
  };
}
