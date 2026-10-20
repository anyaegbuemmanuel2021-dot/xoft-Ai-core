import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialEngagementManager } from '../src/social/SocialEngagementManager.js';

function fixture(replyResult = { success: true, messageId: 'reply-123', status: 'accepted' }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-social-engagement-'));
  const calls = [];
  const connectorManager = {
    get(id) { if (id !== 'social') throw new Error('unknown connector'); return { id, enabled: true }; },
    async call(id, args) { calls.push({ id, ...args }); return { success: true, result: replyResult }; },
  };
  const manager = new SocialEngagementManager({ dataDir, connectorManager, activityLog: { log() {} }, now: () => new Date('2026-10-20T10:00:00.000Z') });
  return { manager, calls, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('social engagement deduplicates imported comments and persists reply drafts', () => {
  const f = fixture();
  try {
    const first = f.manager.ingest({ channel: 'comment', platform: 'instagram', externalId: 'comment-1', message: 'How much does this cost?', senderName: 'Customer' });
    const second = f.manager.ingest({ channel: 'comment', platform: 'instagram', externalId: 'comment-1', message: 'How much does this cost?', senderName: 'Customer' });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(f.manager.summary().total, 1);
    const drafted = f.manager.saveDraft(first.item.id, 'Thanks for asking! Which service are you interested in?');
    assert.equal(drafted.status, 'drafted');
    assert.equal(f.manager.get(first.item.id).replyDraft, 'Thanks for asking! Which service are you interested in?');
  } finally { f.cleanup(); }
});

test('sending a social reply requires approval evidence and explicit provider acceptance', async () => {
  const f = fixture();
  try {
    const item = f.manager.ingest({ channel: 'dm', platform: 'facebook', externalId: 'dm-1', conversationId: 'thread-1', message: 'Hello, can you help with a website?' }).item;
    await assert.rejects(() => f.manager.sendReply(item.id, { connectorId: 'social', replyTool: 'send_reply', reply: 'Yes', approvedBy: '', approvalNote: 'Reviewed' }), /approvedBy is required/);
    const sent = await f.manager.sendReply(item.id, { connectorId: 'social', replyTool: 'send_reply', reply: 'Thanks for reaching out. What type of website do you need?', approvedBy: 'Owner', approvalNote: 'Reviewed this exact reply' });
    assert.equal(sent.item.status, 'replied');
    assert.equal(sent.item.replyProviderId, 'reply-123');
    assert.equal(f.calls.length, 1);
    await assert.rejects(() => f.manager.sendReply(item.id, { connectorId: 'social', replyTool: 'send_reply', approvedBy: 'Owner', approvalNote: 'Again' }), /already recorded/);
  } finally { f.cleanup(); }
});

test('ambiguous connector response does not mark a social reply as sent', async () => {
  const f = fixture({ output: 'maybe sent' });
  try {
    const item = f.manager.ingest({ channel: 'comment', platform: 'linkedin', externalId: 'comment-2', message: 'Interested' }).item;
    await assert.rejects(() => f.manager.sendReply(item.id, { connectorId: 'social', replyTool: 'reply_comment', reply: 'Thank you', approvedBy: 'Owner', approvalNote: 'Reviewed' }), /explicit reply acceptance/);
    assert.equal(f.manager.get(item.id).status, 'open');
  } finally { f.cleanup(); }
});

test('connector inbox sync imports comment and DM records from supported response shapes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-social-sync-'));
  const connectorManager = {
    get(id) { if (id !== 'social') throw new Error('unknown connector'); return { id, enabled: true }; },
    async call(_id, { tool }) {
      if (tool === 'read_comments') return { success: true, result: { comments: [{ id: 'c-1', text: 'Nice post', authorName: 'A' }] } };
      return { success: true, result: { messages: [{ messageId: 'm-1', body: 'Hello', fromName: 'B', conversationId: 't-1' }] } };
    },
  };
  const manager = new SocialEngagementManager({ dataDir, connectorManager, activityLog: { log() {} } });
  try {
    const result = await manager.fetchFromConnector({ connectorId: 'social', commentsTool: 'read_comments', dmsTool: 'read_dms', platform: 'instagram' });
    assert.equal(result.count, 2);
    assert.equal(manager.summary().comments, 1);
    assert.equal(manager.summary().dms, 1);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
