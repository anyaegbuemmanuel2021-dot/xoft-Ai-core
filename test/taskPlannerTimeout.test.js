import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskPlanner } from '../src/planner/TaskPlanner.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { ApprovalSystem } from '../src/approval/ApprovalSystem.js';
import { ActivityLog } from '../src/activity/ActivityLog.js';
import { EventBus } from '../src/events/EventBus.js';

test('TaskPlanner deadline aborts the tool and leaves an ambiguous execution record instead of retrying blindly', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-task-timeout-'));
  const activityLog = new ActivityLog({ dataDir });
  const eventBus = new EventBus({ activityLog });
  const toolRegistry = new ToolRegistry({ defaultDeviceId: 'local' });
  let receivedSignal = null;
  let calls = 0;
  toolRegistry.register({
    name: 'test.hanging-task-tool',
    description: 'waits until its task deadline aborts it',
    inputSchema: {},
    riskLevel: 0,
    requiredPermissions: [],
    status: 'implemented',
    async run(_input, context) {
      calls += 1;
      receivedSignal = context.signal;
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason ?? new Error('aborted')), { once: true });
      });
    },
  });
  const approvalSystem = new ApprovalSystem({ activityLog, eventBus, dataDir });
  const router = {
    async complete() {
      return { text: JSON.stringify({ steps: [{ id: 'step-1', toolName: 'test.hanging-task-tool', input: {}, dependsOn: [], description: 'run hanging test tool' }], blockedReason: null }) };
    },
  };
  const planner = new TaskPlanner({ router, toolRegistry, approvalSystem, activityLog, memory: null, eventBus, dataDir, maxDurationMs: 1000 });

  try {
    const task = await planner.plan('run a hanging test tool');
    await assert.rejects(() => planner.execute(task.id), (error) => error.code === 'TASK_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const savedTask = planner._getTask(task.id);
    assert.equal(savedTask.status, 'timed_out');
    assert.equal(savedTask.steps[0].status, 'failed');
    assert.equal(savedTask.steps[0].ambiguousExecution, true);
    assert.equal(receivedSignal.aborted, true);
    assert.equal(calls, 1);
    const dangling = planner.executionRecordStore.findDangling(savedTask.steps[0].idempotencyKey);
    assert.ok(dangling, 'execution ledger must preserve uncertainty rather than recording a definite failure');
    assert.equal(dangling.status, 'running');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('TaskPlanner external cancellation stops waiting promptly and preserves an ambiguous execution record', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-task-cancel-'));
  const activityLog = new ActivityLog({ dataDir });
  const eventBus = new EventBus({ activityLog });
  const toolRegistry = new ToolRegistry({ defaultDeviceId: 'local' });
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let receivedSignal = null;
  toolRegistry.register({
    name: 'test.noncooperative-task-tool',
    description: 'ignores abort after start',
    inputSchema: {},
    riskLevel: 0,
    requiredPermissions: [],
    status: 'implemented',
    async run(_input, context) {
      receivedSignal = context.signal;
      startedResolve();
      return new Promise(() => {});
    },
  });
  const approvalSystem = new ApprovalSystem({ activityLog, eventBus, dataDir });
  const router = {
    async complete() {
      return { text: JSON.stringify({ steps: [{ id: 'step-cancel', toolName: 'test.noncooperative-task-tool', input: {}, dependsOn: [], description: 'run noncooperative tool' }], blockedReason: null }) };
    },
  };
  const planner = new TaskPlanner({ router, toolRegistry, approvalSystem, activityLog, memory: null, eventBus, dataDir, maxDurationMs: 10000 });
  const controller = new AbortController();

  try {
    const task = await planner.plan('run a cancellable test tool');
    const running = planner.execute(task.id, { signal: controller.signal });
    await started;
    const reason = Object.assign(new Error('cancel from owner'), { code: 'BACKGROUND_JOB_CANCELLED' });
    controller.abort(reason);
    await assert.rejects(() => running, (error) => error.code === 'BACKGROUND_JOB_CANCELLED');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const savedTask = planner._getTask(task.id);
    assert.equal(savedTask.status, 'cancelled');
    assert.equal(savedTask.steps[0].status, 'cancelled');
    assert.equal(savedTask.steps[0].ambiguousExecution, true);
    assert.equal(receivedSignal.aborted, true);
    const dangling = planner.executionRecordStore.findDangling(savedTask.steps[0].idempotencyKey);
    assert.ok(dangling, 'the execution ledger must retain uncertainty when the tool ignores cancellation');
    assert.equal(dangling.status, 'running');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('TaskPlanner.cancel aborts a currently running task and preserves the uncertain step ledger', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-task-direct-cancel-'));
  const activityLog = new ActivityLog({ dataDir });
  const eventBus = new EventBus({ activityLog });
  const toolRegistry = new ToolRegistry({ defaultDeviceId: 'local' });
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let receivedSignal = null;
  toolRegistry.register({
    name: 'test.direct-cancel-tool',
    description: 'ignores abort after start',
    inputSchema: {},
    riskLevel: 0,
    requiredPermissions: [],
    status: 'implemented',
    async run(_input, context) {
      receivedSignal = context.signal;
      startedResolve();
      return new Promise(() => {});
    },
  });
  const approvalSystem = new ApprovalSystem({ activityLog, eventBus, dataDir });
  const router = {
    async complete() {
      return { text: JSON.stringify({ steps: [{ id: 'step-direct-cancel', toolName: 'test.direct-cancel-tool', input: {}, dependsOn: [], description: 'run direct-cancel tool' }], blockedReason: null }) };
    },
  };
  const planner = new TaskPlanner({ router, toolRegistry, approvalSystem, activityLog, memory: null, eventBus, dataDir, maxDurationMs: 10000 });

  try {
    const task = await planner.plan('run a direct-cancel test tool');
    const running = planner.execute(task.id);
    await started;
    const cancelled = planner.cancel(task.id);
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(() => running, (error) => error.code === 'BACKGROUND_JOB_CANCELLED');
    const savedTask = planner._getTask(task.id);
    assert.equal(savedTask.status, 'cancelled');
    assert.equal(savedTask.steps[0].status, 'cancelled');
    assert.equal(savedTask.steps[0].ambiguousExecution, true);
    assert.equal(receivedSignal.aborted, true);
    const dangling = planner.executionRecordStore.findDangling(savedTask.steps[0].idempotencyKey);
    assert.ok(dangling);
    assert.equal(dangling.status, 'running');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
