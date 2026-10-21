import { JsonStore } from '../persistence/JsonStore.js';

const DEFAULTS = Object.freeze({
  enabled: false,
  intervalSeconds: 60,
  maxMissionsPerCycle: 1,
  lastRunAt: null,
  lastRunStatus: 'not_run',
  lastRunSummary: null,
  nextRunAt: null,
});

/**
 * Persistent opt-in mission autopilot.
 *
 * It only selects missions already present in MissionManager and delegates all
 * execution to MissionScheduler -> MissionManager -> TaskPlanner. Existing
 * permissions, approvals, mission budgets, stuck detection and emergency stop
 * remain authoritative. This scheduler does not invent tools or bypass gates.
 */
export class MissionAutopilot {
  constructor({ missionScheduler, emergencyStop, dataDir = './data', sqliteStore = null, activityLog, eventBus, incidentManager = null, now = () => new Date() } = {}) {
    this.missionScheduler = missionScheduler;
    this.emergencyStop = emergencyStop;
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.incidentManager = incidentManager;
    this.now = now;
    this.store = new JsonStore({ dataDir, fileName: 'mission-autopilot.json', kvKey: 'mission-autopilot', defaultValue: { settings: DEFAULTS }, sqliteStore });
    this.timer = null;
    this.inFlight = false;
  }

  settings() {
    return { ...DEFAULTS, ...(this.store.load().settings ?? {}) };
  }

  status() {
    return { ...this.settings(), schedulerRunning: Boolean(this.timer), inFlight: this.inFlight };
  }

  update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Autopilot settings must be an object');
    const current = this.settings();
    const next = { ...current };
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') throw new Error('enabled must be boolean');
      next.enabled = patch.enabled;
    }
    if ('intervalSeconds' in patch) {
      const n = Number(patch.intervalSeconds);
      if (!Number.isInteger(n) || n < 30 || n > 3600) throw new Error('intervalSeconds must be an integer from 30 to 3600');
      next.intervalSeconds = n;
    }
    if ('maxMissionsPerCycle' in patch) {
      const n = Number(patch.maxMissionsPerCycle);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('maxMissionsPerCycle must be an integer from 1 to 5');
      next.maxMissionsPerCycle = n;
    }
    if (next.enabled && (!current.enabled || !next.nextRunAt)) next.nextRunAt = this.now().toISOString();
    if (!next.enabled) next.nextRunAt = null;
    this.store.save({ settings: next });
    this.activityLog?.log({ type: 'mission_autopilot_settings_updated', detail: { enabled: next.enabled, intervalSeconds: next.intervalSeconds, maxMissionsPerCycle: next.maxMissionsPerCycle } });
    return this.status();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((err) => this._recordError(err)), 15_000);
    this.timer.unref?.();
    this.tick().catch((err) => this._recordError(err));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const s = this.settings();
    if (!s.enabled || this.inFlight) return { status: s.enabled ? 'busy' : 'disabled' };
    if (s.nextRunAt && this.now().getTime() < Date.parse(s.nextRunAt)) return { status: 'not_due', nextRunAt: s.nextRunAt };
    return this._runCycle(false);
  }

  async runNow() {
    if (this.inFlight) return { status: 'busy' };
    return this._runCycle(true);
  }

  async _runCycle(forced) {
    if (this.inFlight) return { status: 'busy' };
    this.inFlight = true;
    const startedAt = this.now();
    try {
      const emergency = Boolean(this.emergencyStop?.isActive?.());
      const ranking = this.missionScheduler.rank({ emergency });
      const settings = this.settings();
      const selected = ranking.ranked.slice(0, settings.maxMissionsPerCycle);
      const results = selected.length
        ? await this.missionScheduler.runBatch(selected.map((item) => item.id), { concurrency: 1 })
        : [];
      const finishedAt = this.now();
      const allMissions = this.missionScheduler.manager?.list?.() ?? [];
      const deadlineWarnings = allMissions
        .filter((mission) => mission.deadline && !['completed', 'cancelled'].includes(mission.status))
        .map((mission) => ({ id: mission.id, goal: mission.goal, status: mission.status, deadline: mission.deadline, msRemaining: Date.parse(mission.deadline) - finishedAt.getTime() }))
        .filter((mission) => Number.isFinite(mission.msRemaining) && mission.msRemaining <= 24 * 60 * 60 * 1000)
        .sort((a, b) => a.msRemaining - b.msRemaining)
        .slice(0, 20);
      const summary = {
        forced,
        emergencyStopActive: emergency,
        considered: ranking.ranked.length + ranking.skipped.length,
        selected: selected.length,
        selectedMissions: selected.map((mission) => ({ id: mission.id, goal: mission.goal, score: mission.score, reasons: mission.reasons })),
        skipped: ranking.skipped.length,
        skippedMissions: ranking.skipped.slice(0, 20),
        deadlineWarnings,
        results,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      };
      const status = emergency ? 'blocked_emergency_stop' : selected.length ? (results.every((r) => r.ok) ? 'completed' : 'partial') : 'idle';
      const current = this.settings();
      current.lastRunAt = finishedAt.toISOString();
      current.lastRunStatus = status;
      current.lastRunSummary = summary;
      current.nextRunAt = current.enabled ? new Date(finishedAt.getTime() + current.intervalSeconds * 1000).toISOString() : null;
      this.store.save({ settings: current });
      this.activityLog?.log({ type: 'mission_autopilot_cycle', detail: { status, ...summary } });
      this.eventBus?.emitEvent('mission.autopilot_cycle', { status, ...summary });
      return { status, ...summary, nextRunAt: current.nextRunAt };
    } finally {
      this.inFlight = false;
    }
  }

  _recordError(err) {
    const now = this.now();
    const current = this.settings();
    current.lastRunAt = now.toISOString();
    current.lastRunStatus = 'failed';
    let incident = null;
    try { incident = this.incidentManager?.capture(err, { source: 'mission_autopilot', severity: 'error', context: { enabled: current.enabled, lastRunAt: current.lastRunAt } }) ?? null; } catch { /* keep the scheduler's own state durable */ }
    const safeError = this.incidentManager?.redact(err?.message ?? err) ?? String(err?.message ?? err).slice(0, 500);
    current.lastRunSummary = { error: safeError.slice(0, 500), incidentId: incident?.id ?? null };
    current.nextRunAt = current.enabled ? new Date(now.getTime() + current.intervalSeconds * 1000).toISOString() : null;
    this.store.save({ settings: current });
    this.activityLog?.log({ type: 'mission_autopilot_error', detail: { error: safeError.slice(0, 500), incidentId: incident?.id ?? null } });
  }
}
