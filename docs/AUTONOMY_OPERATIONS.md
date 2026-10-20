# XOFT Autonomy Operations Guide

This guide describes how to run and verify XOFT's proactive features without confusing scheduled code with a verified live service.

## Runtime requirement

The core process must stay online for its in-process schedulers to run. A sleeping, stopped, redeploying, or crashed hosting instance cannot perform scans or briefings. Use a hosting plan/process that remains running, and mount persistent storage at the configured data directory (for example `/app/data`). Keep `STORAGE_MODE=sqlite` and `SQLITE_PATH=/app/data/xoft.sqlite` aligned with the deployment volume.

## Opportunity scout

The scout defaults to enabled, checks every six hours, and starts its first run after a short warm-up. It uses XOFT's configured `search_web` tool and stores results in the persistent opportunity store.

Protected API endpoints:
- `GET /api/opportunity-scout` — inspect settings, last run, result counts, errors and next run.
- `PATCH /api/opportunity-scout/settings` — enable/disable, change interval, result count, or queries.
- `POST /api/opportunity-scout/run` — request a run now.

Example request (replace `$XOFT_URL` and `$XOFT_API_KEY` locally; do not commit secrets):

```bash
curl -H "Authorization: Bearer $XOFT_API_KEY" "$XOFT_URL/api/opportunity-scout"
curl -X POST -H "Authorization: Bearer $XOFT_API_KEY" "$XOFT_URL/api/opportunity-scout/run"
```

A search result is only a research lead. Scores are heuristic prioritization, not buyer identity verification, budget confirmation, job availability, or revenue. Before contacting a prospect, inspect the original page and confirm the buyer, current scope, budget, deadline, payment terms, and appropriate contact channel.

## Project delivery

Project lifecycle endpoints:
- `GET /api/delivery/projects`
- `POST /api/delivery/projects/from-opportunity`
- `GET /api/delivery/projects/:id`
- `POST /api/delivery/projects/:id/actions`

Use the dashboard/API to draft a proposal, then record acceptance evidence before creating a client mission. Mission completion should advance a project to quality review, not automatically mark it delivered or paid. Review the deliverables and acceptance criteria, then record delivery evidence. Invoice drafts are not sent invoices; a saved invoice reference is not proof of payment. Only record payment as confirmed when a trustworthy payment reference or reconciliation supports it.

## Executive briefings

Briefing settings default to Africa/Lagos, 08:00 and 20:00. Configure them through Runtime Settings and inspect `GET /api/briefings`. Use preview before relying on a scheduled briefing.

Phone delivery is not ready unless the configured channel adapter exposes the required method and credentials. The current scheduler expects SMS/call delivery methods that may not be implemented in the installed Twilio adapter. A successful scheduler tick alone is not evidence that an SMS or call reached the phone. Inspect `lastAttempt`, activity logs, and the provider's own delivery records.

## WhatsApp follow-up

XOFT can prepare follow-up drafts. The protected send endpoint requires a saved WhatsApp contact, explicit approver identity, consent evidence, and configured WhatsApp Cloud API integration. A provider message ID indicates API acceptance only; it is not a delivery or read receipt. Use official WhatsApp Business Platform policies and approved templates/service-window rules.

Do not use this integration to scrape or mirror a personal WhatsApp account. The official Cloud API does not expose personal Messenger chat history.

## Minimum production checklist

1. Set `NODE_ENV=production`, `REQUIRE_AUTH_IN_PRODUCTION=true`, and a strong `AUTH_API_KEYS` secret in hosting settings.
2. Keep secrets in the host's secret manager; never commit `.env`, tokens, phone numbers, or customer data.
3. Attach persistent storage and verify that data survives a redeploy.
4. Verify `/healthz` and `/readyz` after deployment; then authenticate and call `/api/status`.
5. Confirm a manual scout run returns results or a clear provider error; inspect the persisted opportunity list.
6. Run a test mission in a disposable workspace and inspect its output before assigning real client work.
7. Test notification integrations with a destination you control and verify provider delivery status.
8. Review pending approvals. Do not auto-approve external messages, contract acceptance, spending, production deployment, or financial transfers.
9. Confirm GitHub Actions is green for the exact deployed commit. A syntax-only check is not a substitute for `npm test`, build checks, or live smoke tests.

## Failure interpretation

- `failed` or `partial` scout status: inspect the saved error list and configured search provider.
- No runs while the app is asleep: keep a persistent worker online or use an external scheduler to wake a supported endpoint; protect that endpoint with authentication.
- Data missing after redeploy: check volume mount and `SQLITE_PATH`/data directory.
- Briefing appears in activity but no phone alert arrives: check channel adapter, provider credentials, and delivery status; never treat activity logging as delivery proof.
- CAPTCHA/login/access-denied page: pause for human verification. XOFT must not bypass access controls or anti-bot challenges.

## What XOFT must never claim without evidence

A lead is not a client. A draft is not a sent message. An accepted API request is not confirmed delivery. A completed mission is not customer acceptance. An invoice is not a payment. A provider status or transaction reference must be reconciled before reporting financial success.
