import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

const MAX_TIMER_MS = 2_147_000_000;
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

function validTitle(value) {
  if (typeof value !== 'string') throw new Error('Reminder title is required.');
  const title = value.trim();
  if (!title || title.length > 200) throw new Error('Reminder title must be 1–200 characters.');
  return title;
}

function validNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Reminder note must be text under 1000 characters.');
  return value.trim();
}

function validDueAt(value, nowMs) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('dueAt must be a valid date/time.');
  if (ms <= nowMs) throw new Error('dueAt must be in the future.');
  if (ms - nowMs > MAX_HORIZON_MS) throw new Error('Reminders must be scheduled within the next 365 days.');
  return new Date(ms).toISOString();
}

export class ReminderScheduler {
  constructor({ dataDir = './data', sqliteStore = null, activityLog = null, eventBus = null, now = () => new Date() } = {}) {
    this.store = new JsonStore({
      dataDir,
      fileName: 'reminders.json',
      kvKey: 'reminders',
      defaultValue: { reminders: [] },
      sqliteStore,
    });
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.now = now;
    this.timers = new Map();
    this.started = false;
  }

  _load() {
    const value = this.store.load();
    return { reminders: Array.isArray(value?.reminders) ? value.reminders : [] };
  }

  _save(reminders) {
    this.store.save({ reminders });
  }

  _public(reminder) {
    if (!reminder) return null;
    return { ...reminder };
  }

  get(id) {
    return this._public(this._load().reminders.find((reminder) => reminder.id === id) ?? null);
  }

  list() {
    return this._load().reminders
      .slice()
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .map((reminder) => this._public(reminder));
  }

  summary() {
    const reminders = this._load().reminders;
    return {
      total: reminders.length,
      scheduled: reminders.filter((r) => r.status === 'scheduled').length,
      due: reminders.filter((r) => r.status === 'due').length,
      acknowledged: reminders.filter((r) => r.status === 'acknowledged').length,
      cancelled: reminders.filter((r) => r.status === 'cancelled').length,
    };
  }

  create(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Reminder payload must be an object.');
    const now = this.now();
    const reminder = {
      id: crypto.randomUUID(),
      title: validTitle(input.title),
      note: validNote(input.note),
      dueAt: validDueAt(input.dueAt, now.getTime()),
      status: 'scheduled',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      firedAt: null,
      acknowledgedAt: null,
      cancelledAt: null,
    };
    const data = this._load();
    data.reminders.push(reminder);
    this._save(data.reminders);
    this._arm(reminder);
    this.activityLog?.log({ type: 'reminder_created', detail: { reminderId: reminder.id, title: reminder.title, dueAt: reminder.dueAt } });
    this.eventBus?.emitEvent('reminder.created', this._public(reminder));
    return this._public(reminder);
  }

  acknowledge(id) {
    const data = this._load();
    const index = data.reminders.findIndex((reminder) => reminder.id === id);
    if (index < 0) throw new Error('Reminder not found.');
    const current = data.reminders[index];
    if (['acknowledged', 'cancelled'].includes(current.status)) return this._public(current);
    this._clearTimer(id);
    const at = this.now().toISOString();
    const updated = { ...current, status: 'acknowledged', acknowledgedAt: at, updatedAt: at };
    data.reminders[index] = updated;
    this._save(data.reminders);
    this.activityLog?.log({ type: 'reminder_acknowledged', detail: { reminderId: id, title: current.title } });
    this.eventBus?.emitEvent('reminder.acknowledged', this._public(updated));
    return this._public(updated);
  }

  cancel(id) {
    const data = this._load();
    const index = data.reminders.findIndex((reminder) => reminder.id === id);
    if (index < 0) throw new Error('Reminder not found.');
    const current = data.reminders[index];
    if (['acknowledged', 'cancelled'].includes(current.status)) return this._public(current);
    this._clearTimer(id);
    const at = this.now().toISOString();
    const updated = { ...current, status: 'cancelled', cancelledAt: at, updatedAt: at };
    data.reminders[index] = updated;
    this._save(data.reminders);
    this.activityLog?.log({ type: 'reminder_cancelled', detail: { reminderId: id, title: current.title } });
    this.eventBus?.emitEvent('reminder.cancelled', this._public(updated));
    return this._public(updated);
  }

  start() {
    if (this.started) return this.list();
    this.started = true;
    return this.loadAndSchedule();
  }

  loadAndSchedule() {
    const data = this._load();
    const nowMs = this.now().getTime();
    const due = [];
    let changed = false;
    for (let i = 0; i < data.reminders.length; i += 1) {
      const reminder = data.reminders[i];
      if (reminder.status !== 'scheduled') continue;
      if (Date.parse(reminder.dueAt) <= nowMs) {
        const at = this.now().toISOString();
        data.reminders[i] = { ...reminder, status: 'due', firedAt: at, updatedAt: at };
        due.push(data.reminders[i]);
        changed = true;
      } else {
        this._arm(reminder);
      }
    }
    if (changed) this._save(data.reminders);
    for (const reminder of due) {
      this.activityLog?.log({ type: 'reminder_due', detail: { reminderId: reminder.id, title: reminder.title, recoveredAfterRestart: true } });
      this.eventBus?.emitEvent('reminder.due', this._public(reminder));
    }
    return this.list();
  }

  _arm(reminder) {
    this._clearTimer(reminder.id);
    if (reminder.status !== 'scheduled') return;
    const dueMs = Date.parse(reminder.dueAt);
    if (!Number.isFinite(dueMs)) return;
    const delay = Math.max(0, Math.min(dueMs - this.now().getTime(), MAX_TIMER_MS));
    const timer = setTimeout(() => this._onTimer(reminder.id), delay);
    timer.unref?.();
    this.timers.set(reminder.id, timer);
  }

  _onTimer(id) {
    this.timers.delete(id);
    const reminder = this.get(id);
    if (!reminder || reminder.status !== 'scheduled') return;
    if (Date.parse(reminder.dueAt) > this.now().getTime()) {
      this._arm(reminder);
      return;
    }
    const data = this._load();
    const index = data.reminders.findIndex((item) => item.id === id);
    if (index < 0 || data.reminders[index].status !== 'scheduled') return;
    const at = this.now().toISOString();
    const updated = { ...data.reminders[index], status: 'due', firedAt: at, updatedAt: at };
    data.reminders[index] = updated;
    this._save(data.reminders);
    this.activityLog?.log({ type: 'reminder_due', detail: { reminderId: id, title: updated.title } });
    this.eventBus?.emitEvent('reminder.due', this._public(updated));
  }

  _clearTimer(id) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.started = false;
  }
}
