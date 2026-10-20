import { JsonStore } from '../persistence/JsonStore.js';

export const DEFAULT_SCOUT_QUERIES = Object.freeze([
  'freelance website development jobs remote Nigeria',
  'businesses looking for social media management Nigeria',
  'AI automation chatbot projects freelance remote',
  'graphic design advertising video projects Nigeria',
]);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  intervalHours: 6,
  resultCount: 5,
  queries: [...DEFAULT_SCOUT_QUERIES],
  lastRunAt: null,
  lastRunStatus: 'not_run',
  lastRunSummary: null,
  nextRunAt: null,
});

export class OpportunityScout {
  constructor({ dataDir = './data', sqliteStore = null, toolRegistry, memory, opportunityStore, activityLog, eventBus, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'opportunity-scout.json', kvKey: 'opportunity-scout', defaultValue: { settings: DEFAULT_SETTINGS } , sqliteStore });
    this.toolRegistry = toolRegistry;
    this.memory = memory;
    this.opportunityStore = opportunityStore;
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.now = now;
    this.timer = null;
    this.running = false;
  }

  settings() { return { ...DEFAULT_SETTINGS, ...(this.store.load().settings ?? {}) }; }

  update(patch) {
    const current = this.settings();
    const next = { ...current };
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') throw new Error('enabled must be boolean');
      next.enabled = patch.enabled;
    }
    if ('intervalHours' in patch) {
      const n = Number(patch.intervalHours);
      if (!Number.isInteger(n) || n < 1 || n > 24) throw new Error('intervalHours must be an integer from 1 to 24');
      next.intervalHours = n;
    }
    if ('resultCount' in patch) {
      const n = Number(patch.resultCount);
      if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('resultCount must be an integer from 1 to 10');
      next.resultCount = n;
    }
    if ('queries' in patch) {
      if (!Array.isArray(patch.queries) || patch.queries.length < 1 || patch.queries.length > 12 || patch.queries.some((q) => typeof q !== 'string' || !q.trim() || q.length > 300)) throw new Error('queries must contain 1–12 non-empty search strings of at most 300 characters');
      next.queries = [...new Set(patch.queries.map((q) => q.trim()))];
    }
    this.store.save({ settings: next });
    this.activityLog?.log({ type: 'opportunity_scout_settings_updated', detail: { enabled: next.enabled, intervalHours: next.intervalHours, queryCount: next.queries.length } });
    return this.settings();
  }

  status() {
    const s = this.settings();
    return { ...s, running: this.running, schedulerRunning: Boolean(this.timer), nextRunAt: s.nextRunAt };
  }

  start() {
    if (this.timer) return;
    const s = this.settings();
    if (!s.lastRunAt) {
      // Do not launch a surprise network scan during server startup; first run occurs after a short warm-up.
      const nextRunAt = new Date(this.now().getTime() + 60_000).toISOString();
      this._patch({ nextRunAt });
    }
    this.timer = setInterval(() => this.tick().catch((err) => this._recordFailure(err)), 30_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _patch(patch) {
    this.store.save({ settings: { ...this.settings(), ...patch } });
  }

  async tick() {
    const s = this.settings();
    if (!s.enabled || this.running) return;
    if (s.nextRunAt && this.now().getTime() < Date.parse(s.nextRunAt)) return;
    await this.runOnce();
  }

  async runOnce() {
    if (this.running) return { status: 'already_running' };
    const s = this.settings();
    if (!s.enabled) return { status: 'disabled' };
    this.running = true;
    const started = this.now();
    let searched = 0; let saved = 0; let duplicates = 0; let skipped = 0; const errors = [];
    try {
      for (const query of s.queries) {
        try {
          const response = await this.toolRegistry.execute('search_web', { query, count: s.resultCount }, { memory: this.memory });
          const results = Array.isArray(response?.results) ? response.results : [];
          searched += results.length;
          for (const result of results) {
            if (!result?.title || !result?.url) { skipped++; continue; }
            try {
              this.opportunityStore.create({
                title: String(result.title).slice(0, 180),
                sourceUrl: result.url,
                service: query.slice(0, 180),
                fitRationale: String(result.description ?? 'Automatically discovered public result; inspect and qualify before contact.').slice(0, 4000),
                evidence: result.description ? [String(result.description).slice(0, 1000)] : [],
                stage: 'researched',
                nextAction: 'Review source, verify legitimacy and deadline, estimate delivery effort and price, then qualify the lead.',
              });
              saved++;
            } catch (err) {
              if (err.code === 'OPPORTUNITY_DUPLICATE') duplicates++;
              else skipped++;
            }
          }
        } catch (err) { errors.push({ query, error: String(err.message).slice(0, 250) }); }
      }
      const finished = this.now();
      const summary = { queriesRun: s.queries.length, searched, saved, duplicates, skipped, errors, durationMs: finished.getTime() - started.getTime() };
      const nextRunAt = new Date(finished.getTime() + s.intervalHours * 3_600_000).toISOString();
      this._patch({ lastRunAt: finished.toISOString(), lastRunStatus: errors.length === s.queries.length ? 'failed' : errors.length ? 'partial' : 'completed', lastRunSummary: summary, nextRunAt });
      this.activityLog?.log({ type: 'opportunity_scout_run', detail: summary });
      this.eventBus?.emitEvent('opportunity.scout_completed', summary);
      return { status: this.settings().lastRunStatus, ...summary, nextRunAt };
    } finally {
      this.running = false;
    }
  }

  _recordFailure(err) {
    const now = this.now();
    const nextRunAt = new Date(now.getTime() + this.settings().intervalHours * 3_600_000).toISOString();
    this._patch({ lastRunAt: now.toISOString(), lastRunStatus: 'failed', lastRunSummary: { error: String(err.message).slice(0, 500) }, nextRunAt });
    this.activityLog?.log({ type: 'opportunity_scout_failed', detail: { error: err.message } });
  }
}
