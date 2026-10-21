import test from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from './Orchestrator.js';

test('Orchestrator.stream emits deltas and commits the completed assistant turn', async () => {
  const turns = new Map();
  const memory = {
    vectorEnabled: false,
    addTurn(sessionId, role, content) {
      const list = turns.get(sessionId) ?? [];
      list.push({ role, content });
      turns.set(sessionId, list);
    },
    getConversation(sessionId) { return [...(turns.get(sessionId) ?? [])]; },
  };
  let receivedSignal;
  const router = {
    async *stream(_taskType, params) {
      receivedSignal = params.signal;
      yield { type: 'text', delta: 'Hello' };
      yield { type: 'text', delta: ' there' };
      yield { type: 'done', result: { text: 'Hello there', usage: { inputTokens: 2, outputTokens: 2 }, raw: 'mock' } };
    },
  };
  const orchestrator = new Orchestrator({ router, memory });
  orchestrator.intentDetector = { detect: async () => ({ intent: 'conversation' }) };
  const controller = new AbortController();
  const events = [];
  for await (const event of orchestrator.stream('session-1', 'Hi', { signal: controller.signal })) events.push(event);

  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.delta), ['Hello', ' there']);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).result.reply, 'Hello there');
  assert.equal(events.at(-1).result.meta.provider, 'mock');
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(turns.get('session-1'), [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello there' },
  ]);
});

test('Orchestrator.stream does not store an incomplete assistant turn after provider failure', async () => {
  const turns = new Map();
  const memory = {
    vectorEnabled: false,
    addTurn(sessionId, role, content) {
      const list = turns.get(sessionId) ?? [];
      list.push({ role, content });
      turns.set(sessionId, list);
    },
    getConversation(sessionId) { return [...(turns.get(sessionId) ?? [])]; },
  };
  const router = {
    async *stream() {
      yield { type: 'text', delta: 'partial' };
      throw new Error('truncated stream');
    },
  };
  const orchestrator = new Orchestrator({ router, memory });
  orchestrator.intentDetector = { detect: async () => ({ intent: 'conversation' }) };
  await assert.rejects(async () => {
    for await (const _event of orchestrator.stream('session-2', 'Hi')) { /* consume */ }
  }, /truncated stream/);
  assert.deepEqual(turns.get('session-2'), [{ role: 'user', content: 'Hi' }]);
});
