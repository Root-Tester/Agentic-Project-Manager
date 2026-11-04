import assert from 'node:assert/strict';
import test from 'node:test';
import { callLLM } from '../../shared/ai/index.js';

test('AI orchestration uses the mock response and validates explicit providers', async () => {
  const previousMock = process.env.MOCK_LLM_RESPONSE;
  process.env.MOCK_LLM_RESPONSE = '{"tasks":[]}';
  try {
    assert.equal(await callLLM('prompt'), '{"tasks":[]}');
  } finally {
    if (previousMock === undefined) delete process.env.MOCK_LLM_RESPONSE;
    else process.env.MOCK_LLM_RESPONSE = previousMock;
  }

  await assert.rejects(
    callLLM('prompt', undefined, { provider: 'unregistered', apiKey: 'key' }),
    /supported LLM provider/
  );
});
