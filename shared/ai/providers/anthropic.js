import axios from 'axios';
import { toProviderError } from '../provider-error.js';

const API_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

export async function listModels(apiKey) {
  try {
    const models = [];
    let afterId;
    for (let page = 0; page < 100; page++) {
      const response = await axios.get(`${API_URL}/models`, {
        timeout: 30_000,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION
        },
        params: { limit: 1000, lifecycle: 'active', ...(afterId ? { after_id: afterId } : {}) }
      });
      for (const model of response.data?.data || []) {
        if (model.id) models.push({ id: model.id, name: model.display_name || model.id });
      }
      if (!response.data?.has_more) return models;
      afterId = response.data.last_id;
      if (!afterId) throw new Error('Anthropic model response omitted its pagination cursor.');
    }
    throw new Error('Anthropic model list exceeded the pagination limit.');
  } catch (error) {
    throw toProviderError('Anthropic', error, apiKey);
  }
}

export async function generate(prompt, modelName, apiKey) {
  try {
    const response = await axios.post(`${API_URL}/messages`, {
      model: modelName,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    }, {
      timeout: 120_000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION
      }
    });

    const text = response.data?.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Anthropic API.');
    return text;
  } catch (error) {
    throw toProviderError('Anthropic', error, apiKey);
  }
}
