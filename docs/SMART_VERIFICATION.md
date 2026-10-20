# XOFT Smart Verification Handler

XOFT's Lightpanda research layer uses `SmartVerificationHandler` to recognize common verification and access-block pages before it extracts page content.

## Current behavior

- Detects common CAPTCHA/reCAPTCHA/hCaptcha wording, Cloudflare-style interstitials, access-denied/rate-limit pages, and sign-in requirements.
- Waits up to `VERIFICATION_WAIT_MS` (default 10000 ms) for a Cloudflare-style browser check to clear by itself.
- Stops with a structured `XOFT_VERIFICATION_REQUIRED` error if a CAPTCHA, sign-in requirement, persistent security interstitial, or access block remains.
- When a research tool is running inside a planned task, the task engine persists a `waiting_verification` state instead of consuming the normal retry budget or marking the whole task failed.
- Emits `task.verification_required` for realtime listeners and shows a dashboard toast. The Tasks view displays the challenge category/message, an **Open page** link when the URL is safe, and an **Execute** action to retry after the user has handled the page.
- Checks the basic HTTP fallback response too, so challenge HTML is not silently returned as if it were article content.
- Does not solve CAPTCHAs, bypass access controls, or repeatedly hammer a blocked website.

## Configuration

```env
VERIFICATION_WAIT_MS=10000
```

Set it to `0` to disable waiting on Cloudflare-style interstitials. The detector still identifies the challenge and reports it.

## Limits

Challenge detection uses page title, URL, and visible/raw page text, so it is best-effort and cannot identify every provider-specific challenge. This is a human-assisted retry flow, not remote control of the Lightpanda tab. **The page opened by the dashboard is a separate browser session**, so its cookies/session are not automatically shared with Lightpanda. If a website binds its challenge to the original browser session, XOFT may still be unable to proceed; the correct response is to stop and report that limitation, not evade the site's controls. A truly shared-session handoff would require a supported interactive browser provider and session bridge.
