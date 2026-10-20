import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MissionAutopilot } from '../src/scheduler/MissionAutopilot.js';

function fixture({ emergency = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-autopilot-'));
  let current = new Date('2026-10-20T12:00:00.000Z');
  const runs = [];
  const logs = [];
  const scheduler = {
    rank({ emergency: stopped } = {}) {
      if (stopped) return { ranked: [], skipped: [{ id: 'm1', reason: 'emergency stop active' }] };
      return { ranked: [{ id: 'm1', score: 90 }, { id: 'm2', score: 70 }], skipped: [] };
    },
    async runBatch(ids, options) {
      runs.push({ ids, options });
      return ids.map((id) => ({ id, ok: true, status: 'completed' }));
    },
  };
  const autopilot = new MissionAutopilot({
    missionScheduler: scheduler,
    emergencyStop: { isActive: () => emergency },
    dataDir,
    now: () => new Date(current),
    activityLog: { log: (entry) => logs.push(entry) },
    eventBus: { emitEvent() {} },
  });
  return { autopilot, runs, logs, setNow: (date) => { current = new Date(date); }, cleanup: () => { autopilot.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('autopilot is opt-in and does not execute missions while disabled', async () => {
  const f = fixture();
  try {
    assert.equal(f.autopilot.status().enabled, false);
    assert.equal((await f.autopilot.tick()).status, 'disabled');
    assert.equal(f.runs.length, 0);
  } finally { f.cleanup(); }
});

test('autopilot runs only the configured number of deadline-ranked missions and persists the cycle', async () => {
  const f = fixture();
  try {
    f.autopilot.update({ enabled: true, intervalSeconds: 60, maxMissionsPerCycle: 1 });
    const result = await f.autopilot.tick();
    assert.equal(result.status, 'completed');
    assert.equal(result.selected, 1);
    assert.deepEqual(f.runs[0].ids, ['m1']);
    assert.equal(f.autopilot.status().lastRunStatus, 'completed');
    assert.ok(f.autopilot.status().nextRunAt);
    assert.equal(f.autopilot.status().lastRunSummary.results[0].status, 'completed');
  } finally { f.cleanup(); }
});

test('autopilot does not execute any mission while the emergency stop is active', async () => {
  const f = fixture({ emergency: true });
  try {
    f.autopilot.update({ enabled: true });
    const result = await f.autopilot.tick();
    assert.equal(result.status, 'blocked_emergency_stop');
    assert.equal(result.selected, 0);
    assert.equal(f.runs.length, 0);
  } finally { f.cleanup(); }
});

test('autopilot validates interval and batch bounds', () => {
  const f = fixture();
  try {
    assert.throws(() => f.autopilot.update({ intervalSeconds: 10 }), /30 to 3600/);
    assert.throws(() => f.autopilot.update({ maxMissionsPerCycle: 6 }), /1 to 5/);
  } finally { f.cleanup(); }
});

test('autopilot report flags overdue and soon-due active missions', async () => {
  const f = fixture();
  try {
    f.autopilot.missionScheduler.manager = {
      list: () => [
        { id: 'late', goal: 'Overdue deliverable', status: 'planned', deadline: '2026-10-20T11:00:00.000Z' },
        { id: 'soon', goal: 'Due soon', status: 'created', deadline: '2026-10-21T11:00:00.000Z' },
        { id: 'done', goal: 'Completed already', status: 'completed', deadline: '2026-10-20T10:00:00.000Z' },
      ],
    };
    f.autopilot.update({ enabled: true });
    const result = await f.autopilot.tick();
    assert.deepEqual(result.deadlineWarnings.map((item) => item.id), ['late', 'soon']);
    assert.ok(result.deadlineWarnings[0].msRemaining < 0);
  } finally { f.cleanup(); }
});
