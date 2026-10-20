import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('mission autopilot is integrated with durable storage and protected API routes', () => {
  const index = read('../src/index.js');
  assert.match(index, /import \{ MissionAutopilot \} from '\.\/scheduler\/MissionAutopilot\.js'/);
  assert.match(index, /new MissionAutopilot\(/);
  assert.match(index, /missionAutopilot\.start\(\)/);
  assert.match(index, /app\.get\('\/api\/autopilot\/status'/);
  assert.match(index, /app\.patch\('\/api\/autopilot\/settings'/);
  assert.match(index, /app\.post\('\/api\/autopilot\/run'/);
  assert.match(index, /Device-scoped credentials cannot change mission autopilot settings/);
});

test('mission dashboard exposes autopilot controls and communicates the existing safety gates', () => {
  const view = read('../public/js/views/missions.js');
  assert.match(view, /Autonomous mission runner/);
  assert.match(view, /mission-autopilot-enabled/);
  assert.match(view, /mission-autopilot-save/);
  assert.match(view, /mission-autopilot-run/);
  assert.match(view, /approval gates/);
  assert.match(view, /emergency stop/);
  assert.match(view, /\/api\/autopilot\/settings/);
  assert.match(view, /\/api\/autopilot\/run/);
});
