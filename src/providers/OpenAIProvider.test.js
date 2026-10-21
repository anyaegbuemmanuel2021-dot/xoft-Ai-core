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

test('OpenAIProvider.stream accepts a standard JSON completion from non-streaming compatible gateways', async () => {
  const provider = new OpenAIProvider();
  provider.isConfigured = () => true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Gateway reply' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const events = [];
    for await (const event of provider.stream({ messages: [{ role: 'user', content: 'Hi' }] })) events.push(event);
    assert.deepEqual(events.map((event) => event.type), ['text', 'done']);
    assert.equal(events[0].delta, 'Gateway reply');
    assert.equal(events[1].result.text, 'Gateway reply');
    assert.deepEqual(events[1].result.usage, { inputTokens: 4, outputTokens: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAIProvider.stream forwards AbortSignal to fetch', async () => {
  const provider = new OpenAIProvider();
  provider.isConfigured = () => true;
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let receivedSignal;
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    for await (const _event of provider.stream({ messages: [], signal: controller.signal })) { /* consume */ }
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('OpenAIProvider.stream rejects truncated SSE even when partial text was received', async () => {
  const provider = new OpenAIProvider();
  provider.isConfigured = () => true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  try {
    const events = [];
    await assert.rejects(async () => {
      for await (const event of provider.stream({ messages: [] })) events.push(event);
    }, /stream ended before a terminal marker/);
    assert.deepEqual(events.map((event) => event.type), ['text']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAIProvider.stream accepts [DONE] as a terminal marker when finish_reason is omitted', async () => {
  const provider = new OpenAIProvider();
  provider.isConfigured = () => true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  try {
    const events = [];
    for await (const event of provider.stream({ messages: [] })) events.push(event);
    assert.deepEqual(events.map((event) => event.type), ['text', 'done']);
    assert.equal(events.at(-1).result.text, 'complete');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('OpenAIProvider.stream accepts a final text delta carrying finish_reason in the same SSE event', async () => {
  const provider = new OpenAIProvider();
  provider.isConfigured = () => true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"complete answer"},"finish_reason":"stop"}]}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  try {
    const events = [];
    for await (const event of provider.stream({ messages: [] })) events.push(event);
    assert.deepEqual(events.map((event) => event.type), ['text', 'done']);
    assert.equal(events[0].delta, 'complete answer');
    assert.equal(events[1].result.text, 'complete answer');
    assert.deepEqual(events[1].result.usage, { inputTokens: 2, outputTokens: 3 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
