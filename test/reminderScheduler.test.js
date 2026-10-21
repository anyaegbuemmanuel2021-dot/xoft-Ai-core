import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReminderScheduler } from '../src/scheduler/ReminderScheduler.js';
import { ActivityLog } from '../src/activity/ActivityLog.js';
import { EventBus } from '../src/events/EventBus.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('ReminderScheduler persists a reminder and emits due when its time arrives', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-reminder-due-'));
  const activityLog = new ActivityLog({ dataDir });
  const eventBus = new EventBus({ activityLog });
  const dueEvents = [];
  eventBus.on('reminder.due', (reminder) => dueEvents.push(reminder));
  const scheduler = new ReminderScheduler({ dataDir, activityLog, eventBus });
  try {
    scheduler.start();
    const reminder = scheduler.create({ title: 'Test reminder', note: 'Check this', dueAt: new Date(Date.now() + 60).toISOString() });
    assert.equal(reminder.status, 'scheduled');
    await wait(120);
    const stored = scheduler.get(reminder.id);
    assert.equal(stored.status, 'due');
    assert.ok(stored.firedAt);
    assert.equal(dueEvents.length, 1);
    assert.equal(dueEvents[0].id, reminder.id);
    assert.equal(scheduler.summary().due, 1);
  } finally {
    scheduler.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ReminderScheduler reloads scheduled reminders and fires overdue reminders after restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-reminder-restart-'));
  const activityLog = new ActivityLog({ dataDir });
  const eventBus = new EventBus({ activityLog });
  const first = new ReminderScheduler({ dataDir, activityLog, eventBus });
  let second;
  try {
    const reminder = first.create({ title: 'Survive restart', dueAt: new Date(Date.now() + 80).toISOString() });
    first.stop();
    await wait(100);
    second = new ReminderScheduler({ dataDir, activityLog, eventBus });
    second.start();
    assert.equal(second.get(reminder.id).status, 'due');
    assert.equal(second.summary().due, 1);
  } finally {
    first.stop();
    second?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('acknowledging a scheduled reminder clears its timer and is idempotent', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-reminder-ack-'));
  const activityLog = new ActivityLog({ dataDir });
  const eventBus = new EventBus({ activityLog });
  const dueEvents = [];
  eventBus.on('reminder.due', (reminder) => dueEvents.push(reminder));
  const scheduler = new ReminderScheduler({ dataDir, activityLog, eventBus });
  try {
    const reminder = scheduler.create({ title: 'Handled early', dueAt: new Date(Date.now() + 80).toISOString() });
    assert.equal(scheduler.acknowledge(reminder.id).status, 'acknowledged');
    assert.equal(scheduler.acknowledge(reminder.id).status, 'acknowledged');
    await wait(120);
    assert.equal(scheduler.get(reminder.id).status, 'acknowledged');
    assert.equal(dueEvents.length, 0);
  } finally {
    scheduler.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ReminderScheduler validates title, due time, and reminder horizon', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-reminder-validation-'));
  const scheduler = new ReminderScheduler({ dataDir });
  try {
    assert.throws(() => scheduler.create({ title: '  ', dueAt: new Date(Date.now() + 1000).toISOString() }), /title/);
    assert.throws(() => scheduler.create({ title: 'Past', dueAt: new Date(Date.now() - 1000).toISOString() }), /future/);
    assert.throws(() => scheduler.create({ title: 'Too far', dueAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString() }), /365 days/);
  } finally {
    scheduler.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
