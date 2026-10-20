/**
 * Detects common browser-verification and access-block pages.
 *
 * This handler waits for routine, site-provided browser checks to clear. It
 * never attempts to solve CAPTCHA, impersonate a human, or evade access rules.
 */
const CHALLENGE_PATTERNS = [
  { type: 'captcha', pattern: /captcha|hcaptcha|h-cap|recaptcha|g-recaptcha|verify you are human|prove you are human|human verification/i },
  { type: 'cloudflare', pattern: /just a moment\.\.\.|checking your browser|cf-challenge|cloudflare ray id|attention required! \| cloudflare/i },
  { type: 'access_denied', pattern: /access denied|automated requests? (?:are|is) not allowed|unusual traffic|too many requests|request blocked/i },
  { type: 'login_required', pattern: /sign in to continue|log in to continue|authentication required|please sign in/i },
];

export function classifyVerification({ title = '', url = '', text = '' } = {}) {
  const haystack = [title, url, text].join('\n').slice(0, 30000);
  for (const item of CHALLENGE_PATTERNS) {
    if (item.pattern.test(haystack)) {
      return {
        type: item.type,
        humanRequired: item.type === 'captcha' || item.type === 'login_required',
        message: item.type === 'captcha'
          ? 'A human-verification challenge is required. Complete it in an authorized interactive browser session, then retry.'
          : item.type === 'login_required'
            ? 'This page requires sign-in. Sign in through an authorized session, then retry.'
            : item.type === 'cloudflare'
              ? 'The website is presenting a browser-security check. XOFT will wait briefly for the normal check to clear.'
              : 'The website appears to be blocking automated access. XOFT will not attempt to evade the restriction.',
      };
    }
  }
  return null;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class VerificationChallengeError extends Error {
  constructor(challenge, url) {
    super(`XOFT verification handler: ${challenge.message} (type: ${challenge.type}; URL: ${url})`);
    this.name = 'VerificationChallengeError';
    this.code = 'XOFT_VERIFICATION_REQUIRED';
    this.challengeType = challenge.type;
    this.humanRequired = challenge.humanRequired;
    this.url = url;
  }
}

export class SmartVerificationHandler {
  constructor({ waitMs = 10000, pollMs = 1250 } = {}) {
    this.waitMs = Math.max(0, Number(waitMs) || 0);
    this.pollMs = Math.max(250, Number(pollMs) || 1250);
  }

  async inspect(page) {
    return page.evaluate(() => ({
      title: document.title || '',
      url: location.href || '',
      text: (document.body?.innerText || document.documentElement?.innerText || '').slice(0, 30000),
    }));
  }

  async waitForNormalCheck(page) {
    const first = await this.inspect(page);
    let challenge = classifyVerification(first);
    if (!challenge) return { ok: true, challenge: null };

    // Login/CAPTCHA/access-denied pages are not transient checks we can safely
    // auto-complete. Cloudflare-style interstitials may resolve on their own.
    if (challenge.type !== 'cloudflare' || this.waitMs === 0) {
      throw new VerificationChallengeError(challenge, first.url);
    }

    const deadline = Date.now() + this.waitMs;
    while (Date.now() < deadline) {
      await delay(Math.min(this.pollMs, Math.max(0, deadline - Date.now())));
      const current = await this.inspect(page);
      challenge = classifyVerification(current);
      if (!challenge) return { ok: true, challenge: null };
      if (challenge.type !== 'cloudflare') {
        throw new VerificationChallengeError(challenge, current.url);
      }
    }
    throw new VerificationChallengeError(challenge, first.url);
  }
}
