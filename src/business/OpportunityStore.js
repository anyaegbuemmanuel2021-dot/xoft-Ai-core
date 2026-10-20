import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

export const OPPORTUNITY_STAGES = Object.freeze([
  'researched',
  'qualified',
  'draft_prepared',
  'approval_required',
  'contacted',
  'replied',
  'meeting',
  'won',
  'lost',
  'follow_up_due',
]);

const EDITABLE_FIELDS = new Set([
  'title', 'company', 'contactName', 'contactEmail', 'contactPhone', 'sourceUrl',
  'service', 'fitRationale', 'evidence', 'estimatedValue', 'costEstimate',
  'nextAction', 'nextFollowUpAt', 'stage', 'notes', 'contactChannel',
]);

function cleanText(value, field, max = 2000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return text;
}

function optionalMoney(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number`);
  return n;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} must be a valid date`);
  return d.toISOString();
}

function normalizeSourceUrl(value) {
  const raw = cleanText(value, 'sourceUrl', 2048);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('sourceUrl must be a valid HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('sourceUrl must use HTTP or HTTPS');
  return url.toString();
}

function normalize(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Opportunity data must be an object');
  const out = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (field === 'stage') {
      if (!OPPORTUNITY_STAGES.includes(value)) throw new Error(`stage must be one of: ${OPPORTUNITY_STAGES.join(', ')}`);
      out.stage = value;
    } else if (field === 'sourceUrl') out.sourceUrl = normalizeSourceUrl(value);
    else if (field === 'estimatedValue' || field === 'costEstimate') out[field] = optionalMoney(value, field);
    else if (field === 'nextFollowUpAt') out.nextFollowUpAt = optionalDate(value, field);
    else if (field === 'evidence') {
      if (!Array.isArray(value)) throw new Error('evidence must be a list of source/evidence strings');
      out.evidence = value.slice(0, 20).map((v) => cleanText(v, 'evidence item', 1000)).filter(Boolean);
    } else {
      const max = field === 'title' || field === 'company' || field === 'service' ? 180 : field === 'notes' || field === 'fitRationale' ? 4000 : 1000;
      out[field] = cleanText(value, field, max);
    }
  }
  if (!partial && !out.title) throw new Error('title is required');
  if (out.stage === undefined && !partial) out.stage = 'researched';
  return out;
}

export class OpportunityStore {
  constructor({ dataDir = './data', sqliteStore = null } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'opportunities.json', kvKey: 'opportunities', defaultValue: { opportunities: [] }, sqliteStore });
  }

  list({ stage, q, limit = 200 } = {}) {
    const data = this.store.load();
    const query = String(q ?? '').trim().toLowerCase();
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    return data.opportunities
      .filter((item) => !stage || item.stage === stage)
      .filter((item) => !query || [item.title, item.company, item.contactName, item.service, item.fitRationale, item.notes].some((v) => String(v ?? '').toLowerCase().includes(query)))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, boundedLimit);
  }

  get(id) {
    return this.store.load().opportunities.find((item) => item.id === id) ?? null;
  }

  create(input) {
    const fields = normalize(input);
    const data = this.store.load();
    const sourceKey = fields.sourceUrl?.toLowerCase();
    const duplicate = data.opportunities.find((item) =>
      (sourceKey && item.sourceUrl?.toLowerCase() === sourceKey) ||
      (fields.company && item.company?.toLowerCase() === fields.company.toLowerCase() && item.title.toLowerCase() === fields.title.toLowerCase())
    );
    if (duplicate) {
      const error = new Error('A matching opportunity already exists');
      error.code = 'OPPORTUNITY_DUPLICATE';
      error.opportunity = duplicate;
      throw error;
    }
    const now = new Date().toISOString();
    const opportunity = {
      id: crypto.randomUUID(),
      ...fields,
      stage: fields.stage ?? 'researched',
      company: fields.company ?? '',
      contactName: fields.contactName ?? '',
      contactEmail: fields.contactEmail ?? '',
      contactPhone: fields.contactPhone ?? '',
      sourceUrl: fields.sourceUrl ?? '',
      service: fields.service ?? '',
      fitRationale: fields.fitRationale ?? '',
      evidence: fields.evidence ?? [],
      estimatedValue: fields.estimatedValue ?? null,
      costEstimate: fields.costEstimate ?? null,
      nextAction: fields.nextAction ?? '',
      nextFollowUpAt: fields.nextFollowUpAt ?? null,
      notes: fields.notes ?? '',
      contactChannel: fields.contactChannel ?? '',
      createdAt: now,
      updatedAt: now,
      history: [{ stage: fields.stage ?? 'researched', at: now, note: 'Opportunity created' }],
    };
    data.opportunities.push(opportunity);
    this.store.save(data);
    return opportunity;
  }

  update(id, patch) {
    const data = this.store.load();
    const item = data.opportunities.find((entry) => entry.id === id);
    if (!item) return null;
    const fields = normalize(patch, { partial: true });
    const beforeStage = item.stage;
    Object.assign(item, fields, { updatedAt: new Date().toISOString() });
    if (fields.stage && fields.stage !== beforeStage) {
      item.history ??= [];
      item.history.push({ stage: fields.stage, at: item.updatedAt, note: fields.stage === 'won' ? 'Marked won by user' : fields.stage === 'lost' ? 'Marked lost by user' : 'Stage updated by user' });
    }
    this.store.save(data);
    return item;
  }

  summary() {
    const opportunities = this.store.load().opportunities;
    const counts = Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, 0]));
    for (const item of opportunities) counts[item.stage] = (counts[item.stage] ?? 0) + 1;
    return {
      total: opportunities.length,
      active: opportunities.filter((item) => !['won', 'lost'].includes(item.stage)).length,
      won: counts.won ?? 0,
      lost: counts.lost ?? 0,
      followUpsDue: opportunities.filter((item) => item.nextFollowUpAt && new Date(item.nextFollowUpAt).getTime() <= Date.now() && !['won', 'lost'].includes(item.stage)).length,
      counts,
    };
  }
}
