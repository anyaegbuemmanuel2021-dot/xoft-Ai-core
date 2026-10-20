import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialMediaScheduler } from '../src/social/SocialMediaScheduler.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-social-'));
  let now = new Date('2026-10-20T08:00:00.000Z');
  const calls = [];
  const connectorManager = {
    list: () => [{ id: 'publisher', name: 'Test Publisher', enabled: true, transport: 'http-json' }],
    get: (id) => { if (id !== 'publisher') throw new Error('unknown connector'); return { id, enabled: true }; },
    async call(id, args) { calls.push({ id, ...args }); return { success: true, result: { published: true, postId: 'provider-123' } }; },
  };
  const scheduler = new SocialMediaScheduler({ dataDir, connectorManager, now: () => new Date(now), activityLog: { log() {} } });
  return { scheduler, calls, setNow: (value) => { now = new Date(value); }, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('social calendar persists drafts and only publishes approved scheduled posts', async () => {
  const f = fixture();
  try {
    const draft = f.scheduler.create({ title: 'Launch post', content: 'We help small businesses build better websites.', platforms: ['facebook', 'instagram'], hashtags: ['BusinessGrowth'] });
    assert.equal(draft.status, 'draft');
    await assert.rejects(() => f.scheduler.publish(draft.id), /Only approved scheduled posts/);
    const scheduled = f.scheduler.schedule(draft.id, {
      scheduledAt: '2026-10-20T08:02:00.000Z',
      connectorId: 'publisher',
      publishTool: 'publish_post',
      approvedBy: 'Owner',
      approvalNote: 'Reviewed copy and approved publication',
    });
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(f.scheduler.get(draft.id).approvedBy, 'Owner');
    f.setNow('2026-10-20T08:03:00.000Z');
    await f.scheduler.tick();
    const published = f.scheduler.get(draft.id);
    assert.equal(published.status, 'published');
    assert.equal(published.providerResult.postId, 'provider-123');
    assert.equal(f.calls.length, 1);
    assert.equal(f.scheduler.summary().published, 1);
  } finally { f.cleanup(); }
});

test('social scheduler records connector failure and does not claim publication', async () => {
  const f = fixture();
  try {
    f.scheduler.connectorManager.call = async () => { throw new Error('provider unavailable'); };
    const draft = f.scheduler.create({ content: 'Useful post copy', platforms: ['linkedin'] });
    f.scheduler.schedule(draft.id, {
      scheduledAt: '2026-10-20T08:02:00.000Z',
      connectorId: 'publisher',
      publishTool: 'publish_post',
      approvedBy: 'Owner',
      approvalNote: 'Reviewed',
    });
    f.setNow('2026-10-20T08:03:00.000Z');
    await f.scheduler.tick();
    assert.equal(f.scheduler.get(draft.id).status, 'failed');
    assert.match(f.scheduler.get(draft.id).lastError, /provider unavailable/);
    assert.equal(f.scheduler.summary().published, 0);
  } finally { f.cleanup(); }
});
