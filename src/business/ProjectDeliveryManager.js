import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

const STAGES = Object.freeze([
  'proposal_draft', 'awaiting_client_confirmation', 'accepted', 'in_progress',
  'quality_review', 'delivered', 'invoice_draft', 'invoice_sent',
  'payment_pending', 'paid', 'blocked', 'cancelled',
]);
const CLOSED = new Set(['paid', 'cancelled']);
const EDITABLE = new Set(['scope', 'deadline', 'quotedAmount', 'currency', 'clientName', 'clientEmail', 'notes', 'deliverables', 'acceptanceEvidence', 'deliveryEvidence', 'invoiceReference', 'paymentReference']);
const DEFAULT_CURRENCY = 'NGN';

function text(value, field, max = 4000) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(field + ' must be text');
  const out = value.trim();
  if (out.length > max) throw new Error(field + ' must be at most ' + max + ' characters');
  return out;
}
function money(value, field) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(field + ' must be a non-negative amount');
  return Math.round(n * 100) / 100;
}
function date(value, field) {
  if (!value) return null;
  const n = new Date(value);
  if (Number.isNaN(n.getTime())) throw new Error(field + ' must be a valid date');
  return n.toISOString();
}
function normalizePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Project update must be an object');
  const out = {};
  for (const field of EDITABLE) {
    if (!(field in input)) continue;
    const value = input[field];
    if (field === 'quotedAmount') out[field] = money(value, field);
    else if (field === 'deadline') out[field] = date(value, field);
    else if (field === 'deliverables') {
      if (!Array.isArray(value) || value.length > 40) throw new Error('deliverables must be a list of at most 40 items');
      out[field] = value.map((v) => text(v, 'deliverable', 300)).filter(Boolean);
    } else out[field] = text(value, field, field === 'scope' || field === 'notes' ? 8000 : 1000);
  }
  if (out.currency && !/^[A-Z]{3}$/.test(out.currency)) throw new Error('currency must be a 3-letter ISO currency code');
  return out;
}
function proposalFor(project) {
  const amount = project.quotedAmount == null ? 'To be agreed' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: project.currency || DEFAULT_CURRENCY, maximumFractionDigits: 2 }).format(project.quotedAmount);
  const deliverables = (project.deliverables ?? []).length ? project.deliverables.map((x) => '- ' + x).join('\n') : '- Deliverables to be confirmed with the client';
  return [
    'PROJECT PROPOSAL — SOFTLY DIGITALS',
    '',
    'Client: ' + (project.clientName || project.company || 'Client to be confirmed'),
    'Project: ' + project.title,
    'Scope: ' + (project.scope || project.service || 'Scope requires confirmation'),
    'Deliverables:',
    deliverables,
    'Target deadline: ' + (project.deadline || 'To be agreed'),
    'Quoted price: ' + amount,
    '',
    'Payment schedule, revision limits, dependencies, and acceptance criteria must be agreed in writing before work begins.',
    'This is a draft proposal, not a contract or a promise that a client has accepted the offer.',
    '',
    'Prepared by Softly Digitals',
  ].join('\n');
}

