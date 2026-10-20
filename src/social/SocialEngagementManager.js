import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

const CHANNELS = new Set(['comment', 'dm']);
const STATES = new Set(['open', 'drafted', 'replied', 'ignored']);

function required(value, field, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(field + ' is required');
  const result = value.trim();
  if (result.length > max) throw new Error(field + ' must be ' + max + ' characters or fewer');
  return result;
}

/**
 * Stores inbound social comments and DMs returned by an explicitly configured
 * connector. Replies remain drafts until a named user explicitly authorizes send.
 */
export class SocialEngagementManager {
  constructor({ dataDir = './data', sqliteStore = null, connectorManager, activityLog, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'social-engagement.json', kvKey: 'social-engagement', defaultValue: { items: [] }, sqliteStore });
    this.connectorManager = connectorManager;
    this.activityLog = activityLog;
    this.now = now;
  }
  _data() {
    const data = this.store.load();
    if (!Array.isArray(data.items)) data.items = [];
    return data;
  }
  list({ status, channel, platform, limit = 200 } = {}) {
    return this._data().items
      .filter((item) => !status || item.status === status)
      .filter((item) => !channel || item.channel === channel)
      .filter((item) => !platform || item.platform === platform)
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));
  }
  get(id) { return this._data().items.find((item) => item.id === id) ?? null; }
  _save(item) {
    const data = this._data();
    const index = data.items.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) data.items.push(item); else data.items[index] = item;
    this.store.save(data);
  }
  ingest(input = {}) {
    const channel = String(input.channel ?? '').toLowerCase();
    if (!CHANNELS.has(channel)) throw new Error('channel must be comment or dm');
    const platform = required(String(input.platform ?? ''), 'platform', 40).toLowerCase();
    const externalId = required(String(input.externalId ?? ''), 'externalId', 300);
    const message = required(String(input.message ?? ''), 'message', 10000);
    const existing = this._data().items.find((item) => item.platform === platform && item.channel === channel && item.externalId === externalId);
    const now = this.now().toISOString();
    if (existing) {
      const next = { ...existing, message, senderName: String(input.senderName ?? existing.senderName ?? '').slice(0, 180), postUrl: String(input.postUrl ?? existing.postUrl ?? '').slice(0, 2048), conversationId: String(input.conversationId ?? existing.conversationId ?? '').slice(0, 300), receivedAt: input.receivedAt ? new Date(input.receivedAt).toISOString() : existing.receivedAt, updatedAt: now };
      this._save(next);
      return { item: next, duplicate: true };
    }
    const item = {
      id: crypto.randomUUID(), externalId, channel, platform, message,
      senderName: String(input.senderName ?? '').slice(0, 180),
      postUrl: String(input.postUrl ?? '').slice(0, 2048),
      conversationId: String(input.conversationId ?? '').slice(0, 300),
      receivedAt: input.receivedAt ? new Date(input.receivedAt).toISOString() : now,
      status: 'open', replyDraft: null, replySentAt: null, replyProviderId: null,
      connectorId: null, source: 'connector-sync', createdAt: now, updatedAt: now,
    };
    this._save(item);
    this.activityLog?.log({ type: 'social_engagement_received', detail: { itemId: item.id, channel, platform } });
    return { item, duplicate: false };
  }
  sync({ connectorId, commentsTool, dmsTool, platform, since } = {}) {
    const connector = required(String(connectorId ?? ''), 'connectorId', 100);
    this.connectorManager.get(connector);
    const results = [];
    for (const [channel, tool] of [['comment', commentsTool], ['dm', dmsTool]]) {
      if (!tool) continue;
      results.push({ channel, tool });
    }
    if (!results.length) throw new Error('Provide at least one commentsTool or dmsTool discovered from the connector');
    return { connectorId: connector, platform: required(String(platform ?? ''), 'platform', 40).toLowerCase(), tools: results, since: since ? new Date(since).toISOString() : null };
  }
  async fetchFromConnector(config = {}) {
    const plan = this.sync(config);
    const ingested = [];
    for (const operation of plan.tools) {
      const response = await this.connectorManager.call(plan.connectorId, {
        tool: operation.tool,
        input: { platform: plan.platform, since: plan.since, limit: 100 },
      });
      const root = response?.result;
      const records = Array.isArray(root) ? root : Array.isArray(root?.items) ? root.items : Array.isArray(root?.results) ? root.results : Array.isArray(root?.comments) ? root.comments : Array.isArray(root?.messages) ? root.messages : null;
      if (!records) throw new Error(`Connector tool '${operation.tool}' must return an array or an object with items/results/comments/messages array`);
      for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        const externalId = record.id ?? record.commentId ?? record.messageId;
        const message = record.message ?? record.text ?? record.body ?? record.content;
        if (!externalId || typeof message !== 'string' || !message.trim()) continue;
        const result = this.ingest({
          channel: operation.channel, platform: plan.platform, externalId: String(externalId),
          message, senderName: String(record.senderName ?? record.authorName ?? record.fromName ?? ''),
          postUrl: String(record.postUrl ?? record.url ?? ''), conversationId: String(record.conversationId ?? record.threadId ?? ''),
          receivedAt: record.createdAt ?? record.timestamp,
        });
        ingested.push({ id: result.item.id, channel: operation.channel, duplicate: result.duplicate });
      }
    }
    this.activityLog?.log({ type: 'social_engagement_sync_completed', detail: { connectorId: plan.connectorId, platform: plan.platform, ingested: ingested.length } });
    return { connectorId: plan.connectorId, platform: plan.platform, ingested, count: ingested.length, note: 'Only records returned by the configured connector were imported. Confirm that the connector is authorized for the account and requested inbox scope.' };
  }
  saveDraft(id, reply) {
    const item = this.get(id);
    if (!item) return null;
    if (item.status === 'replied' || item.status === 'ignored') throw new Error('This engagement is already closed');
    const next = { ...item, replyDraft: required(reply, 'reply', 5000), status: 'drafted', updatedAt: this.now().toISOString() };
    this._save(next);
    this.activityLog?.log({ type: 'social_engagement_reply_drafted', detail: { itemId: id, channel: item.channel, platform: item.platform } });
    return next;
  }
  async sendReply(id, { connectorId, replyTool, reply, approvedBy, approvalNote } = {}) {
    const item = this.get(id);
    if (!item) throw new Error('Social engagement not found');
    if (item.status === 'replied') throw new Error('A reply is already recorded for this engagement');
    if (item.status === 'ignored') throw new Error('This engagement was marked ignored');
    const text = required(String(reply ?? item.replyDraft ?? ''), 'reply', 5000);
    const approver = required(String(approvedBy ?? ''), 'approvedBy', 120);
    const note = required(String(approvalNote ?? ''), 'approvalNote', 1000);
    const connector = required(String(connectorId ?? ''), 'connectorId', 100);
    const tool = required(String(replyTool ?? ''), 'replyTool', 120);
    this.connectorManager.get(connector);
    const response = await this.connectorManager.call(connector, {
      tool,
      input: {
        platform: item.platform,
        channel: item.channel,
        externalId: item.externalId,
        conversationId: item.conversationId,
        postUrl: item.postUrl,
        message: text,
        replyTo: { id: item.externalId, conversationId: item.conversationId },
      },
    });
    const provider = response?.result;
    if (provider?.success === false || provider?.sent === false || provider?.error || provider?.messageId === null) {
      throw new Error(String(provider.error ?? provider.message ?? 'Connector did not confirm reply submission'));
    }
    const providerId = provider?.messageId ?? provider?.id ?? provider?.replyId ?? null;
    const next = {
      ...item, replyDraft: text, status: 'replied', replySentAt: this.now().toISOString(),
      replyProviderId: providerId ? String(providerId).slice(0, 300) : null, connectorId: connector,
      approvedBy: approver, approvalNote: note, updatedAt: this.now().toISOString(),
    };
    this._save(next);
    this.activityLog?.log({ type: 'social_engagement_reply_submitted', detail: { itemId: id, channel: item.channel, platform: item.platform, connectorId: connector, providerId: next.replyProviderId, approvedBy: approver } });
    return { item: next, providerResult: { messageId: next.replyProviderId, status: provider?.status ?? 'accepted' }, note: 'The connector accepted the reply request. This is not proof that the reply is publicly visible or that the recipient read it.' };
  }
  ignore(id) {
    const item = this.get(id);
    if (!item) return null;
    if (item.status === 'replied') throw new Error('A replied engagement cannot be marked ignored');
    const next = { ...item, status: 'ignored', updatedAt: this.now().toISOString() };
    this._save(next);
    return next;
  }
  summary() {
    const items = this._data().items;
    return { total: items.length, open: items.filter((item) => item.status === 'open').length, drafted: items.filter((item) => item.status === 'drafted').length, replied: items.filter((item) => item.status === 'replied').length, comments: items.filter((item) => item.channel === 'comment' && !['replied', 'ignored'].includes(item.status)).length, dms: items.filter((item) => item.channel === 'dm' && !['replied', 'ignored'].includes(item.status)).length };
  }
}
