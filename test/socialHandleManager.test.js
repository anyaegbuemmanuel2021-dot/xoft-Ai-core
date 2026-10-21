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
    connectorManager: { get(id) { return id === 'social' ? { id, enabled: true } : null; }, async discover(id) { if (id !== 'social') throw new Error('unknown connector'); return { tools: [{ name: 'read_posts' }, { name: 'publish_post' }] }; } },
    socialMediaScheduler: {
      list: ({ status }) => posts.filter((post) => !status || post.status === status),
      cancel(id) { cancelled.push(id); const post = posts.find((item) => item.id === id); if (post) post.status = 'cancelled'; return post; },
      create() { throw new Error('not needed for this test'); },
    },
    router: {},
    activityLog: { log() {} },
    now: () => new Date('2026-10-20T10:00:00.000Z'),
  });
  return { manager, dataDir, cancelled, posts, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
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
    await assert.rejects(() => f.manager.setAutonomy(handle.id, true, { confirmedBy: 'Owner' }), /Set the connector/);
    const configured = f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });
    await assert.rejects(() => f.manager.setAutonomy(configured.id, true, { confirmedBy: '' }), /owner name/);
    const enabled = await f.manager.setAutonomy(configured.id, true, { confirmedBy: 'Owner' });
    assert.equal(enabled.autoEnabled, true);
    assert.equal(enabled.autonomyConfirmedBy, 'Owner');
  } finally { f.cleanup(); }
});

test('per-handle kill switch disables future autonomy and cancels only that handle queued posts', () => {
  const f = fixture();
  try {
    const handle = f.manager.create({ platform: 'instagram', handle: '@softly1810' });
    f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });
    await f.manager.setAutonomy(handle.id, true, { confirmedBy: 'Owner' });
    // Simulate the queued post being associated with this handle's generated id.
    const ownPost = { id: 'queued-own', status: 'scheduled', targetAccounts: [{ profileId: handle.handle, handleId: handle.id }] };
    f.posts.push(ownPost, { id: 'queued-manual', status: 'scheduled', targetAccounts: [{ platform: 'instagram', profileId: 'instagram:softly1810', handle: '@softly1810' }] });
    const result = f.manager.kill(handle.id, 'operator test');
    assert.equal(result.killed, true);
    assert.equal(result.handle.autoEnabled, false);
    assert.equal(result.handle.nextRunAt, null);
    assert.equal(result.cancelledScheduledPosts, 2);
    assert.equal(ownPost.status, 'cancelled');
    assert.ok(f.cancelled.includes('queued-manual'));
    assert.ok(!f.cancelled.includes('queued-other'));
  } finally { f.cleanup(); }
});

test('tool preflight requires the exact reader and publisher tools to exist on the chosen connector', async () => {
  const f = fixture();
  try {
    const handle = f.manager.create({ platform: 'instagram', handle: '@softly1810' });
    f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });
    assert.deepEqual(await f.manager.validateTools(handle.id), {
      valid: true, connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post', availableTools: 2,
    });
    f.manager.update(handle.id, { publishTool: 'wrong_tool' });
    await assert.rejects(f.manager.validateTools(handle.id), /was not found in the selected connector/);
  } finally { f.cleanup(); }
});

test('a KILL during asynchronous tool discovery cannot be overwritten by a stale autonomy-enable request', async () => {
  const f = fixture();
  try {
    const handle = f.manager.create({ platform: 'instagram', handle: '@race-test' });
    f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });

    let entered;
    let release;
    const discoveryStarted = new Promise((resolve) => { entered = resolve; });
    const discoveryGate = new Promise((resolve) => { release = resolve; });
    f.manager.connectorManager.discover = async () => {
      entered();
      await discoveryGate;
      return { tools: [{ name: 'read_posts' }, { name: 'publish_post' }] };
    };

    const enabling = f.manager.setAutonomy(handle.id, true, { confirmedBy: 'Owner' });
    await discoveryStarted;
    const killed = f.manager.kill(handle.id, 'KILL during tool validation');
    assert.equal(killed.killed, true);
    release();

    await assert.rejects(enabling, /handle changed while tools were being validated/);
    const latest = f.manager.get(handle.id);
    assert.equal(latest.autoEnabled, false);
    assert.equal(latest.nextRunAt, null);
    assert.ok(latest.stoppedAt);
  } finally { f.cleanup(); }
});

test('removing a handle disables it and cancels queued posts before deleting configuration', () => {
  const f = fixture();
  try {
    const handle = f.manager.create({ platform: 'instagram', handle: '@softly1810' });
    f.manager.update(handle.id, { connectorId: 'social', readTool: 'read_posts', publishTool: 'publish_post' });
    f.manager.setAutonomy(handle.id, true, { confirmedBy: 'Owner' });
    f.posts.push({ id: 'queued-to-remove', status: 'scheduled', targetAccounts: [{ platform: 'instagram', profileId: 'instagram:softly1810', handle: '@softly1810' }] });
    const result = f.manager.remove(handle.id);
    assert.equal(result.removed, true);
    assert.equal(result.cancelledScheduledPosts, 1);
    assert.equal(f.manager.get(handle.id), null);
    assert.ok(f.cancelled.includes('queued-to-remove'));
    assert.ok(f.manager.history().some((entry) => entry.type === 'social_handle_removed'));
  } finally { f.cleanup(); }
});
