# XOFT Executive Personal Assistant Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing XOFT AI Core into a proactive personal executive assistant that can manage schedules and communications, research and track commercial opportunities, and contact its owner through approved channels while running continuously on a persistent host.

**Architecture:** Preserve the current Node.js/Express core, ExecutiveBrain, task planner, background job manager, event bus, SQLite/JSON persistence, dashboard and native companion contracts. Implement missing behavior behind existing services and authenticated routes; keep channel-specific adapters separate and expose truthful configured/connected/permission states in the dashboard. Server-side work must continue independently of the browser UI, while phone/SIM operations must be executed by a permissioned native companion or a configured telephony provider.

**Tech Stack:** Node.js 22+, Express, node:test, SQLite/JsonStore, existing dashboard JavaScript/CSS, Android companion, official WhatsApp Business Cloud API, Twilio, Google Calendar/Gmail, GitHub Actions.

## Global Constraints

- Preserve existing working features and repository history; do not replace XOFT with a new project.
- Never claim a provider is live merely because its environment variables exist. Distinguish implemented, configured, reachable, permission-granted, and end-to-end verified.
- Never put credentials in source control, logs, generated reports, or chat. Use host secret variables.
- Respect website access controls and CAPTCHA challenges; use detection and human-assisted retry rather than bypassing them.
- Personal WhatsApp Messenger history is not available through the official WhatsApp Business Cloud API. Build only supported, consent-based integrations; clearly distinguish business inbox access from personal chat access.
- Calls, SMS, notification access, microphone, and screen control require device permissions and a real companion/provider. Never simulate successful delivery.
- Money movement, purchases, contracts, price commitments, sensitive messages, account changes, and destructive operations require explicit approval unless a narrowly scoped policy has been configured and audited.
- Persist scheduled work and recover it after restart. Avoid duplicate delivery and duplicate execution on webhook retries.
- Every dashboard action must map to a real backend endpoint, show honest errors, escape untrusted content, and have focused tests.
- A green CI run is not proof of live provider connectivity or production deployment.

---

## Task 1: Establish verified baseline and capability truth

**Files:**
- Read: `docs/FEATURE_COMPARISON.md`
- Read: `docs/COMMUNICATION_INTEGRATIONS.md`
- Read: `docs/MOBILE_COMPANION_CONTRACT.md`
- Read: `src/index.js`, `src/background/BackgroundJobManager.js`, `src/scheduler/MissionScheduler.js`, `src/executive/ExecutiveBrain.js`
- Modify: `docs/FEATURE_COMPARISON.md` only when a status is supported by code and tests.
- Test: existing `test/` suite and CI workflow.

- [ ] Map each desired capability to its actual code, API route, required external credential, device permission, persistence, UI, and test.
- [ ] Verify current CI on the current default-branch SHA and record failures by job; do not assume historical status applies to the current head.
- [ ] Verify existing communication tools, webhook signatures, approval gates, background scheduling, and task resume semantics.
- [ ] Mark unsupported personal WhatsApp chat mirroring, provider-dependent phone/SMS, and other device-only capabilities explicitly.
- [ ] Run `npm test` and the repository's available type/build checks; fix regressions introduced by this work before marking this task complete.

**Acceptance:** Every capability has a truthful status and a reproducible verification path; no claim of live deployment or provider success without evidence.

## Task 2: Durable executive scheduler and proactive notification delivery

**Observed files:** `src/background/BackgroundJobManager.js`, `src/executive/WorldState.js`, `src/executive/ExecutiveBrain.js`, `src/events/EventBus.js`, `src/index.js`, `public/js/views/automation.js`, `public/js/views/overview.js`.

**Proposed files:** `src/executive/ExecutiveScheduler.js`, `test/executiveScheduler.test.js` (create only if the current scheduler cannot express calendar-aware reminders cleanly).

