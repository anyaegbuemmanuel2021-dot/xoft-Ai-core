import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IncidentManager, redactSensitive } from '../src/operations/IncidentManager.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-incidents-'));
  const activity = [];
  const events = [];
  const manager = new IncidentManager({
    dataDir,
    activityLog: { log: (entry) => activity.push(entry) },
    eventBus: { emitEvent: (type, payload) => events.push({ type, payload }) },
    now: (() => { let t = Date.parse('2026-10-21T07:00:00.000Z'); return () => new Date(t += 1000); })(),
  });
  return { manager, dataDir, activity, events, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('incident capture redacts secrets from messages, stack, and context before durable storage', () => {
  const f = fixture();
  try {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const incident = f.manager.capture(new Error(`Request failed Authorization: Bearer superSecretToken api_key=${secret} https://example.test/?token=privateToken`), {
      source: 'provider.request',
      correlationId: 'request-123',
      context: { apiKey: secret, detail: `header=Bearer superSecretToken` },
    });
    const stored = JSON.stringify(f.manager.get(incident.id));
    assert.ok(!stored.includes(secret));
    assert.ok(!stored.includes('superSecretToken'));
    assert.ok(!stored.includes('privateToken'));
    assert.ok(stored.includes('[REDACTED]'));
    assert.equal(incident.correlationIds[0], 'request-123');
  } finally { f.cleanup(); }
});

test('identical open failures deduplicate while preserving new correlation IDs and context', () => {
  const f = fixture();
  try {
    const first = f.manager.capture(new Error('provider timed out'), {
      source: 'provider.openai', severity: 'warning', correlationId: 'req-1', context: { attempt: 1 },
    });
    const second = f.manager.capture(new Error('provider timed out'), {
      source: 'provider.openai', severity: 'error', correlationId: 'req-2', context: { attempt: 2 },
    });
    assert.equal(second.id, first.id);
    assert.equal(second.count, 2);
    assert.equal(second.severity, 'error');
    assert.deepEqual(second.correlationIds, ['req-1', 'req-2']);
    assert.equal(second.recentEvents.length, 2);
    assert.equal(f.manager.summary().open, 1);
    assert.ok(f.activity.some((entry) => entry.type === 'incident_created'));
    assert.ok(f.activity.some((entry) => entry.type === 'incident_updated'));
    assert.ok(f.events.some((entry) => entry.type === 'incident.created'));
  } finally { f.cleanup(); }
});

test('incident records survive manager restart and resolving one starts a new incident on recurrence', () => {
  const f = fixture();
  try {
    const firstManager = f.manager;
    const first = firstManager.capture(new Error('task failed'), { source: 'task.worker' });
    const restarted = new IncidentManager({ dataDir: f.dataDir });
    assert.equal(restarted.get(first.id).error.message, 'task failed');
    assert.equal(restarted.resolve(first.id, { resolvedBy: 'owner', note: 'reviewed' }).status, 'resolved');
    const second = restarted.capture(new Error('task failed'), { source: 'task.worker' });
    assert.notEqual(second.id, first.id);
    assert.equal(restarted.summary().open, 1);
    assert.equal(restarted.summary().total, 2);
  } finally { f.cleanup(); }
});

test('redaction covers bearer tokens, API key assignments, and query-string credentials', () => {
  const text = redactSensitive('Bearer abc.def token=abc123 api_key=secret123 https://x.test/?access_token=tokenValue');
  assert.ok(!text.includes('abc.def'));
  assert.ok(!text.includes('abc123'));
  assert.ok(!text.includes('secret123'));
  assert.ok(!text.includes('tokenValue'));
  assert.match(text, /REDACTED/);
});
