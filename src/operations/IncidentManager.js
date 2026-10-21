import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

const MAX_INCIDENTS = 1000;
const MAX_EVENTS_PER_INCIDENT = 20;
const SECRET_FIELD = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|cookie|private[_-]?key|secret|token)/i;
const SECRET_ASSIGNMENT = /((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|authorization|cookie|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi;

export function redactSensitive(value) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED JWT]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .slice(0, 4000);
}

function safeValue(value, depth = 0) {
  if (depth > 5) return '[MAX DEPTH]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
  if (typeof value === 'string') return redactSensitive(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      result[redactSensitive(key).slice(0, 100)] = SECRET_FIELD.test(key) ? '[REDACTED]' : safeValue(item, depth + 1);
    }
    return result;
  }
  return redactSensitive(String(value));
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name: redactSensitive(error.name || 'Error').slice(0, 120),
      message: redactSensitive(error.message || 'Unknown error'),
      stack: error.stack ? redactSensitive(error.stack).slice(0, 12000) : null,
    };
  }
  return { name: 'Error', message: redactSensitive(typeof error === 'string' ? error : JSON.stringify(safeValue(error))), stack: null };
}

/**
 * Durable, redacted incident register. Repeated identical open incidents are
 * grouped by fingerprint; a resolved incident starts a fresh record next time.
 * It records and surfaces failures but never repairs or deploys code itself.
 */
export class IncidentManager {
  constructor({ dataDir = './data', sqliteStore = null, activityLog = null, eventBus = null, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'incidents.json', kvKey: 'incidents', defaultValue: { incidents: [] }, sqliteStore });
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.now = now;
  }

  redact(value) { return redactSensitive(value); }

  _data() {
    const data = this.store.load();
    if (!Array.isArray(data.incidents)) data.incidents = [];
    return data;
  }

  capture(error, { source = 'unknown', severity = 'error', correlationId = null, context = {} } = {}) {
    const normalized = normalizeError(error);
    const safeSource = redactSensitive(source).slice(0, 160) || 'unknown';
    const safeContext = safeValue(context);
    const safeSeverity = ['info', 'warning', 'error', 'critical'].includes(severity) ? severity : 'error';
    const cid = redactSensitive(correlationId || crypto.randomUUID()).slice(0, 160);
    const fingerprint = crypto.createHash('sha256').update([safeSource, normalized.name, normalized.message].join('\n')).digest('hex').slice(0, 32);
    const data = this._data();
    const now = this.now().toISOString();
    let incident = data.incidents.find((item) => item.fingerprint === fingerprint && item.status === 'open');

    if (incident) {
      incident.count = Math.min(Number(incident.count || 1) + 1, 1_000_000);
      incident.lastSeenAt = now;
      incident.updatedAt = now;
      incident.severity = safeSeverity === 'critical' || incident.severity !== 'critical' && safeSeverity === 'error'
        ? safeSeverity
        : incident.severity;
      incident.lastCorrelationId = cid;
      incident.correlationIds = [...new Set([...(incident.correlationIds ?? []), cid])].slice(-10);
      incident.recentEvents = [...(incident.recentEvents ?? []), { at: now, correlationId: cid, context: safeContext }].slice(-MAX_EVENTS_PER_INCIDENT);
    } else {
      incident = {
        id: crypto.randomUUID(), fingerprint, source: safeSource, severity: safeSeverity,
        status: 'open', error: normalized, count: 1, createdAt: now, updatedAt: now,
        firstSeenAt: now, lastSeenAt: now, correlationIds: [cid], lastCorrelationId: cid,
        recentEvents: [{ at: now, correlationId: cid, context: safeContext }],
        resolution: null,
      };
      data.incidents.unshift(incident);
    }

    data.incidents = [incident, ...data.incidents.filter((item) => item.id !== incident.id)].slice(0, MAX_INCIDENTS);
    this.store.save(data);
    const eventType = incident.count === 1 ? 'incident.created' : 'incident.updated';
    const detail = { incidentId: incident.id, fingerprint, source: safeSource, severity: incident.severity, count: incident.count, correlationId: cid };
    try { this.activityLog?.log({ type: eventType.replace('.', '_'), detail }); } catch { /* incident persistence must not depend on activity logging */ }
    try { this.eventBus?.emitEvent(eventType, detail); } catch { /* event delivery is best-effort */ }
    return incident;
  }

  list({ status, severity, limit = 100 } = {}) {
    return this._data().incidents
      .filter((item) => !status || item.status === status)
      .filter((item) => !severity || item.severity === severity)
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  get(id) { return this._data().incidents.find((item) => item.id === id) ?? null; }

  resolve(id, { resolvedBy = 'operator', note = '' } = {}) {
    const data = this._data();
    const incident = data.incidents.find((item) => item.id === id);
    if (!incident) return null;
    const now = this.now().toISOString();
    incident.status = 'resolved';
    incident.updatedAt = now;
    incident.resolution = { at: now, by: redactSensitive(resolvedBy).slice(0, 120), note: redactSensitive(note).slice(0, 1000) };
    this.store.save(data);
    const detail = { incidentId: id, fingerprint: incident.fingerprint, resolvedBy: incident.resolution.by, at: now };
    try { this.activityLog?.log({ type: 'incident_resolved', detail }); } catch { /* best-effort */ }
    try { this.eventBus?.emitEvent('incident.resolved', detail); } catch { /* best-effort */ }
    return incident;
  }

  summary() {
    const incidents = this._data().incidents;
    return {
      total: incidents.length,
      open: incidents.filter((item) => item.status === 'open').length,
      critical: incidents.filter((item) => item.status === 'open' && item.severity === 'critical').length,
      errors: incidents.filter((item) => item.status === 'open' && item.severity === 'error').length,
      warnings: incidents.filter((item) => item.status === 'open' && item.severity === 'warning').length,
    };
  }
}
