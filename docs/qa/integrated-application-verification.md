# Original application integration verification

Verified locally on 2026-09-07 against the original Posture AI application and a preserved local Supabase database. This is the unused prototype workflow requested for demonstration, not a clinical release certification.

## Completed behavior

- Original dashboard, clients, four-view capture, assessment findings/evidence/program tabs, and guided player remain the application. Former `/demo` routes redirect into it; the separate shell, localStorage records, and anonymous generation endpoint were removed.
- Original client form creates persistent prototype clients without fabricating consent dates. Authentication, MFA, active practitioner admission, and record ownership remain required.
- Scan point-cloud positions remain deterministic across view switching and reload; terminal foot particles use the final silhouette span.
- Four real standing-photo uploads ran through MediaPipe and saved an assessment with nine findings. Upload validation, camera playable-frame readiness, model-startup failure recovery, bounded analysis, and cancellation have regression coverage.
- Workout creation uses owned, completed, approved assessment findings and bounded preferences. Users can create an AI or scan-based plan, customize it, save it, follow it, resume after reload, rate it, edit a copy, and archive it. Existing historical sessions retain a regeneration path.
- Live DeepSeek generation returned `source: ai` and persisted. Only the selected approved provider is called; provider failure is visibly labeled as a scan-based fallback.
- The player persisted movement completion, resumed at the next movement, completed the session, saved a rating, previewed an edited copy, and archived it. Browser checks recorded no page errors.
- Report creation and authenticated PDF download both returned 200. Prototype reports contain an explicit prototype notice and no invented legal-document or clinical-review receipt.

## Checks

- Full unit/integration suite: **246 files, 2,294 tests passed**.
- Production build and TypeScript checks passed. ESLint reported no errors; existing warnings remain.
- Database contracts: workout metadata **9/9**, prototype operation **25/25** pgTAP checks passed. The prototype transaction rolls back child-write failures, rejects cross-owner writes and cross-operation replay, and does not mint public share tokens.
- Desktop/mobile portrait evidence ordering and a simulated-camera playable-frame/review flow passed. These checks do not establish physical iOS/Android camera lifecycle or thermal behavior.
- Original navigation keyboard access, active destination, responsive layout, and reduced-motion checks passed in desktop Chromium, mobile WebKit, and Android Chromium browser emulation.
- Independent source review found and closed replay-provenance, library refresh, and archive error-handling issues. An attempted Grok advisory retry was unavailable because its provider returned HTTP 402; it is not represented as a passing review.

## Deployment behavior

The additive migrations preserve historical records as `legacy`; new prototype records carry explicit prototype provenance. Production verification recorded unchanged counts before and after migration: 6 practitioners, 12 clients, 12 assessments, 9 workouts, and 8 reports. No accounts were created and no data reset was performed.

The server configuration enables prototype operation for the existing active practitioner IDs. See `docs/RUNBOOK.md` for environment names and release verification. Never enable global test-mode flags on the hosted deployment.