- [ ] Add failing tests for one-time reminders, recurring reminders, invalid dates, timezone/DST boundaries, restart recovery, pause/resume/cancel, duplicate suppression, and delivery failure.
- [ ] Reuse the existing persistent job store when possible rather than introducing a competing scheduler.
- [ ] Support user-owned reminders and briefings with title, due time, timezone, recurrence, priority, delivery channels, state, and idempotency key.
- [ ] Generate daily/weekly briefings from real calendar events, deadlines, tasks, approvals, and user-configured goals. If a source is disconnected, state that it was unavailable.
- [ ] Deliver notifications through supported registered channels and record queued/sent/failed states. Browser toast alone is not a background notification.
- [ ] Add authenticated APIs and dashboard controls for creating, editing, pausing, completing, and cancelling reminders.
- [ ] Test process restart and prove persisted reminders are re-armed exactly once.

**Acceptance:** A reminder survives a process restart, fires once at its due time, records delivery outcome, and is visible/editable in the dashboard. No duplicate delivery on retries.

## Task 3: Communications hub for WhatsApp, SMS and voice calls

**Observed files:** `src/integrations/WhatsAppService.js`, `src/integrations/WhatsAppInboxStore.js`, `src/integrations/TwilioService.js`, `src/tools/builtins/communicationTools.js`, `src/index.js`, `public/js/views/integrations.js`, `docs/COMMUNICATION_INTEGRATIONS.md`, `docs/MOBILE_COMPANION_CONTRACT.md`.

- [ ] Add integration tests for webhook signature rejection, duplicate webhook delivery, inbound/outbound message persistence, provider failure, and delivery-status reconciliation.
- [ ] Expose a unified communications view with channel, contact, message history, client category, urgency, follow-up state, unread state where the provider supports it, and last interaction.
- [ ] Add contact/lead labels and user-editable classifications; AI classification must be reversible and should preserve the original message.
- [ ] Add SMS sending and delivery-status tracking through the existing supported telephony provider adapter; add phone-call status and failure visibility.
- [ ] Implement permissioned Android companion actions for SIM-based SMS/calling only where the companion contract and platform permissions support them; report offline/unavailable truthfully.
- [ ] Keep WhatsApp Cloud API behavior distinct from personal WhatsApp Messenger. Do not add unsupported QR-session scraping or claim access to personal chat history.
- [ ] Add human approval for first contact, bulk outreach, sensitive messages, and calls to new recipients; support narrowly scoped pre-authorization for routine replies/follow-ups.
- [ ] Add integration health checks and a dashboard that distinguishes missing credentials, invalid credentials, unreachable provider, missing permission, and verified operation.

**Acceptance:** Test fixtures prove messages/calls are sent only through configured adapters; no UI shows success before provider confirmation. Live verification requires the user's own credentials and test recipient.

## Task 4: Client pipeline and opportunity research

**Observed files:** `src/agents/research/SearchService.js`, `src/agents/specialists/`, `src/automation/AutomationFactory.js`, `src/goals/GoalSystem.js`, `src/memory/`, `src/index.js`, dashboard views.

**Proposed files:** `src/business/OpportunityStore.js`, `src/business/OpportunityService.js`, `public/js/views/opportunities.js`, `test/opportunityService.test.js`.

- [ ] Add failing tests for creating/updating a lead, deduplication, source attribution, confidence and evidence retention, stage transitions, reminders, and safe rendering.
- [ ] Store prospects, opportunities, source URLs, evidence snippets, fit rationale, estimated value range, costs, next action, owner approval state, and actual outcome in durable storage.
- [ ] Use the existing research service to find public business information; preserve source URLs and timestamps and label uncertain inferences as such.
- [ ] Score opportunities against configured services, skills, budget, deadlines, and risk. Do not present estimates as confirmed income.
- [ ] Add dashboard pipeline stages: researched, qualified, draft prepared, approval required, contacted, replied, meeting, won, lost, and follow-up due.
- [ ] Prepare proposals and outreach drafts; send only through an enabled, authorized channel and honor opt-outs and provider policies.
- [ ] Add a daily/weekly opportunity report and follow-up scheduling. Track revenue only from a user-confirmed or verified payment record.
- [ ] Do not scrape private accounts, circumvent access controls, mass-spam prospects, or submit applications/commitments without the configured approval policy.

