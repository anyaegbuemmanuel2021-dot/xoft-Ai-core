import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpportunityStore, OPPORTUNITY_STAGES } from '../src/business/OpportunityStore.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-opportunities-'));
  const store = new OpportunityStore({ dataDir });
  return { store, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('creates and persists an opportunity with normalized defaults', () => {
  const f = fixture();
  try {
    const created = f.store.create({ title: 'Build a website', company: 'Example Ltd', sourceUrl: 'https://example.com/jobs/1', estimatedValue: '150000' });
    assert.equal(created.stage, 'researched');
    assert.equal(created.estimatedValue, 150000);
    assert.equal(f.store.get(created.id).title, 'Build a website');
    assert.equal(f.store.summary().active, 1);
  } finally { f.cleanup(); }
});

test('rejects invalid input and unsafe source URLs', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.create({ company: 'No title' }), /title is required/);
    assert.throws(() => f.store.create({ title: 'Unsafe', sourceUrl: 'javascript:alert(1)' }), /HTTP or HTTPS/);
    assert.throws(() => f.store.create({ title: 'Negative', estimatedValue: -1 }), /non-negative/);
    assert.throws(() => f.store.create({ title: 'Bad stage', stage: 'imaginary' }), /stage must be one of/);
  } finally { f.cleanup(); }
});

test('deduplicates by source URL and by company/title', () => {
  const f = fixture();
  try {
    f.store.create({ title: 'Website project', company: 'Example Ltd', sourceUrl: 'https://example.com/project' });
    assert.throws(() => f.store.create({ title: 'Other title', sourceUrl: 'https://example.com/project' }), (err) => err.code === 'OPPORTUNITY_DUPLICATE');
    assert.throws(() => f.store.create({ title: 'Website project', company: 'example ltd' }), (err) => err.code === 'OPPORTUNITY_DUPLICATE');
  } finally { f.cleanup(); }
});

test('rejects empty titles and duplicate updates', () => {
  const f = fixture();
  try {
    const first = f.store.create({ title: 'Website project', company: 'Example Ltd', sourceUrl: 'https://example.com/one' });
    f.store.create({ title: 'Brand identity', company: 'Another Ltd', sourceUrl: 'https://example.com/two' });
    assert.throws(() => f.store.update(first.id, { title: '   ' }), /title cannot be empty/);
    assert.throws(() => f.store.update(first.id, { sourceUrl: 'https://example.com/two' }), (err) => err.code === 'OPPORTUNITY_DUPLICATE');
  } finally { f.cleanup(); }
});

test('updates stage history, filters list and reports follow-ups due', () => {
  const f = fixture();
  try {
    const item = f.store.create({ title: 'Website project', company: 'Example Ltd', nextFollowUpAt: '2020-01-01T00:00:00Z' });
    const updated = f.store.update(item.id, { stage: 'contacted', notes: 'Sent a draft' });
    assert.equal(updated.stage, 'contacted');
    assert.equal(updated.history.length, 2);
    assert.equal(f.store.list({ stage: 'contacted', q: 'example' }).length, 1);
    assert.equal(f.store.summary().followUpsDue, 1);
    assert.equal(f.store.update('missing', { stage: 'won' }), null);
    assert.deepEqual(OPPORTUNITY_STAGES.includes(updated.stage), true);
  } finally { f.cleanup(); }
});
