import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVerification, VerificationChallengeError } from './SmartVerificationHandler.js';

test('detects CAPTCHA challenges and requires human intervention', () => {
  const result = classifyVerification({ title: 'Verify you are human', url: 'https://example.test', text: 'Complete the reCAPTCHA' });
  assert.equal(result?.type, 'captcha');
  assert.equal(result?.humanRequired, true);
});

test('detects Cloudflare interstitials as waitable checks', () => {
  const result = classifyVerification({ title: 'Just a moment...', url: 'https://example.test/cdn-cgi/challenge', text: 'Checking your browser' });
  assert.equal(result?.type, 'cloudflare');
  assert.equal(result?.humanRequired, false);
});

test('detects access-denied pages without suggesting evasion', () => {
  const result = classifyVerification({ title: 'Access Denied', text: 'Automated requests are not allowed' });
  assert.equal(result?.type, 'access_denied');
  assert.match(result?.message ?? '', /not attempt to evade/i);
});

test('does not flag ordinary pages', () => {
  assert.equal(classifyVerification({ title: 'Example', url: 'https://example.test', text: 'A normal article about browsers.' }), null);
});

test('verification errors expose a stable code for callers', () => {
  const challenge = classifyVerification({ title: 'Sign in to continue' });
  const error = new VerificationChallengeError(challenge, 'https://example.test');
  assert.equal(error.code, 'XOFT_VERIFICATION_REQUIRED');
  assert.equal(error.challengeType, 'login_required');
  assert.equal(error.humanRequired, true);
});
