import assert from 'node:assert/strict';
import axios from 'axios';
import test from 'node:test';
import { listAvailableModels, listConfiguredModels } from '../../shared/ai/index.js';
import { generate as generateAnthropic } from '../../shared/ai/providers/anthropic.js';
import { generate as generateGemini } from '../../shared/ai/providers/gemini.js';
import { generate as generateOpenAI } from '../../shared/ai/providers/openai.js';

test('provider model discovery returns only usable, account-available models', async () => {
  const originalGet = axios.get;
  const requests = [];
  axios.get = async (url, config) => {
    requests.push({ url, config });
    if (url.endsWith('/models') && url.includes('generativelanguage.googleapis.com')) {
      if (config.params.pageToken) {
        return {
          data: {
            models: [
              { name: 'models/gemini-3.1-flash', baseModelId: 'gemini-3.1-flash', displayName: 'Gemini 3.1 Flash', supportedGenerationMethods: ['generateContent'] }
            ]
          }
        };
      }
      return {
        data: {
          models: [
            { name: 'models/gemini-3.0-flash', baseModelId: 'gemini-3.0-flash', displayName: 'Gemini 3.0 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-embed', baseModelId: 'gemini-embed', supportedGenerationMethods: ['embedContent'] }
          ],
          nextPageToken: 'next-page'
        }
      };
    }
    if (url.endsWith('/models') && url.includes('api.openai.com')) {
      return {
        data: {
          data: [
            { id: 'gpt-5.1-mini', created: 20 },
            { id: 'text-embedding-3-small', created: 30 },
            { id: 'gpt-4o-mini-transcribe', created: 40 },
            { id: 'gpt-retired', created: 50, shutdown_date: '2020-01-01' },
            { id: 'o3', created: 10 }
          ]
        }
      };
    }
    return {
      data: {
        data: config.params.after_id
          ? [{ id: 'claude-opus-latest', display_name: 'Claude Opus' }]
          : [{ id: 'claude-sonnet-latest', display_name: 'Claude Sonnet' }],
        has_more: !config.params.after_id,
        ...(config.params.after_id ? {} : { last_id: 'claude-sonnet-latest' })
      }
    };
  };

  try {
    assert.deepEqual(await listAvailableModels('gemini', 'gem-key'), [
      { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash' },
      { id: 'gemini-3.0-flash', name: 'Gemini 3.0 Flash' }
    ]);
    assert.deepEqual(await listAvailableModels('openai', 'openai-key'), [
      { id: 'gpt-5.1-mini', name: 'gpt-5.1-mini' },
      { id: 'o3', name: 'o3' }
    ]);
    assert.deepEqual(await listAvailableModels('anthropic', 'anthropic-key'), [
      { id: 'claude-sonnet-latest', name: 'Claude Sonnet' },
      { id: 'claude-opus-latest', name: 'Claude Opus' }
    ]);
    assert.equal(requests[3].url, 'https://api.anthropic.com/v1/models');
    assert.equal(requests[0].config.headers['x-goog-api-key'], 'gem-key');
    assert.equal(requests[0].url.includes('gem-key'), false);
    assert.equal(requests[2].config.headers.Authorization, 'Bearer openai-key');
    assert.equal(requests[3].config.headers['x-api-key'], 'anthropic-key');
  } finally {
    axios.get = originalGet;
  }
});

test('hosted model discovery reports missing backend provider credentials', async () => {
  await assert.rejects(
    listConfiguredModels('openai', {}),
    /OpenAI is not configured on the backend/
  );
});

test('Gemini sends its key in a header and reports provider authentication errors', async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body, config) => {
    request = { url, body, config };
    return { data: { candidates: [{ content: { parts: [{ text: '{"tasks":[]}' }] } }] } };
  };
  try {
    assert.equal(await generateGemini('prompt', 'gemini-3.0-flash', 'gem-secret'), '{"tasks":[]}');
    assert.equal(request.config.headers['x-goog-api-key'], 'gem-secret');
    assert.equal(request.url.includes('gem-secret'), false);
    assert.match(request.url, /gemini-3\.0-flash:generateContent$/);
  } finally {
    axios.post = originalPost;
  }

  const originalGet = axios.get;
  axios.get = async () => {
    const error = new Error('Rejected');
    error.response = { status: 401, data: { error: { message: 'Invalid API key' } } };
    throw error;
  };
  try {
    await assert.rejects(
      listAvailableModels('gemini', 'gem-secret'),
      error => error.statusCode === 502 && /API key was rejected/.test(error.message) && !error.message.includes('gem-secret')
    );
  } finally {
    axios.get = originalGet;
  }
});

test('Gemini reports blocked and empty candidates as actionable provider errors', async () => {
  const originalPost = axios.post;
  axios.post = async () => ({
    data: { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }
  });
  try {
    await assert.rejects(
      generateGemini('prompt', 'gemini-flash', 'gem-key'),
      /prompt was blocked \(SAFETY\)/
    );
    axios.post = async () => ({
      data: { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }
    });
    await assert.rejects(
      generateGemini('prompt', 'gemini-flash', 'gem-key'),
      /response contained no text \(finish reason: MAX_TOKENS\)/
    );
  } finally {
    axios.post = originalPost;
  }
});

test('Anthropic generation sends the current Messages API request and extracts text', async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body, config) => {
    request = { url, body, config };
    return { data: { content: [{ type: 'text', text: '{"tasks":[]}' }] } };
  };
  try {
    assert.equal(await generateAnthropic('prompt', 'claude-sonnet-latest', 'anthropic-key'), '{"tasks":[]}');
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.body.model, 'claude-sonnet-latest');
    assert.equal(request.config.headers['x-api-key'], 'anthropic-key');
    assert.equal(request.config.headers['anthropic-version'], '2023-06-01');
  } finally {
    axios.post = originalPost;
  }
});

test('OpenAI generation uses the selected current model and returns actionable API errors', async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body, config) => {
    request = { url, body, config };
    return {
      data: {
        output: [
          { type: 'reasoning' },
          { type: 'message', content: [{ type: 'output_text', text: '{"tasks":[]}' }] }
        ]
      }
    };
  };
  try {
    assert.equal(await generateOpenAI('prompt', 'gpt-5.1-mini', 'openai-key'), '{"tasks":[]}');
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.equal(request.body.model, 'gpt-5.1-mini');
    assert.deepEqual(request.body.text, { format: { type: 'json_object' } });
    assert.equal(request.config.headers.Authorization, 'Bearer openai-key');
  } finally {
    axios.post = originalPost;
  }

  axios.post = async () => {
    const error = new Error('Rate limited');
    error.response = { status: 429, data: { error: { message: 'Rate limit reached' } } };
    throw error;
  };
  try {
    await assert.rejects(
      generateOpenAI('prompt', 'gpt-5.1-mini', 'openai-key'),
      /rate limit or quota exceeded/
    );
  } finally {
    axios.post = originalPost;
  }
});
