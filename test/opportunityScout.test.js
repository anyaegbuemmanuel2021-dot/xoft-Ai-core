import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpportunityScout } from '../src/proactive/OpportunityScout.js';
import { OpportunityStore } from '../src/business/OpportunityStore.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-scout-'));
  const opportunityStore = new OpportunityStore({ dataDir });
  const calls = [];
  const toolRegistry = {
    async execute(name, input) {
      calls.push({ name, input });
      if (name !== 'search_web') throw new Error('Unexpected tool');
      return { results: [
        { title: 'Paid website development project — hiring freelancer', url: 'https://example.com/jobs/website', description: 'Budget confirmed, deadline this week, looking for a website developer.' },
        { title: 'Unpaid tutorial course', url: 'https://linkedin.com/posts/example', description: 'Free training course; no paid project mentioned.' },
      ] };
    },
  };
  const scout = new OpportunityScout({
    dataDir,
    toolRegistry,
    memory: {},
    opportunityStore,
    activityLog: { log() {} },
    eventBus: { emitEvent() {} },
  });
  scout.update({ queries: ['website development paid project'] });
  return { dataDir, scout, opportunityStore, calls, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('scout scores public results and saves transparent review flags', async () => {
  const f = fixture();
  try {
    const result = await f.scout.runOnce();
    assert.equal(result.status, 'completed');
    assert.equal(result.saved, 2);
    assert.equal(f.calls.length, 1);
    const leads = f.opportunityStore.list({ limit: 10 });
    const paid = leads.find((lead) => lead.title.startsWith('Paid website'));
    const unpaid = leads.find((lead) => lead.title.startsWith('Unpaid tutorial'));
    assert.ok(paid.priorityScore > unpaid.priorityScore);
    assert.equal(paid.priority, 'high');
    assert.match(paid.recommendedAction, /verify the buyer/i);
    assert.ok(unpaid.riskFlags.includes('course_or_training'));
    assert.ok(unpaid.riskFlags.includes('social_or_profile_source_needs_manual_review'));
    assert.match(unpaid.notes, /not buyer verification/i);
  } finally { f.cleanup(); }
});

test('scout handles search provider errors without losing the run summary', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-scout-fail-'));
  try {
    const scout = new OpportunityScout({
      dataDir,
      toolRegistry: { async execute() { throw new Error('search unavailable'); } },
      opportunityStore: new OpportunityStore({ dataDir }),
      activityLog: { log() {} },
      eventBus: { emitEvent() {} },
    });
    scout.update({ queries: ['one query'] });
    const result = await scout.runOnce();
    assert.equal(result.status, 'failed');
    assert.equal(result.errors.length, 1);
    assert.ok(result.nextRunAt);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
