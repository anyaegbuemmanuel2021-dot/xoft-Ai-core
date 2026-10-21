# XOFT Current Implementation Audit and Release Gate

**Audit date:** 2026-10-21  
**Baseline:** main at the commit that includes cancellable chat generation; verify the exact deployed SHA separately.  
**Purpose:** separate code merged and CI-tested from external behavior that still needs live verification. This is not a security certification.

## Executive summary

XOFT now has end-to-end streaming chat, an optional OpenRouter-compatible low-cost provider, pre-action briefing events, a per-handle social autonomy kill switch with prompt-injection boundaries, durable redacted incident records, sandbox-tested repair proposals, and a Stop Generating control.

**Deployment status: NO-GO until the target host is checked against the release gates below.** CI success proves the tested commit passed the repository checks; it does not prove that a deployed host has the correct environment variables, that external accounts are connected, or that phone/social publishing actually works. No deployment was performed as part of this audit.

## Current status

| Area | Status | What is implemented | What is still not proven |
|---|---|---|---|
| Chat streaming | **Implemented; CI-verified** | Native OpenAI-compatible SSE streaming is wired into the normal authenticated chat path. Terminal markers, final-delta metadata, usage, provider fallback, and cancellation have regression coverage. | Live streaming against the user's actual provider credentials and target host; browser/network behavior under real provider outages. |
| Stop generation | **Implemented; CI-verified** | Chat UI can abort a stream, cancels upstream work through the request disconnect path, prevents duplicate sends, and avoids stale responses overwriting a different view. | Real-device usability and behavior on every supported browser/host. |
| Free/low-cost provider | **Implemented; CI-verified** | OpenRouter is available as an optional provider, defaults to the `openrouter/free` alias, and is disabled until explicitly configured. Existing task-aware routing remains the default. | Live key/model test. Free-model availability, quotas, and rate limits can change; it is not unlimited or guaranteed always-on. |
| Pre-action briefings | **Implemented; CI-verified** | Executive preflight briefings and outcomes are recorded and broadcast before/after planned execution; risky steps still use the approval path. | Verify the user's actual dashboard/client shows all events and that delivery survives target-host restarts. |
| Social multi-handle studio | **Implemented in code; live integration unverified** | Multiple handles have per-handle settings, opt-in autonomy, tool validation, queued-post cancellation, and a per-handle KILL. External posts/style examples are wrapped as untrusted data; a concurrent KILL cannot be overwritten by stale tool validation. | Each real social account must be authenticated with a supported connector; real publishing, rate limits, and platform review remain unverified. KILL cannot recall a post already accepted by a platform. |
| Incident register | **Implemented; CI-verified** | Durable incidents include severity, source, correlation IDs, fingerprint deduplication, bounded history, resolution, and redaction of common secret formats. Background-job, watchdog, mission-autopilot, and unhandled HTTP failures feed the register. Admin-only APIs and an Activity dashboard tab are present. | Verify redaction against the actual provider/tool error formats and on the target host's storage backend. |
| Incident triage / repair proposal | **Implemented; CI-verified** | Admin-triggered triage uses stack-derived candidate paths, prompt-injection boundaries, secret checks, and strict path/size allowlists. A proposed change runs through the existing isolated self-development sandbox. | A passing proposal still needs explicit human approval. This does not auto-apply code or prove every diagnosis is correct. |
| Background jobs / restart recovery | **Partially verified** | Scheduled/retry-wait jobs are re-armed on startup. Jobs left in `running` state become `interrupted` rather than being replayed blindly, avoiding duplicate external side effects. | End-to-end restart tests on the real host; explicit idempotency keys and per-job time/cost budgets remain follow-up work. |
| Self-development / deployment | **Safety scaffolding present; live delivery unverified** | Proposals, protected-path checks, sandbox tests, named-human approval, canary monitoring, and rollback scaffolding exist. | Do not claim fully autonomous coding/hosting until isolated workspace, secret scanning, tests, approval, canary, health check, and rollback have all been demonstrated on a test project. |
| WhatsApp | **Partial / account-type limited** | The documented path targets official WhatsApp Business Platform integration. | This is not a personal WhatsApp Messenger QR mirror and does not prove personal chat reading or personal Status publishing. Verify supported business webhooks and outbound messages with credentials. |
| Voice, calls, SMS, wake word | **Code present; live delivery unverified** | Voice, speech, scheduler, and channel components exist. | Requires provider credentials, permissions, a compatible companion for continuous listening, and test-call/SMS delivery confirmation. Never report a call or SMS as delivered without provider confirmation. |
| Memory and saved conversations | **Code present; verify persistence/isolation** | Memory and conversation storage components exist. | Test restart persistence, user/session isolation, deletion, memory poisoning, and secret handling on the deployed storage backend. |
| Security | **Improved; not a certification** | Admin-only incident routes, device-scope rejection for incident controls, prompt-injection guard integration for social/triage inputs, existing approval checks, rate limits, and emergency-stop components. | Prompt-injection defenses are not perfect. Continue SSRF, secret scanning, memory poisoning, permissions, session isolation, and emergency-stop tests before public production. |

