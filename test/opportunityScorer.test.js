import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOpportunity } from '../src/business/OpportunityScorer.js';

test('scores clear paid project signals above generic training content', () => {
  const paid = scoreOpportunity({
    title: 'Urgent paid freelance website project',
    description: 'Looking for a developer. Budget and deadline confirmed.',
    query: 'website development jobs',
    url: 'https://example.com/jobs/1',
  });
  const weak = scoreOpportunity({
    title: 'Free website development tutorial course',
    description: 'Learn how to build a website and get a certificate.',
    query: 'website development',
    url: 'https://example.com/course',
  });
  assert.ok(paid.score > weak.score);
  assert.equal(paid.priority, 'high');
  assert.equal(weak.priority, 'low');
  assert.equal(paid.confidence, 'heuristic_not_verified');
});

test('returns bounded scores and flags social/profile sources for manual review', () => {
  const result = scoreOpportunity({
    title: 'Freelance website job',
    description: 'Paid project, looking for a freelancer',
    query: 'website development',
    url: 'https://www.linkedin.com/jobs/view/123',
  });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.signals.some((signal) => signal.name === 'social_or_profile_source_needs_manual_review'));
  assert.match(result.recommendation, /verify|inspect|Review/i);
});
