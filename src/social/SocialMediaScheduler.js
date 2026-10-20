import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

const PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'threads', 'other']);

function text(value, field, max) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(field + ' is required');
  const result = value.trim();
  if (result.length > max) throw new Error(field + ' must be ' + max + ' characters or fewer');
  return result;
}
function normalizePlatforms(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('Select at least one platform');
  const platforms = [...new Set(value.map((x) => String(x).toLowerCase()))];
  if (platforms.some((x) => !PLATFORMS.has(x))) throw new Error('Unsupported platform selected');
  return platforms;
}
function normalizeTargetAccounts(value, platforms) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('targetAccounts must be a list');
  return value.slice(0, 20).map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Each target account must be an object');
    const platform = text(String(entry.platform ?? '').toLowerCase(), 'target account platform', 40);
    if (!PLATFORMS.has(platform) || !platforms.includes(platform)) throw new Error('Target account platform must be one of the selected post platforms');
    return {
      platform,
      profileId: text(String(entry.profileId ?? entry.handle ?? entry.name ?? ''), 'target account profileId', 180),
      name: String(entry.name ?? '').trim().slice(0, 180),
      handle: String(entry.handle ?? '').trim().slice(0, 180),
    };
  });
}

/**
 * Persistent social publishing calendar. Publishing is delegated to an explicitly
 * configured XOFT connector; this core never pretends that a post was published
 * if the connector did not confirm success.
 */
