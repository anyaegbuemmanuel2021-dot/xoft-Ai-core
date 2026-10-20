import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialHandleManager } from '../src/social/SocialHandleManager.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-social-handles-'));
  const posts = [
    { id: 'queued-a', status: 'scheduled', targetAccounts: [{ profileId: 'handle-a' }] },
    { id: 'queued-other', status: 'scheduled', targetAccounts: [{ profileId: 'handle-b' }] },
  ];
  const cancelled = [];
  const manager = new SocialHandleManager({
    dataDir,
    connectorManager: { get(id) { return id === 'social' ? { id, enabled: true } : null; } },
    socialMediaScheduler: {
      list: ({ status }) => posts.filter((post) => !status || post.status === status),
      cancel(id) { cancelled.push(id); const post = posts.find((item) => item.id === id); if (post) post.status = 'cancelled'; return post; },
      create() { throw new Error('not needed for this test'); },
    },
    router: {},
    activityLog: { log() {} },
    now: () => new Date('2026-10-20T10:00:00.000Z'),
  });
  return { manager, dataDir, cancelled, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('social handles support multiple platform profiles and reject duplicate handles', () => {
  const f = fixture();
  try {
    const a = f.manager.create({ platform: 'instagram', handle: '@softly1810' });
    const b = f.manager.create({ platform: 'facebook', handle: 'Softly Bot' });
    assert.equal(f.manager.list().length, 2);
    assert.equal(a.autoEnabled, false);
    assert.notEqual(a.id, b.id);
    assert.throws(() => f.manager.create({ platform: 'instagram', handle: '@softly1810' }), /already registered/);
  } finally { f.cleanup(); }
});

test('autonomy requires configured tools and an explicit owner confirmation', () => {
  const f = fixture();
  try {
    const handle = f.manager.create({ platform: 'instagram', handle: '@softly1810' });
    assert.throws(() => f.manager.setAutonomy(handle.id, true, { confirmedBy: 'Owner' }), /Set the connector/);
    const configured = f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });
    assert.throws(() => f.manager.setAutonomy(configured.id, true, { confirmedBy: '' }), /owner name/);
    const enabled = f.manager.setAutonomy(configured.id, true, { confirmedBy: 'Owner' });
    assert.equal(enabled.autoEnabled, true);
    assert.equal(enabled.autonomyConfirmedBy, 'Owner');
  } finally { f.cleanup(); }
});

test('per-handle kill switch disables future autonomy and cancels only that handle queued posts', () => {
  const f = fixture();
  try {
    const handle = f.manager.create({ platform: 'instagram', handle: '@softly1810' });
    f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });
    f.manager.setAutonomy(handle.id, true, { confirmedBy: 'Owner' });
    // Simulate the queued post being associated with this handle's generated id.
    const ownPost = { id: 'queued-own', status: 'scheduled', targetAccounts: [{ profileId: handle.id }] };
    const originalList = f.manager.socialMediaScheduler.list;
    f.manager.socialMediaScheduler.list = ({ status }) => [...originalList({ status }), ownPost].filter((post) => !status || post.status === status);
    const result = f.manager.kill(handle.id, 'operator test');
    assert.equal(result.killed, true);
    assert.equal(result.handle.autoEnabled, false);
    assert.equal(result.handle.nextRunAt, null);
    assert.ok(f.cancelled.includes('queued-own'));
    assert.ok(!f.cancelled.includes('queued-other'));
  } finally { f.cleanup(); }
});
