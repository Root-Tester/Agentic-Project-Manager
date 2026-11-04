import axios from 'axios';
import { toProviderError } from '../provider-error.js';

const API_URL = 'https://api.openai.com/v1';
const NON_TEXT_MODEL = /(embedding|audio|transcri|tts|realtime|search|moderation|dall-e|whisper|image|instruct|computer-use)/i;

export async function listModels(apiKey) {
  try {
    const response = await axios.get(`${API_URL}/models`, {
      timeout: 30_000,
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    return (response.data?.data || [])
      .filter(model =>
        /^(gpt-|chatgpt-|o[134](?:-|$))/i.test(model.id)
        && !NON_TEXT_MODEL.test(model.id)
        && (!model.shutdown_date || model.shutdown_date >= new Date().toISOString().slice(0, 10))
      )
      .sort((left, right) => (right.created || 0) - (left.created || 0))
      .map(model => ({ id: model.id, name: model.id }));
  } catch (error) {
    throw toProviderError('OpenAI', error, apiKey);
  }
}

export async function generate(prompt, modelName, apiKey) {
  try {
    const response = await axios.post(`${API_URL}/responses`, {
      model: modelName,
      input: prompt,
      text: { format: { type: 'json_object' } }
    }, {
      timeout: 120_000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const text = response.data?.output_text
      || response.data?.output
        ?.filter(item => item.type === 'message')
        .flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text')
        .map(item => item.text)
        .join('\n');
    if (!text) throw new Error('Empty response from OpenAI API.');
    return text;
  } catch (error) {
    throw toProviderError('OpenAI', error, apiKey);
  }
}
