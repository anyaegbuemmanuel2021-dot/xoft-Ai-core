import { JsonStore } from '../persistence/JsonStore.js';

const DEFAULTS = Object.freeze({
  enabled: true,
  timezone: 'Africa/Lagos',
  morningTime: '08:00',
  eveningTime: '20:00',
  channel: 'sms',
  phoneNumber: '',
  lastDelivered: {},
  lastAttempt: null,
});

function validTime(value, field) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${field} must use HH:MM (24-hour time)`);
  return value;
}

function validTimezone(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('timezone must be a valid IANA timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); } catch { throw new Error('timezone must be a valid IANA timezone'); }
  return value;
}

function normalizeConfig(input, current = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Briefing settings must be an object');
  const next = { ...current };
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled must be true or false');
    next.enabled = input.enabled;
  }
  if ('timezone' in input) next.timezone = validTimezone(input.timezone);
  if ('morningTime' in input) next.morningTime = validTime(input.morningTime, 'morningTime');
  if ('eveningTime' in input) next.eveningTime = validTime(input.eveningTime, 'eveningTime');
  if ('channel' in input) {
    if (!['sms', 'call', 'either', 'dashboard'].includes(input.channel)) throw new Error('channel must be sms, call, either, or dashboard');
    next.channel = input.channel;
  }
  if ('phoneNumber' in input) {
    if (typeof input.phoneNumber !== 'string' || input.phoneNumber.length > 30) throw new Error('phoneNumber must be text under 30 characters');
    next.phoneNumber = input.phoneNumber.trim();
  }
  return next;
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export class BriefingScheduler {
  constructor({ dataDir = './data', sqliteStore = null, twilioService, summaryProvider, activityLog, eventBus, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'briefing-settings.json', kvKey: 'briefing-settings', defaultValue: { settings: DEFAULTS }, sqliteStore });
    this.twilioService = twilioService;
    this.summaryProvider = summaryProvider;
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.now = now;
    this.timer = null;
    this.inFlight = false;
  }

  getSettings() {
    const data = this.store.load();
    const saved = data.settings ?? {};
    return { ...DEFAULTS, ...saved, lastDelivered: saved.lastDelivered ?? {} };
  }

  updateSettings(patch) {
    const current = this.getSettings();
    const next = normalizeConfig(patch, current);
    this.store.save({ settings: next });
    this.activityLog?.log({ type: 'briefing_settings_updated', detail: { enabled: next.enabled, timezone: next.timezone, morningTime: next.morningTime, eveningTime: next.eveningTime, channel: next.channel, phoneConfigured: Boolean(next.phoneNumber) } });
    return this.getSettings();
  }

  status() {
    const settings = this.getSettings();
    return {
      settings: { ...settings, phoneNumber: settings.phoneNumber ? `${settings.phoneNumber.slice(0, 3)}••••${settings.phoneNumber.slice(-2)}` : '' },
      schedulerRunning: Boolean(this.timer),
      next: this.nextOccurrences(settings),
      lastAttempt: settings.lastAttempt,
    };
  }

  nextOccurrences(settings = this.getSettings()) {
    const now = this.now();
    const p = localParts(now, settings.timezone);
    const current = Number(p.hour) * 60 + Number(p.minute);
    return [
      { type: 'morning', time: settings.morningTime, date: p.year + '-' + p.month + '-' + p.day, dueToday: Number(settings.morningTime.slice(0, 2)) * 60 + Number(settings.morningTime.slice(3)) > current },
      { type: 'evening', time: settings.eveningTime, date: p.year + '-' + p.month + '-' + p.day, dueToday: Number(settings.eveningTime.slice(0, 2)) * 60 + Number(settings.eveningTime.slice(3)) > current },
    ];
  }

  start() {
    if (this.timer) return;
    // Persisted per-day slot keys prevent duplicate sends across timer ticks/restarts.
    this.timer = setInterval(() => this.tick().catch((err) => this._logFailure('scheduler', err)), 30_000);
    this.timer.unref?.();
    this.tick().catch((err) => this._logFailure('startup', err));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.inFlight) return;
    const settings = this.getSettings();
    if (!settings.enabled) return;
    const now = this.now();
    const p = localParts(now, settings.timezone);
    const date = `${p.year}-${p.month}-${p.day}`;
    const minute = Number(p.hour) * 60 + Number(p.minute);
    for (const [type, time] of [['morning', settings.morningTime], ['evening', settings.eveningTime]]) {
      const target = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      const key = `${date}:${type}`;
      if (minute < target || minute > target + 4 || settings.lastDelivered[key]) continue;
      this.inFlight = true;
      try {
        await this.deliver(type, date, settings);
      } finally {
        this.inFlight = false;
      }
      break;
    }
  }

  async deliver(type, date, settings = this.getSettings()) {
    const report = await this.summaryProvider({ type, date, timezone: settings.timezone });
    const message = String(report?.text ?? report ?? '').trim().slice(0, 3500);
    if (!message) throw new Error('Briefing summary is empty');
    const result = { type, date, channel: settings.channel, status: 'dashboard_only', at: this.now().toISOString() };
    try {
      if (settings.channel === 'dashboard') {
        result.status = 'saved_to_activity';
      } else {
        if (!settings.phoneNumber) throw new Error('Set your phone number in Runtime Settings to receive scheduled briefings');
        if (settings.channel === 'sms' || settings.channel === 'either') {
          try {
            const sent = await this.twilioService.sendSms({ to: settings.phoneNumber, message });
            result.channel = 'sms'; result.status = 'provider_accepted'; result.providerId = sent.messageSid;
          } catch (smsError) {
            if (settings.channel !== 'either') throw smsError;
            const call = await this.twilioService.createAnnouncementCall({ to: settings.phoneNumber, message });
            result.channel = 'call'; result.status = 'provider_accepted'; result.providerId = call.callSid;
          }
        } else {
          const call = await this.twilioService.createAnnouncementCall({ to: settings.phoneNumber, message });
          result.channel = 'call'; result.status = 'provider_accepted'; result.providerId = call.callSid;
        }
      }
      const current = this.getSettings();
      const key = `${date}:${type}`;
      current.lastDelivered = { ...(current.lastDelivered ?? {}), [key]: result.at };
      current.lastAttempt = { ...result, message: undefined };
      this.store.save({ settings: current });
      this.activityLog?.log({ type: 'executive_briefing_delivered', detail: { ...result, messageLength: message.length } });
      this.eventBus?.emitEvent('executive.briefing_delivered', { ...result, message: undefined });
      return { ...result, message };
    } catch (err) {
      result.status = 'failed';
      result.error = err.message;
      const current = this.getSettings();
      current.lastAttempt = result;
      this.store.save({ settings: current });
      this.activityLog?.log({ type: 'executive_briefing_failed', detail: { ...result, messageLength: message.length } });
      this.eventBus?.emitEvent('executive.briefing_failed', result);
      throw err;
    }
  }

  _logFailure(source, err) {
    this.activityLog?.log({ type: 'executive_briefing_scheduler_error', detail: { source, error: err.message } });
  }
}

export { DEFAULTS as DEFAULT_BRIEFING_SETTINGS };
