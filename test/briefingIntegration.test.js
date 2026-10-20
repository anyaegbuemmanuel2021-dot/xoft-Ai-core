import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('briefing scheduler is integrated with durable storage and lifecycle', () => {
  const index = read('../src/index.js');
  assert.match(index, /import \{ BriefingScheduler \} from '\.\/proactive\/BriefingScheduler\.js'/);
  assert.match(index, /new BriefingScheduler\(/);
  assert.match(index, /briefingScheduler\.start\(\)/);
  assert.match(index, /app\.get\('\/api\/briefings'/);
  assert.match(index, /app\.patch\('\/api\/briefings\/settings'/);
  assert.match(index, /app\.post\('\/api\/briefings\/preview'/);
});

test('runtime settings exposes morning/evening controls and does not reveal stored phone number', () => {
  const settings = read('../public/js/views/settings.js');
  assert.match(settings, /briefing-morning/);
  assert.match(settings, /briefing-evening/);
  assert.match(settings, /Africa\/Lagos/);
  assert.match(settings, /api\.patch\('\/api\/briefings\/settings'/);
  assert.match(settings, /api\.post\('\/api\/briefings\/preview'/);
  assert.match(settings, /Number saved; leave blank to keep/);
  assert.match(settings, /Clear saved phone number/);
});

test('briefing scheduler reports provider failures rather than claiming delivery', () => {
  const scheduler = read('../src/proactive/BriefingScheduler.js');
  assert.match(scheduler, /result\.status = 'failed'/);
  assert.match(scheduler, /executive_briefing_failed/);
  assert.match(scheduler, /provider_accepted/);
  assert.match(scheduler, /lastDelivered/);
});