export class SocialMediaScheduler {
  constructor({ dataDir = './data', sqliteStore = null, connectorManager, activityLog, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'social-calendar.json', kvKey: 'social-calendar', defaultValue: { posts: [] }, sqliteStore });
    this.connectorManager = connectorManager;
    this.activityLog = activityLog;
    this.now = now;
    this.timer = null;
    this.running = false;
  }

  _data() {
    const data = this.store.load();
    if (!Array.isArray(data.posts)) data.posts = [];
    return data;
  }
  list({ status, platform, limit = 200 } = {}) {
    return this._data().posts
      .filter((p) => !status || p.status === status)
      .filter((p) => !platform || p.platforms.includes(String(platform).toLowerCase()))
      .sort((a, b) => Date.parse(b.scheduledAt ?? b.updatedAt) - Date.parse(a.scheduledAt ?? a.updatedAt))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));
  }
  get(id) { return this._data().posts.find((p) => p.id === id) ?? null; }
  create(input = {}) {
    const content = text(input.content, 'content', 10000);
    const platforms = normalizePlatforms(input.platforms);
    const now = this.now().toISOString();
    const post = {
      id: crypto.randomUUID(), title: String(input.title ?? '').trim().slice(0, 180) || content.slice(0, 80),
      content, platforms, targetAccounts: normalizeTargetAccounts(input.targetAccounts, platforms), mediaUrls: Array.isArray(input.mediaUrls) ? input.mediaUrls.map((x) => text(String(x), 'media URL', 2048)).slice(0, 10) : [],
      hashtags: Array.isArray(input.hashtags) ? [...new Set(input.hashtags.map((x) => String(x).trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 30) : [],
      status: 'draft', scheduledAt: null, approvedBy: null, approvalNote: null,
      connectorId: null, publishTool: null, publishInput: null, attempts: 0,
      providerResult: null, lastError: null, publishedAt: null, createdAt: now, updatedAt: now,
    };
    this._save(post);
    this.activityLog?.log({ type: 'social_post_draft_created', detail: { postId: post.id, platforms } });
    return post;
  }
  _save(post) {
    const data = this._data();
    const index = data.posts.findIndex((p) => p.id === post.id);
    if (index < 0) data.posts.push(post); else data.posts[index] = post;
    this.store.save(data);
  }
  update(id, input = {}) {
    const post = this.get(id);
    if (!post) return null;
    if (post.status !== 'draft' && post.status !== 'failed') throw new Error('Only draft or failed posts can be edited');
    const next = { ...post };
    if ('title' in input) next.title = text(input.title, 'title', 180);
    if ('content' in input) next.content = text(input.content, 'content', 10000);
    if ('platforms' in input) next.platforms = normalizePlatforms(input.platforms);
    if ('targetAccounts' in input) next.targetAccounts = normalizeTargetAccounts(input.targetAccounts, next.platforms);
    else if ('platforms' in input) next.targetAccounts = normalizeTargetAccounts(next.targetAccounts ?? [], next.platforms);
    if ('hashtags' in input) next.hashtags = Array.isArray(input.hashtags) ? [...new Set(input.hashtags.map((x) => String(x).trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 30) : [];
    if ('mediaUrls' in input) {
      if (!Array.isArray(input.mediaUrls)) throw new Error('mediaUrls must be a list');
      next.mediaUrls = input.mediaUrls.map((x) => text(String(x), 'media URL', 2048)).slice(0, 10);
    }
    next.updatedAt = this.now().toISOString();
    this._save(next);
    return next;
  }
  schedule(id, input = {}) {
    const post = this.get(id);
    if (!post) return null;
    if (!['draft', 'failed', 'scheduled'].includes(post.status)) throw new Error('This post cannot be scheduled in its current state');
    const date = new Date(input.scheduledAt);
    if (!input.scheduledAt || Number.isNaN(date.getTime()) || date.getTime() <= this.now().getTime()) throw new Error('scheduledAt must be a future date/time');
    const connectorId = text(input.connectorId, 'connectorId', 100);
    const publishTool = text(input.publishTool, 'publishTool', 120);
    const approvalNote = text(input.approvalNote, 'approvalNote', 1000);
    const approvedBy = text(input.approvedBy, 'approvedBy', 120);
    const connector = this.connectorManager.get(connectorId);
    if (!connector.enabled) throw new Error('Selected publishing connector is disabled');
    const publishInput = input.publishInput && typeof input.publishInput === 'object' && !Array.isArray(input.publishInput) ? input.publishInput : {};
    const next = { ...post, status: 'scheduled', scheduledAt: date.toISOString(), connectorId, publishTool, publishInput, approvedBy, approvalNote, lastError: null, updatedAt: this.now().toISOString() };
    this._save(next);
    this.activityLog?.log({ type: 'social_post_scheduled', detail: { postId: id, platforms: next.platforms, scheduledAt: next.scheduledAt, connectorId, approvedBy } });
    return next;
  }
  cancel(id) {
    const post = this.get(id);
    if (!post) return null;
    if (!['draft', 'scheduled', 'failed'].includes(post.status)) throw new Error('This post cannot be cancelled in its current state');
    const next = { ...post, status: 'cancelled', updatedAt: this.now().toISOString() };
    this._save(next);
    this.activityLog?.log({ type: 'social_post_cancelled', detail: { postId: id } });
    return next;
  }
  async publish(id) {
    const post = this.get(id);
    if (!post) throw new Error('Social post not found');
    if (post.status !== 'scheduled') throw new Error('Only approved scheduled posts can be published');
    if (!post.approvedBy || !post.approvalNote) throw new Error('Post requires a named approval and approval note');
    const connector = this.connectorManager.get(post.connectorId);
    const publishing = { ...post, status: 'publishing', attempts: post.attempts + 1, lastError: null, updatedAt: this.now().toISOString() };
    this._save(publishing);
    try {
      const input = { ...post.publishInput, post: { id: post.id, title: post.title, content: post.content, platforms: post.platforms, targetAccounts: post.targetAccounts ?? [], hashtags: post.hashtags, mediaUrls: post.mediaUrls, scheduledAt: post.scheduledAt } };
      const result = await this.connectorManager.call(post.connectorId, { tool: post.publishTool, input });
      const providerResult = result?.result;
      if (providerResult?.success === false || providerResult?.published === false || providerResult?.error) throw new Error(String(providerResult.error ?? providerResult.message ?? 'Connector did not confirm publishing'));
      const confirmed = { ...publishing, status: 'published', providerResult: providerResult ?? result, publishedAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
      this._save(confirmed);
      this.activityLog?.log({ type: 'social_post_published', detail: { postId: id, platforms: post.platforms, connectorId: post.connectorId, attempts: confirmed.attempts } });
      return confirmed;
    } catch (err) {
      const failed = { ...publishing, status: 'failed', lastError: String(err.message).slice(0, 1000), updatedAt: this.now().toISOString() };
      this._save(failed);
      this.activityLog?.log({ type: 'social_post_publish_failed', detail: { postId: id, connectorId: post.connectorId, error: failed.lastError } });
      throw err;
    }
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = this.list({ status: 'scheduled', limit: 100 }).filter((p) => Date.parse(p.scheduledAt) <= this.now().getTime());
      for (const post of due) {
        try { await this.publish(post.id); } catch { /* persisted failed state and audit entry */ }
      }
    } finally { this.running = false; }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), 15000);
    this.timer.unref?.();
    this.tick().catch(() => {});
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  summary() {
    const posts = this._data().posts;
    return { total: posts.length, drafts: posts.filter((p) => p.status === 'draft').length, scheduled: posts.filter((p) => p.status === 'scheduled').length, published: posts.filter((p) => p.status === 'published').length, failed: posts.filter((p) => p.status === 'failed').length, connectors: this.connectorManager.list().filter((c) => c.enabled).map(({ id, name, transport, description }) => ({ id, name, transport, description })) };
  }
}
