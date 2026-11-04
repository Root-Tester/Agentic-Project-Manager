import axios from 'axios';
import { ProviderApiError, toProviderError } from '../provider-error.js';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 120_000;

export async function listModels(apiKey) {
  const models = new Map();
  let pageToken;
  try {
    for (let page = 0; page < 100; page++) {
      const response = await axios.get(`${API_URL}/models`, {
        timeout: 30_000,
        headers: { 'x-goog-api-key': apiKey },
        params: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) }
      });
      for (const model of response.data?.models || []) {
        if (!model.supportedGenerationMethods?.includes('generateContent')) continue;
        const id = model.baseModelId || model.name?.replace(/^models\//, '');
        if (id) models.set(id, { id, name: model.displayName || id });
      }
      pageToken = response.data?.nextPageToken;
      if (!pageToken) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        return [...models.values()].sort((left, right) => {
          const flashOrder = Number(/-flash(?:-|$)/i.test(right.id)) - Number(/-flash(?:-|$)/i.test(left.id));
          return flashOrder || collator.compare(right.id, left.id);
        });
      }
    }
    throw new Error('Gemini model list exceeded the pagination limit.');
  } catch (error) {
    throw toProviderError('Google Gemini', error, apiKey);
  }
}

export async function generate(prompt, modelName, apiKey) {
  const model = encodeURIComponent(modelName);
  try {
    const response = await axios.post(`${API_URL}/models/${model}:generateContent`, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    }, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
    });

    const candidate = response.data?.candidates?.[0];
    if (!candidate) {
      const blockReason = response.data?.promptFeedback?.blockReason;
      throw new ProviderApiError(
        'Google Gemini',
        blockReason
          ? `the prompt was blocked (${blockReason}). Review the input and safety settings.`
          : 'the response contained no candidates. Check the selected model and retry.'
      );
    }
    const text = (candidate.content?.parts || [])
      .filter(part => typeof part.text === 'string')
      .map(part => part.text)
      .join('');
    if (!text) {
      throw new ProviderApiError(
        'Google Gemini',
        `the response contained no text${candidate.finishReason ? ` (finish reason: ${candidate.finishReason})` : ''}. Try a different model or prompt.`
      );
    }
    return text;
  } catch (error) {
    throw toProviderError('Google Gemini', error, apiKey);
  }
}