**Acceptance:** An opportunity can be researched with citations, saved, reviewed, drafted, approved, contacted through a test adapter, and tracked through its lifecycle without fabricating clients, meetings, or revenue.

## Task 5: Meetings, calendar and work delivery

**Observed files:** `src/agents/calendar/CalendarService.js`, `src/tools/builtins/calendarTools.js`, `src/agents/email/GmailService.js`, `src/tools/builtins/emailTools.js`, `src/index.js`, `public/js/views/automation.js`.

- [ ] Test timezone handling, availability conflicts, invite failures, event updates, cancellation, and idempotent retries.
- [ ] Provide a unified agenda across calendar events, lectures/exams entered by the user, project milestones, and follow-up tasks.
- [ ] Prepare meeting agendas and briefing packs from permitted emails, messages, documents, and project records.
- [ ] Create/update calendar events and send invitations only after confirming attendee, timezone, duration, and availability.
- [ ] Support meeting joining, transcription, and summary only through a real provider/client integration with required consent; never claim XOFT hosted or attended a meeting without provider/session evidence.
- [ ] Track project deliverables, deadlines, client requirements, invoices, and payment status. Payments themselves remain with the payment provider and require authorization.

**Acceptance:** Calendar actions use real provider responses; conflicts and missing permissions are shown to the user; meeting summaries are tied to an actual recorded/transcribed session.

## Task 6: Always-on deployment, mobile companion and dashboard readiness

**Observed files:** `Dockerfile`, `docker-compose.yml`, `RAILWAY_DEPLOYMENT.md`, `src/index.js`, `public/sw.js`, `android-companion/`, `apps/mobile/`, `.github/workflows/ci.yml`.

- [ ] Verify that the production host runs a persistent process, durable volume, HTTPS, WebSockets, restart policy, and correct health/readiness checks.
- [ ] Verify that background work continues with the dashboard closed and that the Android companion can reconnect safely after network loss.
- [ ] Implement push notifications using a real supported push channel; do not rely on browser timers or an open tab for critical alerts.
- [ ] Audit all dashboard routes and API endpoints, mobile/desktop/Android builds, accessibility, offline behavior, and service-worker cache invalidation.
- [ ] Add end-to-end tests for reminder delivery, lead workflow, approval gating, and communication-provider errors using deterministic fakes.
- [ ] Verify the actual production deployment, persistence across restart, provider connectivity, and a test call/SMS/message only after credentials and test recipients are supplied through secure hosting settings.
- [ ] Record remaining limitations and a feature matrix that separates code-complete, credential-gated, device-permission-gated, and live-verified functionality.

**Acceptance:** CI is green for the supported builds; smoke tests pass on the deployed service; persistence survives a redeploy/restart; live provider tests have explicit evidence. A missing credential or unavailable device is a visible blocked state, not a simulated success.

---

## Product decisions and hard external dependencies

- The personal WhatsApp Messenger account cannot be mirrored by the official WhatsApp Business Cloud API. The supported business-number inbox is separate; any personal-account route must be evaluated against official platform rules, account safety, privacy, and the Android companion's supported permissions.
- SIM-based calls/SMS require a compatible Android device, user-granted permissions, carrier service and a running companion. Cloud telephony requires provider credentials, a supported number and may incur charges.
- Background execution requires an always-on host and persistent storage. A free hosting tier that sleeps or deletes its filesystem cannot guarantee 24/7 execution.
- Real prospect conversion, payment receipt, meeting participation and successful delivery are external outcomes; XOFT must report only evidence-backed results.
