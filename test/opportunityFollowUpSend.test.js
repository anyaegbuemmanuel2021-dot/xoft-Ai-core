import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpportunityFollowUpPlanner } from '../src/business/OpportunityFollowUpPlanner.js';

test('follow-up sender requires a draft and records provider result plus explicit approval/consent evidence', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-follow-up-send-'));
  const opportunity = {
    id: 'opp-1', title: 'Website project', company: 'Example Ltd', service: 'Website',
    contactName: 'Alex', nextFollowUpAt: '2026-10-19T12:00:00.000Z', stage: 'qualified',
  };
  const planner = new OpportunityFollowUpPlanner({
    dataDir,
    opportunityStore: { list: () => [opportunity] },
    activityLog: { log() {} },
    now: () => new Date('2026-10-20T12:00:00.000Z'),
  });
  try {
    const generated = planner.generateDueDrafts();
    assert.equal(generated.created, 1);
    const draft = generated.drafts[0];
    assert.equal(planner.getDraft(draft.id).status, 'draft');
    assert.throws(() => planner.markSent(draft.id, { provider: 'whatsapp-cloud-api', messageId: 'wamid.1', recipient: '2348012345678' }), /approver, and consent evidence/);
    const sent = planner.markSent(draft.id, {
      provider: 'whatsapp-cloud-api', messageId: 'wamid.1', recipient: '2348012345678',
      approvedBy: 'Owner', consentEvidence: 'Opt-in recorded in client onboarding form',
    });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.delivery.messageId, 'wamid.1');
    assert.equal(sent.delivery.consentEvidence, 'Opt-in recorded in client onboarding form');
    assert.throws(() => planner.markSent(draft.id, {
      provider: 'whatsapp-cloud-api', messageId: 'wamid.2', recipient: '2348012345678',
      approvedBy: 'Owner', consentEvidence: 'Opt-in recorded',
    }), /already been sent/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('follow-up API only sends WhatsApp with admin authentication, saved recipient, and opt-in evidence', () => {
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /send-whatsapp', requireAdmin/);
  assert.match(index, /recipient’s WhatsApp opt-in/);
  assert.match(index, /contactChannel.*whatsapp/);
  assert.match(index, /whatsappService\.sendText/);
  assert.match(index, /not proof of delivery or read receipt/);
});
