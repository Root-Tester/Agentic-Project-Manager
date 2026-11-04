export function sanitizeStartupError(error, env = process.env) {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  const secrets = [
    env.MONGODB_URI,
    env.APM_JWT_SECRET,
    env.GEMINI_API_KEY,
    env.OPENAI_API_KEY,
    env.ANTHROPIC_API_KEY
  ].filter(value => typeof value === 'string' && value.length > 0);
  return secrets.reduce(
    (safeMessage, secret) => safeMessage.replaceAll(secret, '[redacted]'),
    message
  ).slice(0, 600);
}
