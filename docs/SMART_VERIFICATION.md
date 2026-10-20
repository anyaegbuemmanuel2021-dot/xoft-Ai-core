# XOFT Smart Verification Handler

XOFT's Lightpanda research layer uses `SmartVerificationHandler` to recognize common verification and access-block pages before it extracts page content.

## Current behavior

- Detects common CAPTCHA/reCAPTCHA/hCaptcha wording, Cloudflare-style interstitials, access-denied/rate-limit pages, and sign-in requirements.
- Waits up to `VERIFICATION_WAIT_MS` (default 10000 ms) for a Cloudflare-style browser check to clear by itself.
- Stops with a structured `XOFT_VERIFICATION_REQUIRED` error if a CAPTCHA, sign-in requirement, persistent security interstitial, or access block remains.
- Checks the basic HTTP fallback response too, so challenge HTML is not silently returned as if it were article content.
- Does not solve CAPTCHAs, bypass access controls, or repeatedly hammer a blocked website.

## Configuration

```env
VERIFICATION_WAIT_MS=10000
```

Set it to `0` to disable waiting on Cloudflare-style interstitials. The detector still identifies the challenge and reports it.

## Limits

Challenge detection uses page title, URL, and visible/raw page text, so it is best-effort and cannot identify every provider-specific challenge. This handler currently operates in the research/browser retrieval layer. A full interactive human-in-the-loop flow (showing a remote browser session, notifying a user in the UI, and resuming a paused mission) requires a browser-session UI and task-engine integration; this commit surfaces a stable error code so callers can handle that flow without guessing from error text.
