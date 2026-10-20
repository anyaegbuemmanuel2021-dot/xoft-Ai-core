import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesConfiguredSecret } from '../src/security/ApiKeyAuth.js';

test('matches an exact configured API secret', () => {
  assert.equal(matchesConfiguredSecret('correct-secret', ['correct-secret']), true);
});

test('rejects incorrect, empty, and missing secrets', () => {
  assert.equal(matchesConfiguredSecret('incorrect-secret', ['correct-secret']), false);
  assert.equal(matchesConfiguredSecret('', ['correct-secret']), false);
  assert.equal(matchesConfiguredSecret(undefined, ['correct-secret']), false);
  assert.equal(matchesConfiguredSecret('correct-secret', []), false);
  assert.equal(matchesConfiguredSecret('correct-secret', null), false);
});

test('checks multiple configured secrets without partial matching', () => {
  assert.equal(matchesConfiguredSecret('second-secret', ['first-secret', 'second-secret']), true);
  assert.equal(matchesConfiguredSecret('second', ['second-secret']), false);
});
