# XOFT Security Threat Model and Verification Plan

Last reviewed: 2026-10-20

This document tracks concrete threats to XOFT's autonomous assistant architecture. It is a working engineering checklist, not a claim that XOFT is certified or immune to attack. Verify each control in code and tests before marking it complete.

## Security goals

Protect the confidentiality of credentials and private data; preserve the integrity of code, memory, social posts, messages and device actions; keep the service available under abuse; and make recovery possible after compromise or failed automation.

## Assets and trust boundaries

- **Secrets:** XOFT admin API keys, AI provider keys, Google OAuth credentials, WhatsApp/Twilio credentials, connector tokens, and the engine/tool-gateway bearer token.
- **Private data:** conversations, long-term memory, email and calendar data, WhatsApp inbox, device state, client leads, proposals, source code and project files.
- **High-impact actions:** send messages, publish content, delete or overwrite files, run terminal/build operations, control devices, change permissions, deploy software, and alter security settings.
- **Untrusted inputs:** web pages and search results, emails, inbound WhatsApp messages, social comments/DMs, third-party tool output, repository content, generated code and any result from a model or external connector.
- **Trust boundaries:** public HTTPS ingress, admin API versus device-scoped tokens, XOFT Core versus execution engines, server versus paired device agents, and XOFT versus external service connectors.

## Threat register

| Priority | Threat | Existing controls / evidence | Required follow-up |
|---|---|---|---|
| Critical | Public API exposed without an admin key | Production startup blocks when NODE_ENV=production, production auth is required, and no AUTH_API_KEYS are configured. Helmet and API rate limiting are configured. | Verify the actual deployment environment, proxy trust, TLS and secrets. Never expose an open development server to the internet. |
| High | API-key timing comparison leaks matching information | src/security/ApiKeyAuth.js uses fixed-length SHA-256 digests and crypto.timingSafeEqual; tests cover exact, incorrect and multiple keys. | Verify the latest CI run; rotate credentials if exposure is suspected. |
| High | Forged or flooded public webhooks | WhatsApp POST validates Meta's signature. Twilio voice routes validate signatures. Webhook endpoints now have a separate rate limiter, bounded Twilio form bodies, and early Helmet headers. Twilio status callbacks fail closed if the canonical public URL is missing. | Verify real Meta/Twilio configuration, proxy IP handling, valid signature success paths, and webhook behavior with live test credentials. |
| High | Prompt injection from a web page, email, message, or connector causes tool misuse | PromptInjectionGuard exists and is passed to selected subsystems. | **Not yet a complete central boundary:** audit every path that passes external tool results, fetched web content, or imported messages into model context. Ensure untrusted content is wrapped at the point it enters reasoning, and enforce authorization outside the model. Add indirect-injection regression tests. |
| High | Excessive agent permissions or autonomy | ToolRegistry enforces declared permissions; approval and emergency-stop systems exist; domain autonomy and device threat monitoring are present. | Audit every tool's requiredPermissions and risk level. Namespace grants are broad by design; consider explicit leaf-only grants for destructive/high-impact permissions. Test denial paths, revocation, retries and emergency stop end-to-end. |
| High | A malicious or compromised connector exfiltrates secrets or performs unintended actions | Tool Gateway uses a bearer token, loopback-only default, task permission profiles, result redaction and path checks. | Test connector allowlists, URL/SSRF controls, secret redaction, request limits, remote-bridge opt-in, and all failure paths. |
| High | Secret committed or leaked in logs/reports | SecurityAgent has a hardcoded-secret scanner and redaction. | Expand scan scope beyond src/ to relevant application, CI, config and deployment files; scan repository history with a dedicated secret scanner; never print full secret values. |
| High | Dependency or CI supply-chain compromise | CI runs tests, builds and dependency checks are available. | Pin third-party GitHub Actions to verified full commit SHAs, minimize GITHUB_TOKEN permissions, run dependency/security scanning, and review untrusted PR workflow permissions. |
| Medium | Denial of service or unexpected provider costs | General API and expensive-endpoint rate limits exist; tool gateway has a request window. | Add bounded request-body sizes, per-user/device quotas, task/token/time budgets, cancellation propagation and persistent abuse alerts. Verify limit behavior behind the actual reverse proxy. |
| Medium | Memory poisoning or cross-context disclosure | Memory provenance, retention, conflict handling and importance scoring exist. | Treat imported facts as untrusted with source and confidence metadata; test cross-session/user isolation, retrieval authorization, deletion, and poisoned memory content. |
| Medium | False success after a task, post, deployment or payment attempt | Multiple components preserve provider status and verification states. | Require external evidence before marking delivery complete; test crash/retry/idempotency and distinguish accepted, delivered, visible, read and paid states. |
| Medium | Device agent compromise or command flood | Device trust, permission grants, command verification and DeviceThreatMonitor exist. | Test quarantine/re-trust, token revocation, replay protection, stale command rejection, and safe behavior when the agent disconnects. |

## Required security invariants

1. **The model is not an authorization system.** Every tool call must be authorized by server-side code immediately before execution.
2. **External content is data, never authority.** A web page, email, message, connector result, or repository file cannot grant permissions or override system policy.
3. **Least privilege by default.** Give each tool, connector, device and execution engine only the permissions it needs. Keep high-impact actions behind explicit approval unless a separately configured policy explicitly allows them.
4. **Fail closed for identity checks.** Missing credentials, invalid signatures, unknown devices, ambiguous authorization and malformed security configuration must not be interpreted as permission.
5. **Bound autonomous work.** Set limits on time, retries, concurrency, output size and external cost; cancellation and emergency stop must propagate to queued work.
6. **No secret disclosure in logs.** Log identifiers, redacted values and event metadata, not bearer tokens, API keys, cookies or message contents unless strictly needed and access-controlled.
7. **Evidence before success.** Report what a system actually confirmed; never infer public visibility, delivery, read receipt, deployment health or payment from a request being accepted.
8. **Recover safely.** Keep auditable state, use idempotency where possible, and verify backups and rollback paths before relying on them.

## Verification workflow

For every security change:

1. Add a regression test for the vulnerable behavior.
2. Run the focused test and the complete npm test suite.
3. Run npm audit and inspect actionable findings instead of hiding failures.
4. Run syntax checks and the relevant Docker, mobile and desktop builds.
5. Inspect GitHub Actions logs and report the exact commit SHA and result.
6. Test against a local disposable environment first; use real provider credentials only for explicitly authorized smoke tests.
7. Document any remaining gap and whether it is code-complete, test-verified, or production-verified.

## Research references

- OWASP GenAI Security Project — current LLM application risk taxonomy: https://owasp.github.io/www-project-top-10-for-large-language-model-applications/
- OWASP Excessive Agency guidance: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- NIST Cybersecurity Framework 2.0: https://www.nist.gov/cyberframework
- GitHub Actions secure-use guidance: https://docs.github.com/en/actions/reference/security/secure-use

These references are guidance, not proof that a particular XOFT control is implemented or effective.