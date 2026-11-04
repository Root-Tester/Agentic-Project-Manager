export class ProviderApiError extends Error {
  constructor(provider, message) {
    super(`${provider} API: ${message}`);
    this.name = 'ProviderApiError';
    this.statusCode = 502;
  }
}

export function toProviderError(provider, error, apiKey) {
  if (error instanceof ProviderApiError) return error;

  const status = error.response?.status;
  const providerMessage = error.response?.data?.error?.message
    || error.response?.data?.message
    || error.response?.data?.error
    || '';
  const detail = typeof providerMessage === 'string'
    ? providerMessage.replaceAll(apiKey, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 400)
    : '';

  if (status === 401 || status === 403) {
    return new ProviderApiError(provider, `the API key was rejected (HTTP ${status}). Check that the key is active and has access to this API.`);
  }
  if (status === 404) {
    return new ProviderApiError(provider, `the requested model or endpoint was not found. Refresh the model list and select an available model.${detail ? ` ${detail}` : ''}`);
  }
  if (status === 429) {
    return new ProviderApiError(provider, `rate limit or quota exceeded. Check your provider account limits and billing.${detail ? ` ${detail}` : ''}`);
  }
  if (status) {
    return new ProviderApiError(provider, `request failed with HTTP ${status}.${detail ? ` ${detail}` : ''}`);
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ProviderApiError(provider, 'the request timed out. Try again or choose a faster model.');
  }
  if (error.response) {
    return new ProviderApiError(provider, `request failed.${detail ? ` ${detail}` : ''}`);
  }
  return new ProviderApiError(provider, 'could not connect. Check your internet connection and try again.');
}
