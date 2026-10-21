import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IncidentTriageService } from '../src/operations/IncidentTriageService.js';

function fixture({ response, sandboxOk = true, stackPath = 'src/example.js' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-triage-'));
  const filePath = path.join(dataDir, stackPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'export const answer = 1;\n');
  const incident = {
    id: 'incident-1', status: 'open', source: 'unit.test', severity: 'error', count: 1,
    error: { name: 'Error', message: 'Example failure', stack: `Error: Example failure\n    at test (${filePath}:1:1)` },
    recentEvents: [],
  };
  const savedProposals = [];
  const events = [];
  const logs = [];
  const calls = [];
  const selfDev = {
    repoRoot: dataDir,
    _checkPath(rel) {
      if (rel.startsWith('src/security/')) throw new Error('protected');
      return rel;
    },
    propose(input) {
      savedProposals.push(input);
      return { id: 'proposal-1', title: input.title, status: 'proposed' };
    },
    async sandboxTest(id) {
      calls.push(['sandboxTest', id]);
      return { ok: sandboxOk, ranAt: '2026-10-21T08:00:00.000Z', steps: [{ name: 'tests', ok: sandboxOk, output: 'not returned to API' }] };
    },
  };
  const router = { async complete(_taskType, params) {
    calls.push(['complete', params]);
    return { text: JSON.stringify(response ?? { diagnosis: 'The example module returned an incorrect value.', recommendedActions: ['Add a regression test.'], repair: null }) };
  } };
  const incidentManager = {
    get(id) { return id === incident.id ? incident : null; },
    capture(error, options) { logs.push({ error, options }); return { id: 'triage-error-incident' }; },
  };
  const injectionGuard = { process(text, source) { calls.push(['guard', source]); return { wrapped: `<<UNTRUSTED_TEST>>\n${text}\n<<END_UNTRUSTED_TEST>>` }; } };
  const service = new IncidentTriageService({
    incidentManager, selfDev, router, injectionGuard,
    activityLog: { log: (entry) => logs.push(entry) },
    eventBus: { emitEvent: (type, payload) => events.push({ type, payload }) },
    dataDir,
  });
  return { service, dataDir, incident, savedProposals, calls, events, logs, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('incident triage can create and sandbox a bounded repair proposal but never applies it', async () => {
  const f = fixture({ response: {
    diagnosis: 'The module returns the wrong value.',
    recommendedActions: ['Verify the expected result.', 'Keep the change small.'],
    repair: { title: 'Correct answer value', rationale: 'The incident points to a wrong constant.', files: { 'src/example.js': 'export const answer = 2;\n' } },
  } });
  try {
    const result = await f.service.triage('incident-1', { correlationId: 'req-triage-1' });
    assert.equal(result.status, 'completed');
    assert.equal(result.repairProposal.id, 'proposal-1');
    assert.equal(result.repairProposal.status, 'verified_waiting_for_human_approval');
    assert.equal(result.repairProposal.sandbox.ok, true);
    assert.equal(f.savedProposals.length, 1);
    assert.equal(f.calls.some(([name]) => name === 'sandboxTest'), true);
    assert.equal(f.calls.some(([name]) => name === 'guard'), true);
    assert.equal(fs.readFileSync(path.join(f.dataDir, 'src/example.js'), 'utf8'), 'export const answer = 1;\n', 'live source is unchanged');
    assert.equal(f.service.list({ incidentId: 'incident-1' }).length, 1);
    assert.ok(f.events.some((event) => event.type === 'incident.triaged'));
  } finally { f.cleanup(); }
});

test('incident triage rejects any repair path that was not derived from the recorded stack', async () => {
  const f = fixture({ response: {
    diagnosis: 'A protected auth file should not be changed.',
    recommendedActions: ['Inspect the auth boundary manually.'],
    repair: { title: 'Unsafe edit', rationale: 'attempted path escape', files: { 'src/security/ApiKeyAuth.js': 'export const unsafe = true;\n' } },
  } });
  try {
    const result = await f.service.triage('incident-1');
    assert.equal(result.repairProposal, null);
    assert.match(result.repairRejectedReason, /not provided as a candidate/);
    assert.equal(f.savedProposals.length, 0);
    assert.equal(f.calls.some(([name]) => name === 'sandboxTest'), false);
  } finally { f.cleanup(); }
});

test('a failed sandbox leaves the proposal non-applicable and explicitly reports the failure', async () => {
  const f = fixture({ sandboxOk: false, response: {
    diagnosis: 'The source constant appears incorrect.',
    recommendedActions: ['Review the failing test output.'],
    repair: { title: 'Try corrected constant', rationale: 'Minimal change.', files: { 'src/example.js': 'export const answer = 2;\n' } },
  } });
  try {
    const result = await f.service.triage('incident-1');
    assert.equal(result.repairProposal.status, 'sandbox_failed');
    assert.equal(result.repairProposal.sandbox.ok, false);
    assert.match(result.repairRejectedReason, /Sandbox verification failed/);
  } finally { f.cleanup(); }
});

test('triage without a safe source candidate produces diagnosis only', async () => {
  const f = fixture({ stackPath: 'src/security/ApiKeyAuth.js', response: {
    diagnosis: 'Authentication code needs manual review.',
    recommendedActions: ['Review the auth change manually.'],
    repair: { title: 'Unsafe auth patch', rationale: 'not allowed', files: { 'src/security/ApiKeyAuth.js': 'export const unsafe = true;\n' } },
  } });
  try {
    const result = await f.service.triage('incident-1');
    assert.equal(result.candidateFiles.length, 0);
    assert.equal(result.repairProposal, null);
    assert.match(result.repairRejectedReason, /No safe, small source file/);
    assert.equal(f.savedProposals.length, 0);
  } finally { f.cleanup(); }
});
