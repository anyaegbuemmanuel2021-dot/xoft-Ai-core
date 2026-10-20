import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from './OpenAIProvider.js';

test('OpenAIProvider.stream emits text deltas and final usage', async () => {
  const provider = new OpenAIProvider({ fast: true });
  provider.isConfigured = () => true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.stream, true);
    return new Response([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const events = [];
    for await (const event of provider.stream({ messages: [{ role: 'user', content: 'Hi' }] })) events.push(event);
    assert.deepEqual(events.filter((e) => e.type === 'text').map((e) => e.delta), ['Hello', ' world']);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).result.text, 'Hello world');
    assert.deepEqual(events.at(-1).result.usage, { inputTokens: 3, outputTokens: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAIProvider.stream uses complete() for tool-enabled requests', async () => {
  const provider = new OpenAIProvider();
  provider.isConfigured = () => true;
  provider.complete = async () => ({ text: 'tool result', toolCalls: [{ name: 'x', input: {} }], usage: { inputTokens: 1, outputTokens: 1 }, raw: 'openai' });
  const events = [];
  for await (const event of provider.stream({ messages: [], tools: [{ name: 'x', inputSchema: {} }] })) events.push(event);
  assert.deepEqual(events.map((e) => e.type), ['text', 'done']);
  assert.equal(events.at(-1).result.toolCalls[0].name, 'x');
});