export class ProjectDeliveryManager {
  constructor({ dataDir = './data', sqliteStore = null, opportunityStore, missionManager, activityLog, eventBus, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'project-delivery.json', kvKey: 'project-delivery', defaultValue: { projects: [] }, sqliteStore });
    this.opportunityStore = opportunityStore;
    this.missionManager = missionManager;
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.now = now;
  }

  _load() { const d = this.store.load(); return Array.isArray(d.projects) ? d.projects : []; }
  _save(projects) { this.store.save({ projects }); }
  _emit(type, project) {
    this.activityLog?.log({ type, detail: { projectId: project.id, stage: project.stage, opportunityId: project.opportunityId ?? null, missionId: project.missionId ?? null } });
    this.eventBus?.emitEvent('delivery.' + type, { projectId: project.id, stage: project.stage });
  }
  list({ stage, q } = {}) {
    const query = String(q ?? '').trim().toLowerCase();
    return this._load().filter((p) => (!stage || p.stage === stage) && (!query || [p.title,p.company,p.clientName,p.scope,p.notes].some((v) => String(v ?? '').toLowerCase().includes(query))))
      .sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  get(id) { return this._load().find((p) => p.id === id) ?? null; }
  summary() {
    const projects = this._load();
    return { total: projects.length, active: projects.filter((p) => !CLOSED.has(p.stage)).length,
      inProgress: projects.filter((p) => ['accepted','in_progress','quality_review'].includes(p.stage)).length,
      delivered: projects.filter((p) => ['delivered','invoice_draft','invoice_sent','payment_pending'].includes(p.stage)).length,
      paid: projects.filter((p) => p.stage === 'paid').length,
      paymentPending: projects.filter((p) => p.stage === 'payment_pending').length,
      overdue: projects.filter((p) => p.deadline && Date.parse(p.deadline) < this.now().getTime() && !CLOSED.has(p.stage) && p.stage !== 'paid').length };
  }
  createFromOpportunity(opportunityId, input = {}) {
    const opportunity = this.opportunityStore.get(opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');
    if (this._load().some((p) => p.opportunityId === opportunityId && !CLOSED.has(p.stage))) throw new Error('An active delivery project already exists for this opportunity');
    const patch = normalizePatch(input);
    const ts = this.now().toISOString();
    const project = {
      id: crypto.randomUUID(), opportunityId, title: opportunity.title, company: opportunity.company || '',
      service: opportunity.service || '', sourceUrl: opportunity.sourceUrl || '', clientName: opportunity.contactName || '',
      clientEmail: opportunity.contactEmail || '', scope: opportunity.fitRationale || opportunity.service || '',
      deadline: patch.deadline ?? null, quotedAmount: patch.quotedAmount ?? null, currency: patch.currency || DEFAULT_CURRENCY,
      deliverables: patch.deliverables ?? [], notes: patch.notes || '',
      stage: 'proposal_draft', proposalText: '', missionId: null, acceptanceEvidence: '', deliveryEvidence: '',
      invoiceReference: '', paymentReference: '', createdAt: ts, updatedAt: ts, history: [],
    };
    project.proposalText = proposalFor(project);
    project.history.push({ at: ts, stage: project.stage, note: 'Created a draft from a researched opportunity. No client contact or contract acceptance has occurred.' });
    const all = this._load(); all.push(project); this._save(all); this._emit('project_created', project);
    return project;
  }
  update(id, input) {
    const current = this.get(id); if (!current) return null;
    if (CLOSED.has(current.stage)) throw new Error('Closed project cannot be edited');
    const patch = normalizePatch(input);
    const next = { ...current, ...patch, updatedAt: this.now().toISOString() };
    if ('scope' in patch || 'deadline' in patch || 'quotedAmount' in patch || 'currency' in patch || 'deliverables' in patch || 'clientName' in patch) next.proposalText = proposalFor(next);
    this._replace(next, 'Project details updated.');
    return next;
  }
  _replace(next, note) {
    const all = this._load(); const i = all.findIndex((p) => p.id === next.id);
    if (i < 0) throw new Error('Project not found');
    next.history = [...(next.history ?? []), { at: this.now().toISOString(), stage: next.stage, note: String(note).slice(0, 1000) }].slice(-100);
    all[i] = next; this._save(all); this._emit('project_updated', next);
  }
  transition(id, action, input = {}) {
    const p = this.get(id); if (!p) return null;
    if (CLOSED.has(p.stage)) throw new Error('Project is closed');
    const ts = this.now().toISOString();
    let next = { ...p, updatedAt: ts };
    const note = text(input.note ?? '', 'note', 2000);
    if (action === 'submit_proposal') {
      if (p.stage !== 'proposal_draft') throw new Error('Only a proposal draft can be submitted');
      if (p.quotedAmount == null || !p.scope || !p.deadline) throw new Error('Set the scope, quoted amount, and deadline before submitting the proposal');
      next.stage = 'awaiting_client_confirmation';
      this.opportunityStore.update(p.opportunityId, { stage: 'approval_required', nextAction: 'Review and send the proposal through an approved channel; record the client response here.' });
    } else if (action === 'confirm_client_acceptance') {
      if (p.stage !== 'awaiting_client_confirmation') throw new Error('Project is not awaiting client confirmation');
      const evidence = text(input.evidence, 'evidence', 2000);
      if (!evidence) throw new Error('Record how the client accepted (for example, message reference or written confirmation)');
      next.acceptanceEvidence = evidence;
      next.stage = 'accepted';
      const mission = this.missionManager.create('Deliver client project: ' + p.title + '. Scope: ' + p.scope + '. Deliverables: ' + (p.deliverables.join('; ') || 'as agreed with client') + '. Deadline: ' + p.deadline + '. Build, test, and prepare delivery artifacts; do not claim deployment or payment unless verified.', { deadline: p.deadline, priority: 5, budget: { maxRuns: 5, maxFailures: 3 } });
      next.missionId = mission.id;
      this.opportunityStore.update(p.opportunityId, { stage: 'won', nextAction: 'Delivery project accepted; track the linked mission and payment status.' });
    } else if (action === 'start_work') {
      if (p.stage !== 'accepted') throw new Error('Client acceptance must be recorded before starting work');
      next.stage = 'in_progress';
    } else if (action === 'request_quality_review') {
      if (p.stage !== 'in_progress') throw new Error('Project must be in progress before quality review');
      next.stage = 'quality_review';
    } else if (action === 'approve_delivery') {
      if (p.stage !== 'quality_review') throw new Error('Quality review must be completed before marking delivery');
      const evidence = text(input.evidence, 'evidence', 3000);
      if (!evidence) throw new Error('Delivery evidence is required (for example, deployed URL, artifact link, or client handoff reference)');
      next.deliveryEvidence = evidence;
      next.stage = 'delivered';
    } else if (action === 'create_invoice') {
      if (p.stage !== 'delivered') throw new Error('Only a delivered project can be invoiced');
      if (p.quotedAmount == null) throw new Error('Quoted amount is required before invoicing');
      next.stage = 'invoice_draft';
    } else if (action === 'mark_invoice_sent') {
      if (p.stage !== 'invoice_draft') throw new Error('Create an invoice draft first');
      if (!text(input.invoiceReference, 'invoiceReference', 1000)) throw new Error('Invoice reference or sending evidence is required');
      next.invoiceReference = input.invoiceReference.trim();
      next.stage = 'payment_pending';
    } else if (action === 'confirm_payment') {
      if (!['payment_pending','invoice_sent'].includes(p.stage)) throw new Error('An invoice must be recorded before payment can be confirmed');
      const reference = text(input.paymentReference, 'paymentReference', 1000);
      if (!reference) throw new Error('Payment reference/receipt evidence is required; XOFT cannot infer that money arrived');
      next.paymentReference = reference;
      next.stage = 'paid';
    } else if (action === 'block') {
      if (!note) throw new Error('Explain what is blocking delivery');
      next.stage = 'blocked';
    } else if (action === 'unblock') {
      if (p.stage !== 'blocked') throw new Error('Project is not blocked');
      next.stage = p.missionId ? 'in_progress' : 'accepted';
    } else if (action === 'cancel') {
      next.stage = 'cancelled';
    } else {
      throw new Error('Unsupported project action');
    }
    this._replace(next, note || ('Action: ' + action));
    return next;
  }
}
