# QA Loop — Iteration 9 (PASS-09) — FULL USER-LEVEL PASS (Array v4)

**Date:** 2026-10-08
**Branch / head tested:** `qa/2026-10-08-production-qa` at `1c02555` (app code = Array v4, PR #165 + d4fd16d)
**Scope:** 75 non-RETIRED rows of `docs/qa/INVENTORY.md` reviewed across the named roles and phone (390×844) and desktop (1280×800); unexercised edges are listed below.
**Verdict:** **NOT CLEAN** — 22 items FAIL with 18 new defects (3 S2, 10 S3, 5 S4) plus open S2 QA-020, which is now visible to every practitioner; 2 items BLOCKED on physical devices or an owner decision.

## What ran

- **Environment.** Local Supabase for this project only (API 127.0.0.1:55321, DB 55322). `npm run qa:preflight` exit 0. No production, `*.supabase.co`, or other-project ports were touched.
- **Servers.** The provided production bundle on :3100 (`next start`, no test flags) was left running untouched. On that build every practitioner is stopped at `/onboarding?reason=legal_unavailable`, because `content/legal/documents.ts` is deliberately empty until counsel supplies text. I started a second `next start` of the **same `.next` build** on **:3101** with `POSTURE_TEST_MODE_ENABLED=1`. That server-side flag loads fixture legal documents and multiplies rate limits ×50. Signed-in flows ran on :3101. Fail-closed legal behaviour (AUTH-06 E2, MSC-03/04 AC2, WIZ-04 E3) and public-token rate limits (CON-03 E2, SHR-01 E3) ran on :3100.
- **Environment fix during the pass.** The build was produced without `public/mediapipe/wasm/` (the prebuild copy hook did not run). `next start` had cached the public directory, so the pose model 404'd. That caused the camera/model e2e failures in batch 1. I restarted only my :3101 instance after the e2e runner copied the assets. :3100 still serves 404 for `/mediapipe/wasm/*`.
- **Method.** Throwaway Playwright scripts (not committed) drove real Chromium sessions signed in through the UI with TOTP. Coverage:
  - a route × role × viewport matrix: 44 routes × {anonymous, practitioner, athlete} × {phone, desktop}, recording status, final URL, h1, dock, overflow, console errors and axe critical/serious on the XC-01 screens;
  - an API boundary matrix (anonymous, malformed cookie, AAL1, athlete, foreign practitioner, share token as bearer, consent token as cookie/query);
  - interactive flows for consent, capture (`?testMode=1` only), results sheets, share links, the workout player, erasure, settings, sign-out, password recovery via local Mailpit and onboarding.
- **Focused e2e specs.** Run against :3101 with `--project=desktop-chromium --workers≤2`. Batch 1: 22 specs, 49/55 pass. All 6 failures came from the missing-WASM environment issue or load. Batch 2: 17 specs, 41 pass, 3 skipped, 3 fail. On a serial rerun, capture-camera passed 3/3 and the blurry-upload test passed when run alone. Flake check: capture-images `--repeat-each=4` failed 2/4, with one image-load failure (QA-028) and one erasure timeout (QA-037). Logs are in `docs/qa/evidence/PASS-09/e2e-*.txt`.
- **Fixtures created** (local, synthetic): 2 self-directed athletes, 1 invited practitioner (onboarding path), about 25 `qa`-prefixed clients for archive, erase, minor, DOB, wizard and consent cases.

## Environment validity

Signed-in results are provisional. They ran on :3101 with the same `.next` bundle as :3100, but with `POSTURE_TEST_MODE_ENABLED=1` to serve fixture legal text and with MediaPipe WASM copied after build and server start. :3100 was built with `npx next build`, which skips the `prebuild` WASM copy, and has no approved legal text locally. It cannot establish signed-in, production-like behavior. The fixture flag is never allowed in production; `lib/legal/runtime.ts` also disables fixture fallback when `VERCEL_ENV=production`.

Production legal text comes from the compile-time `LEGAL_DOCUMENTS` catalog in `content/legal/documents.ts`, imported and frozen by `lib/legal/catalog.ts`. That catalog is currently empty. A governed release needs counsel-approved, effective Privacy, Terms, Subject Consent and Screening Notice entries, with their IDs, versions, content hashes, context and counsel approval references validated in CI. `lib/legal/policy.ts` rejects missing approval, invalid scope or hashes, and unavailable text fails closed. `docs/RUNBOOK.md` requires the approved documents and a privacy-safe HG-02 release receipt before the one-way `public.activate_legal_governance()` step; no local fixture or test flag replaces that approval.

The closing rerun needs an `npm run build` bundle so `prebuild` copies MediaPipe WASM before Next builds, plus approved legal documents compiled into that bundle and the local governed database set up per the runbook. Start it with test mode off, verify legal documents resolve and `/mediapipe/wasm/*` loads, then repeat signed-in journeys and the failed edges. Until approved text is provisioned, that closing rerun is blocked.

## Seed counts (`npm run qa:seed`, deterministic)

practitioners 3 · clients_active 171 · clients_tombstoned 9 · assessments_draft 96 · assessments_approved 128 · client_deletion_log 9 · consents_granted 152 · consents_revoked 10 · consent_tokens_pending 7 · consent_tokens_expired 5 · ws_active 42 · ws_completed 23 · ws_revoked 12 · runs_in_progress 10 · runs_completed 23 · ratings 10 · share_events_minted 35 · share_events_revoked 12 · captures 448 · findings 2016.
Note: all 152 seeded consents are `legacy_unverified`, so every seeded client shows "New consent required". Capture flows used freshly consented clients.

## Results by area

| Area | Items | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| Auth and account | 10 | 8 | 2 (AUTH-06, AUTH-07) | 0 |
| Clients and consent | 10 | 5 | 5 (CLI-02, CLI-03, CLI-04, CLI-06, CON-01) | 0 |
| Capture, assessments and knowledge | 13 | 6 | 5 (WIZ-04, RES-01..04) | 2 (WIZ-03, CAM-REAL) |
| Reports and progress | 3 | 2 | 1 (REP-02) | 0 |
| Workouts, training and share | 17 | 13 | 4 (WKT-10, SHR-01, SHR-05, TRN-02) | 0 |
| Settings, public pages and v4 chrome | 16 | 11 | 5 (V4-TOAST, V4-TOPBAR, XC-01, XC-02, XC-04) | 0 |
| Development-only and legacy routes | 6 | 6 | 0 | 0 |
| **Total** | **75** | **51** | **22** | **2** |

Highlights that passed: every protected page and API denied anonymous users, AAL1 sessions, athletes and foreign practitioners (401/403/404 with no record fields). Expired, revoked and random share and consent tokens had uniform unavailable responses, and rate limits returned 429 on :3100. Erasure purged captures and photos and invalidated old share, consent and report URLs, although one one-photo DELETE exceeded 30 s (QA-037). Submission replay and concurrent submits were idempotent. Exported PDFs contain only the sanctioned diagnosis disclaimer. Axe found zero critical or serious findings on all XC-01 screens at both viewports. The heavy account (143 active clients) paginated to all 143 unique rows, and its dashboard loaded in about 1.1 s. A valid share token still exposes the client's first name (QA-036).

## New defects (BUGLOG)

| ID | Sev | Title | Items |
|---|---|---|---|
| QA-021 | S2 | Password reset dead-ends for every MFA-enrolled account (raw "AAL2 session is required…" error) | AUTH-07, XC-02 |
| QA-022 | S2 | Capture endpoint accepts archived clients | WIZ-04 |
| QA-023 | S2 | Share-token mint accepts archived clients and the public link resolves | SHR-05 |
| QA-024 | S3 | Client DOB validation: malformed dates → HTTP 500, future dates saved | CLI-02, CLI-04 |
| QA-025 | S3 | Production CSP blocks a nonce-less script chunk on practitioner pages | XC-02 |
| QA-026 | S3 | Posture map stuck "Loading…" without WebGL | RES-02 |
| QA-027 | S3 | Results header clips/overlaps at 320 px + 200% text | XC-04, V4-TOPBAR |
| QA-028 | S3 | Enlarged capture photo intermittently never loads (carry-over 2) | RES-03 |
| QA-029 | S3 | Foreign/archived/missing record pages answer 200 instead of 404 | CLI-03, RES-01, WKT-10 |
| QA-030 | S4 | /onboarding re-shows the agreement after acceptance | AUTH-06 |
| QA-031 | S3 | Raw "Failed to fetch" / "[object Event]" strings shown to users | XC-02 |
| QA-032 | S4 | Zero-scan client offers an enabled Compare action | REP-02 |
| QA-033 | S4 | Practitioner athlete-erasure call returns 404 not 403 | TRN-02 |
| QA-034 | S4 | Focus lands on `<main>`, not the h1, after navigation | XC-01 |
| QA-035 | S4 | Success toast renders under the sheet scrim over the title | V4-TOAST |
| QA-036 | S3 | Public share exposes the client's first name | SHR-01 |
| QA-037 | S3 | One-photo client erasure exceeds 30 seconds | CLI-06 |
| QA-038 | S3 | In-person grant leaves an earlier remote consent link live | CON-01, CON-03 |

**QA-020 re-check:** visible in the current build. #157 removed the clinical-content gate, and `/api/health` reports `clinical_content: active (clinical_content_gate_removed)`. The knee-alignment Why sheet lists both the knock-knee (hip adductors) and bow-knee (TFL/IT band) muscles for one finding. Every genu `direction_applicability` is NULL. RES-02 and RES-04 fail on it.

**Carry-over list (`~/Inbox/notes/posture-v4/qa-carryover.md`):** capture-photo load flake reproduced (QA-028). Offline replay overlap across two documents and the sign-out clear not bound to user id were not reproduced in user-level runs, so they are not logged. The training offline/account-switch specs passed. The sign-out confirm ("Sign out? You'll need to sign in again to continue.") still does not mention unsynced workout saves; that is a product question for Devin.

## Notes and inventory drift (not logged as bugs)

- KB-01/KB-03/RES-02 E2/RES-04 E3 say "approved" content. After #157 the whole catalog is open by owner decision, and the Muscle Guide says "All entries pending review". I graded against the open catalog. The inventory wording needs an update.
- WKT-07 E2 and DEMO-03 E1 (clinical gate off) cannot occur in this build.
- Erasing a client purges its assessments, so minting from an erased client's assessment returns 404, not the 409 in SHR-05 AC3 and WKT-01 E1. That is a denial with no token, recorded as PASS.
- The outstanding remote consent link after an in-person grant is QA-038. Withdrawal deletes outstanding links; a second grant through the earlier token adds a new enrollment.
- Share pages greet the client by first name ("Bob's session", "Hi Bob"). QA-036 records the written SHR-01 failure; Devin must decide whether first name is acceptable.
- One seeded exercise title is Spanish ("(D) Puente de glúteos"). That is licensed wger content, cosmetic.

## Not exercised

- CLI-01 E3 at 150 active clients: the heavy account had 143 active clients; 150 were seeded before archived or tombstoned rows were excluded.
- PRG-01 E2 with 150 assessments for one client: no such client was seeded.
- TRN-01 E3, WKT-08 E2 and XC-05 E4 after relationship revocation: rerun on the isolated fixture stack.
- AUTH-06 second write after revisiting `/onboarding`.
- QA-038 browser replay of the stale remote consent link; its lifecycle finding comes from the app route and database RPC source.
- DEV-01..03 development-build acceptance criteria: only production behavior was checked.
- Blurry-upload quality-warning spec under stable load: it failed twice under concurrent load and passed alone, so the flake remains unresolved.
- XC-02 E1 DB-down health on the shared database.

## Blocked handoff

- CAM-REAL: physical iPhone Safari and Android Chrome.
- WIZ-03: AC1/E1 remain BLOCKED on a physical tilt sensor. Run E2 (no sensor) on desktop Chromium in the closing rerun; the current spec asserts no indicator while inventory E2 requires a sensor-unavailable message. Devin must resolve that expectation.

## Evidence

Screenshots and raw results are in `docs/qa/evidence/` (gitignored, kept on disk): `QA-0NN-*.png`, `QA-028-trace-network.txt`, `PASS-09/*.json` (per-script PASS/FAIL records), `PASS-09/matrix-*.log` and `PASS-09/e2e-*.txt`.
