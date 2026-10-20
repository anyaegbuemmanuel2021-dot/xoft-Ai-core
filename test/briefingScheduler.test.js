import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BriefingScheduler } from '../src/proactive/BriefingScheduler.js';

function setup({ now = new Date('2026-10-20T07:00:00.000Z'), sendSms = async () => ({ messageSid: 'SM-test' }), createAnnouncementCall = async () => ({ callSid: 'CA-test' }), text = 'Morning briefing' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-briefing-'));
  const events = [];
  const logs = [];
  const scheduler = new BriefingScheduler({
    dataDir,
    now: () => new Date(now),
    twilioService: { sendSms, createAnnouncementCall },
    summaryProvider: async () => ({ text }),
    activityLog: { log: (e) => logs.push(e) },
    eventBus: { emitEvent: (name, data) => events.push({ name, data }) },
  });
  return { scheduler, cleanup: () => { scheduler.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }, events, logs };
}

test('defaults to Africa/Lagos 08:00 and 20:00 local briefing times', () => {
  const f = setup();
  try {
    const settings = f.scheduler.getSettings();
    assert.equal(settings.timezone, 'Africa/Lagos');
    assert.equal(settings.morningTime, '08:00');
    assert.equal(settings.eveningTime, '20:00');
    assert.equal(settings.enabled, true);
  } finally { f.cleanup(); }
});

test('validates briefing settings and refuses invalid times/timezones/channels', () => {
  const f = setup();
  try {
    assert.throws(() => f.scheduler.updateSettings({ morningTime: '25:00' }), /HH:MM/);
    assert.throws(() => f.scheduler.updateSettings({ timezone: 'Mars/Somewhere' }), /IANA timezone/);
    assert.throws(() => f.scheduler.updateSettings({ channel: 'carrier-pigeon' }), /channel must be/);
    assert.equal(f.scheduler.updateSettings({ morningTime: '09:00', eveningTime: '21:00', channel: 'either' }).morningTime, '09:00');
  } finally { f.cleanup(); }
});

test('sends only once per local date and slot and persists accepted status', async () => {
  const f = setup({ now: new Date('2026-10-20T07:00:00.000Z') }); // 08:00 Africa/Lagos
  try {
    f.scheduler.updateSettings({ phoneNumber: '+2348012345678' });
    await f.scheduler.tick();
    await f.scheduler.tick();
    assert.equal(f.scheduler.getSettings().lastDelivered['2026-10-20:morning'] !== undefined, true);
    assert.equal(f.scheduler.getSettings().lastAttempt.status, 'provider_accepted');
    assert.equal(f.logs.filter((e) => e.type === 'executive_briefing_delivered').length, 1);
  } finally { f.cleanup(); }
});

test('either channel falls back to a voice call when SMS fails', async () => {
  let calls = 0;
  const f = setup({ now: new Date('2026-10-20T07:00:00.000Z'), sendSms: async () => { throw new Error('sms unavailable'); }, createAnnouncementCall: async () => { calls++; return { callSid: 'CA-fallback' }; } });
  try {
    f.scheduler.updateSettings({ phoneNumber: '+2348012345678', channel: 'either' });
    await f.scheduler.tick();
    assert.equal(calls, 1);
    assert.equal(f.scheduler.getSettings().lastAttempt.channel, 'call');
  } finally { f.cleanup(); }
});

test('records delivery failure without falsely marking the briefing delivered', async () => {
  const f = setup({ now: new Date('2026-10-20T07:00:00.000Z'), sendSms: async () => { throw new Error('provider unavailable'); } });
  try {
    f.scheduler.updateSettings({ phoneNumber: '+2348012345678' });
    await assert.rejects(f.scheduler.tick(), /provider unavailable/);
    assert.equal(f.scheduler.getSettings().lastDelivered['2026-10-20:morning'], undefined);
    assert.equal(f.scheduler.getSettings().lastAttempt.status, 'failed');
  } finally { f.cleanup(); }
});
