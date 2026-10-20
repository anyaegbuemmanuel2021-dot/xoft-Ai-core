import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('opportunity API routes are mounted and backed by durable store', () => {
  const index = read('../src/index.js');
  assert.match(index, /import \{ OpportunityStore \} from '\.\/business\/OpportunityStore\.js'/);
  assert.match(index, /new OpportunityStore\(\{ dataDir: config\.memory\.dataDir, sqliteStore: durableStore \}\)/);
  for (const route of [
    "app.get('/api/opportunities/summary'",
    "app.get('/api/opportunities'",
    "app.get('/api/opportunities/:id'",
    "app.post('/api/opportunities'",
    "app.patch('/api/opportunities/:id'",
  ]) assert.ok(index.includes(route), `missing route: ${route}`);
  assert.match(index, /app\.post\('\/api\/opportunities\/discover'/);
  assert.match(index, /toolRegistry\.execute\('search_web'/);
  assert.match(index, /not verified clients or guaranteed income/);
  assert.match(index, /OPPORTUNITY_DUPLICATE/);
  assert.match(index, /Device-scoped credentials cannot/);
});

test('dashboard navigation and PWA shell include the opportunities view', () => {
  const app = read('../public/js/app.js');
  const sw = read('../public/sw.js');
  const view = read('../public/js/views/opportunities.js');
  assert.match(app, /import \* as opportunities from '\.\/views\/opportunities\.js'/);
  assert.match(app, /\['opportunities', 'Opportunities', opportunities, 'missions'\]/);
  assert.match(sw, /xoft-shell-v12/);
  assert.match(sw, /\/js\/views\/opportunities\.js/);
  for (const endpoint of ['/api/opportunities', '/api/opportunities/summary']) assert.ok(view.includes(endpoint));
  assert.match(view, /opp-discover/);
  assert.match(view, /\/api\/opportunities\/discover/);
  assert.match(view, /esc\(item\.title\)/);
  assert.match(view, /rel="noopener noreferrer"/);
});

test('opportunity dashboard exposes stage progression and avoids claims of guaranteed revenue', () => {
  const view = read('../public/js/views/opportunities.js');
  for (const stage of ['researched', 'qualified', 'draft_prepared', 'approval_required', 'contacted', 'replied', 'meeting', 'won', 'lost', 'follow_up_due']) {
    assert.ok(view.includes(stage), `missing stage ${stage}`);
  }
  assert.match(view, /Estimated value is not confirmed income/);
});
