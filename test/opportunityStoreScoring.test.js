import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpportunityStore } from '../src/business/OpportunityStore.js';

test('persists and validates priority metadata on opportunities', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-opportunity-score-'));
  try {
    const store = new OpportunityStore({ dataDir });
    const item = store.create({
      title: 'Paid website project',
      priorityScore: 82,
      priority: 'high',
      riskFlags: ['social_or_profile_source_needs_manual_review'],
      recommendedAction: 'Verify the buyer and scope before contact.',
    });
    const loaded = store.get(item.id);
    assert.equal(loaded.priorityScore, 82);
    assert.equal(loaded.priority, 'high');
    assert.deepEqual(loaded.riskFlags, ['social_or_profile_source_needs_manual_review']);
    assert.throws(() => store.create({ title: 'Bad score', priorityScore: 101 }), /priorityScore must be between 0 and 100/);
    assert.throws(() => store.create({ title: 'Bad priority', priority: 'urgent' }), /priority must be low, medium, or high/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
