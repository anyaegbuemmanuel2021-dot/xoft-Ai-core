import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpportunityStore } from '../src/business/OpportunityStore.js';
import { OpportunityFollowUpPlanner } from '../src/business/OpportunityFollowUpPlanner.js';

test('creates one review-only draft per due follow-up and is idempotent', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-follow-up-'));
  try {
    const opportunityStore = new OpportunityStore({ dataDir });
    const due = opportunityStore.create({
      title: 'Website project',
      company: 'Example Ltd',
      service: 'website development',
      contactName: 'Ada',
      nextFollowUpAt: '2020-01-01T00:00:00Z',
    });
    opportunityStore.create({ title: 'Won project', stage: 'won', nextFollowUpAt: '2020-01-01T00:00:00Z' });
    const planner = new OpportunityFollowUpPlanner({
      dataDir,
      opportunityStore,
      now: () => new Date('2026-10-20T12:00:00Z'),
    });
    const first = planner.generateDueDrafts();
    const second = planner.generateDueDrafts();
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(planner.list().length, 1);
    assert.equal(planner.list()[0].opportunityId, due.id);
    assert.match(planner.list()[0].message, /Ada/);
    assert.match(planner.list()[0].note, /Draft only/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
