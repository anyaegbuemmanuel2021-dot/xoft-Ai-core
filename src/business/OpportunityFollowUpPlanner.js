import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';

const CLOSED_STAGES = new Set(['won', 'lost']);

function makeDraft(opportunity) {
  const contact = opportunity.contactName ? ` ${opportunity.contactName}` : '';
  const company = opportunity.company ? ` for ${opportunity.company}` : '';
  const service = opportunity.service || 'the project we discussed';
  return [
    `Hello${contact},`,
    '',
    `I’m following up regarding ${service}${company ? company : ''}. I’d be happy to clarify the scope, timeline, and deliverables and share a suitable proposal.`,
    '',
    'If this is still relevant, please let me know the requirements, deadline, and budget range so I can recommend the right next step.',
    '',
    'Best regards,',
    'Emmanuel | Softly Digitals',
  ].join('\n');
}

export class OpportunityFollowUpPlanner {
  constructor({ dataDir = './data', sqliteStore = null, opportunityStore, activityLog, now = () => new Date() } = {}) {
    this.store = new JsonStore({ dataDir, fileName: 'opportunity-follow-up-drafts.json', kvKey: 'opportunity-follow-up-drafts', defaultValue: { drafts: [] }, sqliteStore });
    this.opportunityStore = opportunityStore;
    this.activityLog = activityLog;
    this.now = now;
  }

  list({ status } = {}) {
    return this.store.load().drafts
      .filter((draft) => !status || draft.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getDraft(id) {
    return this.store.load().drafts.find((draft) => draft.id === id) ?? null;
  }

  markSent(id, { provider, messageId, recipient, approvedBy, consentEvidence } = {}) {
    const data = this.store.load();
    const draft = data.drafts.find((item) => item.id === id);
    if (!draft) return null;
    if (draft.status !== 'draft') throw new Error('This follow-up draft has already been sent; duplicate sends are not allowed');
    if (!provider || !messageId || !recipient || !approvedBy || !consentEvidence) throw new Error('Provider, message id, recipient, approver, and consent evidence are required');
    Object.assign(draft, {
      status: 'sent', sentAt: this.now().toISOString(),
      delivery: { provider, messageId, recipient, approvedBy: String(approvedBy).slice(0, 120), consentEvidence: String(consentEvidence).slice(0, 1000) },
      note: 'Sent through the configured provider. Delivery/read receipt may arrive separately.',
    });
    this.store.save(data);
    this.activityLog?.log({ type: 'opportunity_follow_up_sent', detail: { draftId: id, opportunityId: draft.opportunityId, provider, messageId, approvedBy: String(approvedBy).slice(0, 120) } });
    return draft;
  }

  generateDueDrafts() {
    const now = this.now();
    const data = this.store.load();
    const existingKeys = new Set(data.drafts.map((draft) => draft.dedupeKey));
    const due = this.opportunityStore.list({ limit: 500 }).filter((item) =>
      item.nextFollowUpAt &&
      Date.parse(item.nextFollowUpAt) <= now.getTime() &&
      !CLOSED_STAGES.has(item.stage)
    );
    const created = [];
    for (const opportunity of due) {
      const dedupeKey = `${opportunity.id}:${opportunity.nextFollowUpAt}`;
      if (existingKeys.has(dedupeKey)) continue;
      const draft = {
        id: crypto.randomUUID(),
        opportunityId: opportunity.id,
        opportunityTitle: opportunity.title,
        company: opportunity.company || '',
        channel: opportunity.contactChannel || 'manual_review',
        dueAt: opportunity.nextFollowUpAt,
        subject: `Follow-up: ${opportunity.title}`,
        message: makeDraft(opportunity),
        status: 'draft',
        createdAt: now.toISOString(),
        dedupeKey,
        note: 'Draft only. Review accuracy, recipient, consent and channel rules before sending.',
      };
      data.drafts.push(draft);
      existingKeys.add(dedupeKey);
      created.push(draft);
    }
    if (created.length) {
      this.store.save(data);
      this.activityLog?.log({ type: 'opportunity_follow_up_drafts_created', detail: { count: created.length, opportunityIds: created.map((draft) => draft.opportunityId) } });
    }
    return { created: created.length, drafts: created, dueCount: due.length, totalDrafts: data.drafts.length };
  }
}
