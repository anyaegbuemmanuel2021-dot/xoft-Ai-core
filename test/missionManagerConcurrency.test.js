import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MissionManager } from '../src/missions/MissionManager.js';

test('a mission cannot be executed concurrently twice', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-mission-lock-'));
  let signalStarted;
  let finishExecution;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const execution = new Promise((resolve) => { finishExecution = resolve; });
  const taskPlanner = {
    async plan() { return { id: 'task-1', status: 'planned' }; },
    async execute() { signalStarted(); return execution; },
  };
  const manager = new MissionManager({
    taskPlanner,
    dataDir,
    activityLog: { log() {} },
    eventBus: { emitEvent() {} },
  });
  try {
    const mission = manager.create('Complete a bounded task');
    const firstRun = manager.run(mission.id);
    await started;
    await assert.rejects(manager.run(mission.id), /already running/);
    finishExecution({ id: 'task-1', status: 'completed' });
    const result = await firstRun;
    assert.equal(result.status, 'completed');
    assert.equal(result.usage.runs, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
