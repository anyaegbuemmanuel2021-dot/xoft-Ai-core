import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDeliveryManager } from '../src/business/ProjectDeliveryManager.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-delivery-'));
  const opportunity = { id: 'opp-1', title: 'Business website', company: 'Example Ltd', service: 'Website development', sourceUrl: 'https://example.com/jobs/1', fitRationale: 'Build a responsive website', stage: 'researched' };
  const opportunityUpdates = [];
  const missions = [];
  const opportunityStore = {
    get: (id) => id === opportunity.id ? { ...opportunity } : null,
    update: (id, patch) => { opportunityUpdates.push({ id, patch }); return { ...opportunity, ...patch }; },
  };
  const missionManager = {
    create: (goal, options) => { const mission = { id: 'mission-' + (missions.length + 1), goal, options }; missions.push(mission); return mission; },
  };
  const manager = new ProjectDeliveryManager({
    dataDir, opportunityStore, missionManager,
    activityLog: { log() {} }, eventBus: { emitEvent() {} },
    now: () => new Date('2026-10-20T12:00:00.000Z'),
  });
  return { manager, opportunityUpdates, missions, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('delivery lifecycle requires explicit proposal scope, client acceptance, delivery, invoice, and payment evidence', () => {
  const f = fixture();
  try {
    const p = f.manager.createFromOpportunity('opp-1', {
      scope: 'Design, build, test, and hand over a responsive website',
      deadline: '2026-11-01T12:00:00.000Z',
      quotedAmount: 250000,
      currency: 'NGN',
      deliverables: ['Responsive website', 'Source code', 'Handover notes'],
    });
    assert.equal(p.stage, 'proposal_draft');
    assert.match(p.proposalText, /DRAFT|PROJECT PROPOSAL/);
    const ready = f.manager.transition(p.id, 'submit_proposal', { note: 'Proposal prepared for sending' });
    assert.equal(ready.stage, 'awaiting_client_confirmation');
    assert.throws(() => f.manager.transition(p.id, 'confirm_client_acceptance'), /acceptance/);
    const accepted = f.manager.transition(p.id, 'confirm_client_acceptance', { evidence: 'Client email message-id: msg-123' });
    assert.equal(accepted.stage, 'accepted');
    assert.equal(accepted.missionId, 'mission-1');
    assert.equal(f.missions.length, 1);
    f.manager.transition(p.id, 'start_work');
    f.manager.transition(p.id, 'request_quality_review');
    const delivered = f.manager.transition(p.id, 'approve_delivery', { evidence: 'Handoff URL: https://example.com/delivery' });
    assert.equal(delivered.stage, 'delivered');
    const invoice = f.manager.transition(p.id, 'create_invoice');
    assert.equal(invoice.stage, 'invoice_draft');
    assert.match(invoice.invoiceText, /Amount due/);
    assert.throws(() => f.manager.transition(p.id, 'mark_invoice_sent'), /reference/);
    f.manager.transition(p.id, 'mark_invoice_sent', { invoiceReference: 'Email sent: msg-invoice-8' });
    assert.throws(() => f.manager.transition(p.id, 'confirm_payment'), /Payment reference/);
    const paid = f.manager.transition(p.id, 'confirm_payment', { paymentReference: 'Bank transfer receipt: TRX-123' });
    assert.equal(paid.stage, 'paid');
    assert.equal(f.manager.summary().paid, 1);
    assert.equal(f.opportunityUpdates.at(-1).patch.stage, 'won');
    assert.throws(() => f.manager.transition(p.id, 'cancel'), /closed/);
  } finally { f.cleanup(); }
});

test('delivery projects persist, reject duplicate active projects, and preserve stage when unblocked', () => {
  const f = fixture();
  try {
    const p = f.manager.createFromOpportunity('opp-1', { scope: 'A website', deadline: '2026-11-01T12:00:00Z', quotedAmount: 50000 });
    assert.equal(f.manager.get(p.id).id, p.id);
    assert.throws(() => f.manager.createFromOpportunity('opp-1'), /already exists/);
    f.manager.transition(p.id, 'block', { note: 'Waiting for assets' });
    assert.equal(f.manager.get(p.id).stage, 'blocked');
    const resumed = f.manager.transition(p.id, 'unblock');
    assert.equal(resumed.stage, 'proposal_draft');
  } finally { f.cleanup(); }
});

test('delivery project validation rejects invalid money, date, and unsupported actions', () => {
  const f = fixture();
  try {
    assert.throws(() => f.manager.createFromOpportunity('opp-1', { quotedAmount: -1 }), /non-negative/);
    assert.throws(() => f.manager.createFromOpportunity('opp-1', { deadline: 'not-a-date' }), /valid date/);
    const p = f.manager.createFromOpportunity('opp-1');
    assert.throws(() => f.manager.transition(p.id, 'pretend_paid'), /Unsupported project action/);
  } finally { f.cleanup(); }
});
