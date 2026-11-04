import * as gemini from './providers/gemini.js';
import * as openai from './providers/openai.js';
import * as anthropic from './providers/anthropic.js';

const PROVIDERS = new Map([
  ['gemini', { name: 'Google Gemini', envKey: 'GEMINI_API_KEY', ...gemini }],
  ['openai', { name: 'OpenAI', envKey: 'OPENAI_API_KEY', ...openai }],
  ['anthropic', { name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', ...anthropic }]
]);

function getProvider(provider) {
  const config = PROVIDERS.get(provider);
  if (!config) throw new Error('A supported LLM provider is required.');
  return config;
}

export async function listAvailableModels(provider, apiKey) {
  const config = getProvider(provider);
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('A non-empty API key is required to list models.');
  }
  const models = await config.listModels(apiKey.trim());
  if (!models.length) {
    throw new Error(`${config.name} did not return any models available for text generation.`);
  }
  return models;
}

export function getConfiguredProviders(env = process.env) {
  return [...PROVIDERS].flatMap(([id, config]) => env[config.envKey]?.trim()
    ? [{ id, name: config.name }]
    : []);
}

export async function listConfiguredModels(provider, env = process.env) {
  const config = getProvider(provider);
  const apiKey = env[config.envKey]?.trim();
  if (!apiKey) throw new Error(`${config.name} is not configured on the backend.`);
  return listAvailableModels(provider, apiKey);
}

function chooseDefaultModel(provider, models) {
  if (provider === 'gemini') {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const flashModels = models.filter(model => /-flash(?:-|$)/i.test(model.id));
    if (flashModels.length) {
      return flashModels.sort((left, right) => collator.compare(right.id, left.id))[0].id;
    }
  }
  return models[0].id;
}

/**
 * Generates text through a supported hosted model provider.
 * API credentials are read from the process environment or supplied per call.
 */
export async function callLLM(prompt, modelName, credentials = {}) {
  if (process.env.MOCK_LLM_RESPONSE) {
    return process.env.MOCK_LLM_RESPONSE;
  }

  const { provider, apiKey } = credentials;
  const useExplicitProvider = provider !== undefined;
  const useExplicitCredentials = apiKey !== undefined;
  if (useExplicitCredentials && (
    !useExplicitProvider ||
    !PROVIDERS.has(provider) ||
    typeof apiKey !== 'string' ||
    !apiKey.trim()
  )) {
    throw new Error('A supported LLM provider and non-empty API key are required.');
  }

  const configuredProvider = useExplicitProvider
    ? provider
    : [...PROVIDERS].find(([, config]) => process.env[config.envKey])?.[0];
  if (!configuredProvider) {
    throw new Error(
      'No LLM API Key detected.\n' +
      'Please set one of the following environment variables:\n' +
      '  - GEMINI_API_KEY (for Gemini)\n' +
      '  - OPENAI_API_KEY (for OpenAI)\n' +
      '  - ANTHROPIC_API_KEY (for Anthropic)'
    );
  }

  const selectedProvider = getProvider(configuredProvider);
  const selectedApiKey = useExplicitCredentials ? apiKey : process.env[selectedProvider.envKey];
  if (typeof selectedApiKey !== 'string' || !selectedApiKey.trim()) {
    throw new Error(`Missing API key for ${selectedProvider.name}.`);
  }
  const selectedModel = modelName || chooseDefaultModel(
    configuredProvider,
    await listAvailableModels(configuredProvider, selectedApiKey)
  );
  return selectedProvider.generate(prompt, selectedModel, selectedApiKey);
}

export default callLLM;
