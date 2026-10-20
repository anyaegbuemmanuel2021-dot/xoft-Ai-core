# XOFT voice, scheduling, and dashboard audit

Audit date: 2026-10-20
Repository: `anyaegbuemmanuel2021-dot/xoft-Ai-core`

This audit distinguishes code that exists from functionality that has been verified live. A configured integration and a running, reachable server are still required for external delivery.

## Findings

| Capability | Existing implementation | Current limitation / next verification |
|---|---|---|
| Voice output | Browser speech synthesis in `public/js/voice/speak-out.js`; server TTS in `src/voice/VoiceService.js` | Browser speech depends on the device/browser. Server TTS requires ElevenLabs credentials. Verify the end-to-end dashboard control and fallback behavior. |
| Speech input / wake phrase | `public/js/voice/wake.js`, `src/voice/WakeWordService.js`, voice pipeline tests | Wake phrase is not equivalent to native, always-on wake-word detection. Continuous microphone capture must be implemented in a permitted client app and is subject to Android/browser background restrictions. |
| Scheduled briefings | `src/proactive/BriefingScheduler.js`; settings API and controls in `public/js/views/settings.js` | Supports morning/evening time, timezone, and dashboard/SMS/call/either delivery. The scheduler must be running, and phone delivery requires working Twilio configuration. Provider acceptance is not proof the user answered or heard the call. |
| Outbound voice calls | `src/integrations/TwilioService.js` | Requires Twilio credentials, public HTTPS webhook URLs, a supported destination, and account permission/balance. Must be live-tested before claiming calls work. |
| Calendar events | `src/agents/calendar/CalendarService.js` and calendar tools | Requires Google OAuth credentials with calendar scope. Calendar reminders/alarms are not the same as a native Android alarm or a guaranteed phone call. |
| Background missions | `src/scheduler/MissionScheduler.js`, `src/scheduler/MissionAutopilot.js`, background job manager | A continuously running worker and durable storage are required. Confirm restart recovery and hosted-process behavior in deployment. |
| Opportunity scouting | `src/proactive/OpportunityScout.js` and opportunity dashboard | Search results are leads, not verified jobs or guaranteed income. A human should verify client identity, scope, deadlines, payment terms, and scam indicators before sharing sensitive data or accepting work. |

## Recommended implementation order

1. Keep voice, reminders, and outbound calls as distinct capabilities with honest readiness states.
2. Add a single schedule/reminders view that lists upcoming events, timezone, delivery channel, status, retry state, and a safe test/preview action.
3. Add durable reminder records with idempotency keys, explicit user consent for calls/SMS, bounded retries, quiet hours, and cancellation.
4. Improve the voice UI to expose microphone permission, listening state, wake mode, transcript/command state, and clear stop controls. Never imply always-listening while the client is not actually listening.
5. Add end-to-end tests for scheduler restart, duplicate prevention, failed delivery, cancellation, and Twilio-unconfigured states.
6. Audit all dashboard navigation entries for dead links, empty screens, and misleading "connected" indicators; replace placeholders with useful setup/status/empty states rather than fabricated activity.
7. Run repository CI and a live smoke test after code changes. Do not claim deployment or phone-call delivery until verified.

## Safety and cost constraints

- Keep the emergency stop and permission system in the execution path.
- Do not put API keys or personal phone numbers in logs.
- Do not send calls/messages or accept jobs without explicit configuration and appropriate consent.
- Use one backend where possible; free hosting is not guaranteed to stay awake and external AI/telephony providers may charge separately.
- Never claim that XOFT found a paid job or made money unless the opportunity and resulting payment are actually verified.
