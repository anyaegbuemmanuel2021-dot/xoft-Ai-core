import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutiveBrain } from './ExecutiveBrain.js';

test('preflight briefing is written to activity log and broadcast before execution', () => {
  const logged = [];
  const emitted = [];
  const brain = new ExecutiveBrain({
    router: {},
    memory: {},
    orchestrator: {},
    taskPlanner: {},
    approvalSystem: {},
    worldState: {},
    activityLog: { log: (entry) => logged.push(entry) },
    eventBus: { emitEvent: (name, payload) => emitted.push({ name, payload }) },
  });

  const task = {
    id: 'task-123',
    goal: 'Prepare a report',
    steps: [
      { description: 'Research the topic', toolName: 'research.search', riskLevel: 'LOW' },
      { description: 'Draft the report', toolName: 'document.create', riskLevel: 'SAFE' },
    ],
  };
  const preview = { requiresApproval: false, maxRiskName: 'LOW' };
  const briefing = brain._publishPreflightBriefing(task, preview, 'session-1');

  assert.equal(briefing.taskId, 'task-123');
  assert.equal(briefing.sessionId, 'session-1');
  assert.equal(briefing.status, 'starting');
  assert.equal(briefing.requiresApproval, false);
  assert.deepEqual(briefing.steps.map((s) => s.description), ['Research the topic', 'Draft the report']);
  assert.equal(logged[0].type, 'executive_preflight_briefing');
  assert.equal(emitted[0].name, 'executive.preflight_briefing');
  assert.equal(emitted[0].payload.taskId, 'task-123');
});

test('preflight briefing marks risky plans as awaiting confirmation', () => {
  const brain = new ExecutiveBrain({
    router: {}, memory: {}, orchestrator: {}, taskPlanner: {}, approvalSystem: {}, worldState: {},
    activityLog: { log() {} },
    eventBus: { emitEvent() {} },
  });
  const briefing = brain._publishPreflightBriefing(
    { id: 'task-456', goal: 'Send an email', steps: [{ description: 'Send email', toolName: 'email.send', riskLevel: 'HIGH_IMPACT' }] },
    { requiresApproval: true, maxRiskName: 'HIGH_IMPACT' },
    'session-2',
  );
  assert.equal(briefing.status, 'awaiting_confirmation');
  assert.equal(briefing.requiresApproval, true);
  assert.equal(briefing.maxRiskName, 'HIGH_IMPACT');
});
