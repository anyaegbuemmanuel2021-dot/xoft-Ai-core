import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('project delivery manager is integrated with durable storage and the existing opportunity/mission services', () => {
  const index = read('../src/index.js');
  assert.match(index, /import \{ ProjectDeliveryManager \} from '\.\/business\/ProjectDeliveryManager\.js'/);
  assert.match(index, /new ProjectDeliveryManager\(/);
  for (const route of [
    "app.get('/api/delivery/summary'",
    "app.get('/api/delivery/projects'",
    "app.get('/api/delivery/projects/:id'",
    "app.post('/api/delivery/projects/from-opportunity'",
    "app.patch('/api/delivery/projects/:id'",
    "app.post('/api/delivery/projects/:id/actions'",
  ]) assert.ok(index.includes(route), `missing route: ${route}`);
  assert.match(index, /Device-scoped credentials cannot change client delivery or payment status/);
});

test('delivery dashboard exposes proposal, acceptance, quality, invoice and evidence-gated payment actions', () => {
  const view = read('../public/js/views/delivery.js');
  for (const term of [
    '/api/delivery/projects',
    'delivery-create',
    'submit_proposal',
    'confirm_client_acceptance',
    'request_quality_review',
    'approve_delivery',
    'create_invoice',
    'mark_invoice_sent',
    'confirm_payment',
    'payment reference',
    'Proposal draft',
  ]) assert.ok(view.toLowerCase().includes(term.toLowerCase()), `missing delivery workflow UI: ${term}`);
});
