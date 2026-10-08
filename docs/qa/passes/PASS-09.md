# QA Loop — Iteration 9 (PASS-09) — FULL USER-LEVEL PASS (Array v4)

**Date:** 2026-10-08
**Branch / head tested:** `qa/2026-10-08-production-qa` at `1c02555` (app code = Array v4, PR #165 + d4fd16d)
**Scope:** every non-RETIRED row of `docs/qa/INVENTORY.md` (75 items), each role in its row, phone (390×844) and desktop (1280×800)
**Verdict:** **NOT CLEAN** — 19 items FAIL with 15 new defects (1 S2, 7 S3, 7 S4) plus open S2 QA-020, which is now visible to every practitioner; 2 items BLOCKED on physical devices or an owner decision.

## What ran

- **Environment.** Local Supabase for this project only (API 127.0.0.1:55321, DB 55322). `npm run qa:preflight` exit 0. No production, `*.supabase.co`, or other-project ports were touched.
- **Servers.** The provided production bundle on :3100 (`next start`, no test flags) was left running untouched. On that build every practitioner is stopped at `/onboarding?reason=legal_unavailable`, because `content/legal/documents.ts` is deliberately empty until counsel supplies text. So no signed-in practitioner flow can run on :3100. I started a second `next start` of the **same `.next` build** on **:3101** with `POSTURE_TEST_MODE_ENABLED=1`. That is the server-side flag the e2e runner uses to load the fixture legal documents. It also multiplies rate limits ×50. Signed-in flows ran on :3101. Fail-closed legal behaviour (AUTH-06 E2, MSC-03/04 AC2, WIZ-04 E3) and public-token rate limits (CON-03 E2, SHR-01 E3) ran on :3100.
- **Environment fix during the pass.** The build was produced without `public/mediapipe/wasm/` (the prebuild copy hook did not run). `next start` had cached the public directory, so the pose model 404'd. That caused the camera/model e2e failures in batch 1. I restarted only my :3101 instance after the e2e runner copied the assets. :3100 still serves 404 for `/mediapipe/wasm/*`. Deployments that run `npm run build` (prebuild hook) are not affected.
- **Method.** Throwaway Playwright scripts (not committed) drove real Chromium sessions signed in through the UI with TOTP. Coverage:
  - a route × role × viewport matrix: 44 routes × {anonymous, practitioner, athlete} × {phone, desktop}, recording status, final URL, h1, dock, overflow, console errors and axe critical/serious on the XC-01 screens;
  - an API boundary matrix (anonymous, malformed cookie, AAL1, athlete, foreign practitioner, share token as bearer, consent token as cookie/query);
  - interactive flows for consent, capture (`?testMode=1` only), results sheets, share links, the workout player, erasure, settings, sign-out, password recovery via local Mailpit and onboarding.
- **Focused e2e specs.** Run against :3101 with `--project=desktop-chromium --workers≤2`. Batch 1: 22 specs, 49/55 pass. All 6 failures came from the missing-WASM environment issue or load. Batch 2: 17 specs, 41 pass, 3 skipped, 3 fail. On a serial rerun, capture-camera passed 3/3 and the blurry-upload test passed when run alone. Flake check: capture-images `--repeat-each=4` failed 2/4 (QA-028). Logs are in `docs/qa/evidence/PASS-09/e2e-*.txt`.
- **Fixtures created** (local, synthetic): 2 self-directed athletes, 1 invited practitioner (onboarding path), about 25 `qa`-prefixed clients for archive, erase, minor, DOB, wizard and consent cases.

## Seed counts (`npm run qa:seed`, deterministic)

practitioners 3 · clients_active 171 · clients_tombstoned 9 · assessments_draft 96 · assessments_approved 128 · client_deletion_log 9 · consents_granted 152 · consents_revoked 10 · consent_tokens_pending 7 · consent_tokens_expired 5 · ws_active 42 · ws_completed 23 · ws_revoked 12 · runs_in_progress 10 · runs_completed 23 · ratings 10 · share_events_minted 35 · share_events_revoked 12 · captures 448 · findings 2016.
Note: all 152 seeded consents are `legacy_unverified`, so every seeded client shows "New consent required". Capture flows used freshly consented clients.

## Results by area

| Area | Items | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| Auth and account | 10 | 8 | 2 (AUTH-06, AUTH-07) | 0 |
| Clients and consent | 10 | 7 | 3 (CLI-02, CLI-03, CLI-04) | 0 |
| Capture, assessments and knowledge | 13 | 6 | 5 (WIZ-04, RES-01..04) | 2 (WIZ-03, CAM-REAL) |
| Reports and progress | 3 | 2 | 1 (REP-02) | 0 |
| Workouts, training and share | 17 | 14 | 3 (WKT-10, SHR-05, TRN-02) | 0 |
| Settings, public pages and v4 chrome | 16 | 11 | 5 (V4-TOAST, V4-TOPBAR, XC-01, XC-02, XC-04) | 0 |
| Development-only and legacy routes | 6 | 6 | 0 | 0 |
| **Total** | **75** | **54** | **19** | **2** |

Highlights that passed: no data leaked across any role boundary. Every protected page and API denied anonymous users, AAL1 sessions, athletes and foreign practitioners (401/403/404 with no record fields). Share and consent token JSON and pages were uniform for expired, revoked and random tokens, and rate limits returned 429 on :3100. Erasure purged captures and photos, and invalidated old share, consent and report URLs. Submission replay and concurrent submits were idempotent. Exported PDFs contain only the sanctioned diagnosis disclaimer. Axe found zero critical or serious findings on all XC-01 screens at both viewports. The heavy account (143 active clients) paginated to all 143 unique rows, and its dashboard loaded in about 1.1 s.

## New defects (BUGLOG)

| ID | Sev | Title | Items |
|---|---|---|---|
| QA-021 | S2 | Password reset dead-ends for every MFA-enrolled account (raw "AAL2 session is required…" error) | AUTH-07, XC-02 |
| QA-022 | S3 | Capture endpoint accepts archived clients | WIZ-04 |
| QA-023 | S3 | Share-token mint accepts archived clients and the public link resolves | SHR-05 |
| QA-024 | S3 | Client DOB validation: malformed dates → HTTP 500, future dates saved | CLI-02, CLI-04 |
| QA-025 | S3 | Production CSP blocks a nonce-less script chunk on practitioner pages | XC-02 |
| QA-026 | S3 | Posture map stuck "Loading…" without WebGL | RES-02 |
| QA-027 | S3 | Results header clips/overlaps at 320 px + 200% text | XC-04, V4-TOPBAR |
| QA-028 | S3 | Enlarged capture photo intermittently never loads (carry-over 2) | RES-03 |
| QA-029 | S4 | Foreign/archived/missing record pages answer 200 instead of 404 | CLI-03, RES-01, WKT-10 |
| QA-030 | S4 | /onboarding re-shows the agreement after acceptance | AUTH-06 |
| QA-031 | S4 | Raw "Failed to fetch" / "[object Event]" strings shown to users | XC-02 |
| QA-032 | S4 | Zero-scan client offers an enabled Compare action | REP-02 |
| QA-033 | S4 | Practitioner athlete-erasure call returns 404 not 403 | TRN-02 |
| QA-034 | S4 | Focus lands on `<main>`, not the h1, after navigation | XC-01 |
| QA-035 | S4 | Success toast renders under the sheet scrim over the title | V4-TOAST |

**QA-020 re-check:** visible in the current build. #157 removed the clinical-content gate, and `/api/health` reports `clinical_content: active (clinical_content_gate_removed)`. The knee-alignment Why sheet lists both the knock-knee (hip adductors) and bow-knee (TFL/IT band) muscles for one finding. Every genu `direction_applicability` is NULL. RES-02 and RES-04 fail on it.

**Carry-over list (`~/Inbox/notes/posture-v4/qa-carryover.md`):** capture-photo load flake reproduced (QA-028). Offline replay overlap across two documents and the sign-out clear not bound to user id were not reproduced in user-level runs, so they are not logged. The training offline/account-switch specs passed. The sign-out confirm ("Sign out? You'll need to sign in again to continue.") still does not mention unsynced workout saves; that is a product question for Devin.

## Notes and inventory drift (not logged as bugs)

- KB-01/KB-03/RES-02 E2/RES-04 E3 say "approved" content. After #157 the whole catalog is open by owner decision, and the Muscle Guide says "All entries pending review". I graded against the open catalog. The inventory wording needs an update.
- WKT-07 E2 and DEMO-03 E1 (clinical gate off) cannot occur in this build.
- Erasing a client purges its assessments, so minting from an erased client's assessment returns 404, not the 409 in SHR-05 AC3 and WKT-01 E1. That is a denial with no token, recorded as PASS.
- An in-person consent grant does not invalidate an outstanding remote consent link. Withdrawal does. Not covered by an AC.
- Share pages greet the client by first name ("Bob's session", "Hi Bob"). That is a deliberate `clientFirstName` projection. Devin should confirm it meets SHR-01's "no legal name".
- Not exercised: relationship-revocation edges (TRN-01 E3, WKT-08 E2, XC-05 E4), which need the isolated 55421 fixture stack; DB-down health (XC-02 E1) on the shared database; 150-scan history (PRG-01 E2), because no such client is seeded; dev-build ACs of DEV-01..03. These are noted in the inventory cells.
- The blurry-upload quality-warning e2e test failed twice under concurrent load and passed alone. Watch it; not logged.
- One seeded exercise title is Spanish ("(D) Puente de glúteos"). That is licensed wger content, cosmetic.

## Blocked handoff

- CAM-REAL: physical iPhone Safari and Android Chrome.
- WIZ-03: a physical tilt sensor, and a Devin decision on whether capture without sensors must show a "sensor unavailable" message. The current spec asserts no indicator.

## Evidence

Screenshots and raw results are in `docs/qa/evidence/` (gitignored, kept on disk): `QA-0NN-*.png`, `QA-028-trace-network.txt`, `PASS-09/*.json` (per-script PASS/FAIL records), `PASS-09/matrix-*.log` and `PASS-09/e2e-*.txt`.