## CI evidence

- The current-main candidate for Stop Generating passed **691 backend tests, 0 failures**, plus Android and universal-structure checks before merge.
- The terminal-metadata change passed **691 backend tests, 0 failures**, plus Android and universal-structure checks before merge.
- The incident-triage proposal change passed **690 backend tests, 0 failures**, plus Android and universal-structure checks before merge.
- The social-autonomy safety change passed **the repository CI checks** on its reviewed head.
- After any additional merge, check CI for the exact new `main` SHA before calling that SHA green.

CI is not a live deployment test and does not validate secret configuration or real external account credentials.

## Release gates before deployment

1. **Target-host health:** confirm the actual host URL, `/healthz`, `/readyz`, restart behavior, logs, and whether the host sleeps or scales to zero.
2. **Configuration:** verify auth is fail-closed, the intended provider is enabled, fallback order is correct, and no secret is placed in client-side variables or committed files.
3. **Chat:** test successful streaming, invalid key, quota/rate limit, timeout, malformed response, truncated stream, cancellation, and provider fallback on the target host.
4. **Autonomy:** test each social handle separately with a test account; verify tool permissions, post preview/logging, queued-post KILL, and truthful delivery receipts.
5. **Incidents:** inject a harmless error, confirm the record is redacted and deduplicated, run triage, confirm sandbox pass/fail behavior, and verify no code is applied without named approval.
6. **Restart:** schedule a harmless job, restart the host, confirm scheduled work resumes and interrupted work is surfaced rather than duplicated.
7. **Rollback:** on a test project, demonstrate failed sandbox prevents apply and a critical canary failure restores the known-good version.
8. **External channels:** test WhatsApp Business, voice, SMS, and social connectors only with supported accounts and credentials. Distinguish queued, accepted, delivered, failed, and unknown states.
9. **Authorization:** verify admin routes reject device-scoped credentials and emergency stop prevents queued/running actions where cancellation is possible.
10. **Owner authorization:** do not deploy or change DNS/production settings until the owner explicitly requests it.

## Highest-priority remaining work

- Add explicit per-job cost/usage budgets and stronger idempotency enforcement inside external connectors; tool-job time budgets are now implemented.
- Expand restart/retry/emergency-stop/rollback integration tests.
- Verify social, WhatsApp Business, voice/SMS, and provider integrations against real test credentials.
- Complete the sandboxed coding-agent workflow with reviewable diffs, secret scanning, named approval, canary health checks, and rollback.
- Document the lowest-cost always-on host separately from free hosts that sleep or scale to zero.

**Release principle:** code exists ≠ integration works ≠ deployment verified. Keep the UI and status reports honest about that distinction.
