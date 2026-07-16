# QA Inventory — posture-ai

Master checklist for `/qa-loop`. One row per user-facing item. Generated from
the real route tree at commit `c466787` (2026-07-04) — diff against
`find app -name page.tsx -o -name route.ts` at the start of every pass.

**Roles:** P = practitioner (authed) · CT = consent-token client · ST = share-token client · A = anonymous
**Status:** blank = untested · PASS · FAIL(QA-NNN) · BLOCKED(reason) · RETIRED
**Edge cases are finite and risk-ranked — max 5/row.** `(expand)` = criteria need refinement in Phase 1 before testing that row.

## Iteration 2 visual-system addendum (2026-07-10)

The route-level functional verdicts below remain the Iteration 1 baseline. Iteration 2
performed a separate production-build visual and motion sweep at 1440px and 390px across
the marketing, auth, legal, dashboard, client list/detail/create, assessment create/results,
exercise, muscle-guide, and settings surfaces. All captured routes passed horizontal-overflow
and browser-console checks. Evidence and remaining device-only limits are recorded in
`passes/PASS-02.md`.

## Iteration 3 motion-system addendum (2026-07-10)

Iteration 3 recorded the Fusion reference and the local public/authenticated experience as
scroll-and-hover video, extracted timestamped visual frames, and verified the translated
motion system at 1440px and 390px. Evidence and motion-specific criteria are recorded in
`passes/PASS-03.md`.

## Iteration 4 glass-material addendum (2026-07-10)

Iteration 4 replaced the opaque green-gray material with neutral smoked glass, localized
orange/cyan illumination, directional highlights, layered shadows, and darker nested
control wells. It includes literal Fusion-reference/build and before/after comparison
images plus a separate adversarial verification pass. Evidence and material-specific
criteria are recorded in `passes/PASS-04.md`.

## Iteration 6 cross-surface polish addendum (2026-07-15)

Iteration 6 completed the bounded Plan 004 motion, atmosphere, touch-target, and
decorative-cleanup pass. Marketing, dashboard, and exercises have no horizontal overflow
at 320, 375, 414, 768, 1024, or 1440 px; representative 320/1440 screenshots were
reviewed; the browser console was clean. The desktop Chromium Axe budget and workout
player suite are green. Evidence and remaining device-only limits are in `PASS-06.md`.

## Auth & account

| ID | Item | Roles | Acceptance criteria | Edge cases (risk-ranked) | Pass 1 |
|---|---|---|---|---|---|
| AUTH-01 | `/auth/sign-up` | A | Valid email+password creates account, lands in onboarding; errors shown inline, input preserved | duplicate email; weak password message; double-submit creates one account | PASS (email+password≥8 form; valid signup→"Check your email to confirm your account, then sign in" — no auto-login on unconfirmed = secure). Duplicate/weak-pw/double-submit not driven |
| AUTH-02 | `/auth/sign-in` | A | Valid creds → dashboard; invalid → inline error, no user enumeration in message | wrong password 5× (rate-limit UX); `?next=` open-redirect attempt (must stay same-origin, `lib/auth/safe-next`) | PASS (invalid→generic "Invalid login credentials" in assertive alert, email preserved, no enum; valid→/dashboard) |
| AUTH-03 | `/auth/forgot-password` + `/auth/update-password` | A | Reset email flow completes; new password works; old session invalidated | expired reset link; reuse of consumed link | PASS(render) — /forgot-password 200 "Reset password"+email field; /update-password 200 "Choose a new password". Full email round-trip (Inbucket token, expired/consumed link) NOT driven |
| AUTH-04 | Sign-out (`/api/auth/sign-out`) | P | Session ends; protected routes redirect to sign-in; back-button shows no cached PHI-adjacent data | sign-out in one tab, action in second tab | PASS (POST sign-out→session ends; /dashboard→redirect /auth/sign-in). Back-button-cache + two-tab not driven |
| AUTH-05 | Route protection (middleware) | A | EVERY P-only page/API 307s or 401s cleanly for anonymous — never 500, never data leak | direct API hits with no cookie; stale/garbage JWT | PASS (anon GET+POST /api/{clients,assessments,reports,settings,workouts} all 307→/auth/sign-in, no 500/leak) |
| AUTH-06 | `/onboarding` | P | Disclaimer ack required before app use; persists; not re-shown after | skip attempt via direct URL to /dashboard pre-ack | PASS (new practitioner→/onboarding Non-Diagnostic Disclaimer w/ screening-vocab rules + qualified-professional attestation; Continue gated on checkbox; skip attempt /dashboard pre-ack→bounced back to /onboarding; ack→/dashboard) |

## Clients

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| CLI-01 | `/clients` list | P | Lists own clients only; search works; empty state on fresh account | heavy account (150 clients): loads <3s, pagination/scroll correct | FAIL(QA-001) — list shows own clients + search box, BUT includes tombstoned (deleted_at) clients Beth/Carl Smith (reconfirmed live). Empty-state PASS (fresh account "Run your first assessment"). Heavy-account perf not yet checked |
| CLI-02 | `/clients/new` | P | Create with validation (DOB, email format); appears in list | minor (<18) DOB flags consent requirement; duplicate name allowed but disambiguated | PASS (created "QA TempClient" DOB 1990-06-15 w/ inline in-person consent [=CON-01]; required-field validation; lands on detail w/ Consent ✓). Minor-DOB consent-role gating not driven here |
| CLI-03 | `/clients/[id]` detail | P | Shows client, assessment history, consent status | other practitioner's client id → 404 not 403-leak; deleted client → tombstone behavior | PASS — cross-tenant boundary (heavy's client→redirect /clients; heavy's assessment→"not found", no leak) + own-client detail renders (name/DOB/consent✓/Edit/Archive/New Assessment/assessment history w/ deviation·grade). Deleted-client tombstone view NOT yet driven (covered by QA-001 read-path cluster) |
| CLI-04 | `/clients/[id]/edit` | P | Edits persist; cancel discards | concurrent edit (two tabs) last-write behavior stated | PASS (edit pre-populated; changed last name→persisted "QA TempEdited" + note; PATCH refuses edits to tombstoned client per route:76). Concurrent-edit not driven |
| CLI-05 | Client deletion | P | Deletion flow completes; `client_deletion_log` written; data unreachable after | deleted client's share tokens/reports return uniform 404 (deletion.spec parity); undo not offered | PASS — Archive (recoverable): confirm dialog→removed from active list. Erase (GDPR, DELETE): 200 {ok, purge counts}; DB PII→"REDACTED" + deleted_at set; client_deletion_log written (original_client_id+counts); API list excludes. Erased-token/report uniform-404 not re-driven (SHR garbage-404 path shown) |

## Consent (BIPA-adjacent — highest risk area)

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| CON-01 | Record consent in-person (`/api/consent`) | P | Consent recorded with type+timestamp; reflected on client page and capture gate | re-consent after decline; consent for minor by guardian | PASS (captured inline at client-create: "Who is giving consent" self/parent/guardian/other + signature + agreement checkbox; reflected as Consent ✓ on client detail). Re-consent-after-decline not driven |
| CON-02 | Consent link mint (`/api/consent/link`) | P | Link generated, expiring; copyable | expired link visit; revoked-before-visit | PASS (POST→200: `/consent/[uuid]` URL + QR data-uri + expires_at +7d; garbage client_id→404 "Client not found") |
| CON-03 | `/consent/[token]` client page | CT, A | Client can grant/decline; screening-safe copy; confirmation shown | reuse after respond (idempotent, no flip); garbage token → uniform 404; expired → clear message not 500 | PASS — valid token (anon-context): BIPA-safe copy, guardian/minor roles, signature gate; grant→"Consent recorded"; idempotent reuse→422 "already been used" (no flip); garbage→uniform 404; no nav leak to anon. Minor S4 UX nit: GET re-renders form on consumed token (server enforces, cosmetic) |
| CON-04 | Capture gate on consent | P | Step 1→2 blocked without consent (age+consent both checked, PR #51); link offered | consent granted mid-wizard in second tab → gate re-checks | BLOCKED(camera path) — the age+consent capture gate lives on the real-camera capture step; testMode injects fixtures past it. Consent-reflected-on-client-page confirmed (CON-01). Live gate → CAM-REAL device pass |

## Assessment wizard & capture

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| WIZ-01 | `/assessments/new` step flow | P | Client select → capture → review → submit; Back preserves state (wizard-nav.spec parity) | abandon at step 2 creates no assessment; refresh mid-wizard | PASS (4-step flow Client→Upload→Processing→Results; search/select; Next disabled until pick; Back present). PASS-06 removed the pre-hydration descendant mutation recorded as QA-005; fresh wizard/results Axe and console sweeps are green. NOTE: client picker lists tombstoned Beth/Carl Smith — QA-001 read-path extension (see BUGLOG) |
| WIZ-02 | Capture (fixture path, `?testMode=1` run only) | P | Front+side capture with countdown, preview, retake; per-photo quality preflight messages | no-person-detected retake message; legs-not-visible warning + override | BLOCKED(camera path) — testMode bypasses capture UI (injects fixtures directly at step 2 "Confirm"); real capture countdown/preview/retake/preflight only exercisable on-device → folds into CAM-REAL manual pass |
| WIZ-03 | Tilt/level gates | P | >5° tilt blocks with live feedback; override allowed and recorded | mid-burst tilt aborts partial frames (PR #51) | BLOCKED(camera path) — same as WIZ-02; results page DOES surface "⚠ Camera level not verified" + "Level not verified" chip, so the downstream flag renders. Live tilt gate → CAM-REAL manual pass |
| WIZ-04 | Submit → scoring (`POST /api/assessments`) | P | Synchronous scoring returns complete; invalid frames JSON rejected by zod with 4xx | oversized payload; double-submit → one assessment; network drop mid-submit UX | PASS — testMode fixture→scoring→results (assessment 97221b37, Alice, Grade B/26); garbage POST→422 zod (no 500). Approve→"report export enabled" + Launch/Share/PDF enable (gate confirmed). Oversized/double-submit/network-drop not driven |
| CAM-REAL | Real camera on physical iPhone Safari + Android Chrome | P | getUserMedia flow completes on real devices; model download progress shown; no tab crash | low-power mode; camera-in-use by another app; permission denied then re-granted | BLOCKED(manual device pass — never fake to PASS) |
| WIZ-04 | Submit → scoring (`POST /api/assessments`) | P | Synchronous scoring returns complete; invalid frames JSON rejected by zod with 4xx | oversized payload; double-submit → one assessment; network drop mid-submit UX | |

## Results & knowledge base

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| RES-01 | `/assessments/[id]` results | P | 10 distortions with severity zones + grade; unreliable metrics explained with re-shoot guidance | unreliable-landmark assessment renders without crash; other-practitioner id → 404 | PASS (re-confirmed on fresh Alice assessment: all 10 distortions w/ zones/severity/direction; grade B 26/100; Pelvic Rotation UNRELIABLE not-scored + "not shown to client"; Upper-Back Rounding monitor-only; screening vocab; 3D gated; camera-level-not-verified flag; 0 console errors). Other-practitioner-404 was covered by CLI-03 cross-tenant |
| RES-02 | 3D muscle map + aggregate summary | P | Implicated muscles highlighted; links to muscle pages (muscle-3d.spec parity) | WebGL unavailable → fallback, not blank | PASS (3D POSTURE SUMMARY: tight/weak shaded-by-severity; "Show 3D model ~9MB" gated button; Gluteus Medius implicated; Postural Alignment Diagram front(6)/side(4) findings w/ maintain/warning/danger legend). Muscle chip links 404 in prod = QA-002, not a RES-02 code defect. WebGL-off fallback not driven |
| RES-03 | Accuracy & methodology card | P | Stability/uncertainty/limitations shown; screening vocabulary | (expand) | PASS ("A single-photo 2D screening (BlazePose, 33 landmarks) — no depth... Stability shows consistency across capture burst, not a clinical-accuracy guarantee"; Level-not-verified; screening vocab) |
| RES-04 | Priority program + exercise detail sheet | P | RampTable exercise names open detail sheet: instructions, sets/hold, muscles, media-or-fallback | exercise with no media → clean fallback (never broken img); slow query → loading state (PR #54 single-select) | PASS (3 priorities w/ LOOSEN→STRENGTHEN(→CONNECT) ordering, Monitor-only demote, capability selector, SWAP dropdowns, week1/2/3 progression w/ sets×reps, exercise buttons→detail sheets, ALL-MATCHED-EXERCISES library list). Media-fallback + slow-query loading not driven |
| KB-01 | `/muscles` + `/muscles/[slug]` | P | Library lists regions, search works (muscle-kb.spec parity); detail shows anatomy/function/why | unreviewed muscle shows Pending-review badge in dev/preview only | FAIL(QA-002) — components SOUND (with reviewed content: 29 muscles in 5 regions, detail=anatomy/function/screening/findings/exercises, screening vocab, 0 console err) BUT prod build hides all 29 (0 reviewed_at) → empty guide + 404 details + dead result links |
| KB-02 | `/exercises` library | P | 73 exercises listed with thumbnails-or-fallback; filterable | (expand) | PASS (73 exercises: Activation 8/Mobility 6/Strengthen 38/Stretch 21; category filter tabs; per-item instructions+sets·hold; screening vocab; 0 console err) |

## Reports & progress

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| REP-01 | Report generation (`/api/reports`) | P | Practitioner + client PDFs generate; branded; screening vocabulary throughout | export blocked until approval (report-approval.spec parity) | PASS — approved→200 report_id+signed_url scoped {practitioner_id}/{assessment_id}; unapproved→403 "must be reviewed and approved before exported"; post-approval UI enables Practitioner PDF + Client Report. PDF byte-content/branding not inspected (binary) |
| REP-02 | Comparison report | P | Two assessments same client compare correctly | two DIFFERENT clients must be impossible (PHI boundary, spec parity); pre/post with unreliable metrics | PASS (PHI boundary server-enforced: cross-client → 400 "must belong to the same client"; same-client → 200 report). pre/post-with-unreliable-metrics edge NOT yet checked |
| PRG-01 | Progress view across assessments | P | 6-month seeded history renders trend correctly; deltas match hand-checked numbers | single-assessment client (no trend); 150-client account load time | PARTIAL — no dedicated progress route; assessment history renders on client detail (per-assessment deviation·grade, chronological) + results compare-PDF dropdown lists same-client priors. Trend-delta hand-check + 150-client load not driven |

## Workouts & player

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| WKT-01 | Mint session (`POST /api/workouts`) | P | Approval-gated launch CTA mints frozen snapshot (workout-mint.spec parity) | unapproved assessment cannot mint (server-enforced, not just UI) | PASS (unapproved → 403 "Approve the assessment before launching a session"; approved → 200 session_id) |
| WKT-02 | `/workouts/[sessionId]` player | P | Hold countdown ring, reps tap-next, rest, summary; voice cues speak alignment cue set 1 / avoid cue set 2+; captions match; wake-lock held | skip fast through items (preload abort, PR #57); SpeechSynthesis unavailable → silent but functional; leave mid-run and resume | PARTIAL — PASS-06 browser automation covers red-flag gating, begin/up-next/play entry, chrome auto-hide, removal from the tab order, keyboard reveal/focus, and 44 px compact controls. Run-state API remains confirmed. Live audio quality, wake-lock, and physical one-thumb use still require CAM-REAL. |
| WKT-03 | Demo canvas three-tier fallback | P | video → poster → gradient, per-slug re-arm; never a broken video element | dead media URL at each tier; slow network first paint | BLOCKED(in-player) — three-tier media fallback only observable inside a live running session → CAM-REAL device pass. Snapshot token resolve confirms per-item media/steps data present |
| WKT-04 | Up-next steps + form cues | P | Steps render on up-next; cues match authored content (coverage-gate test parity) | exercise with 8 steps fits mobile viewport | PARTIAL — authored steps + alignment/avoid cues verified present in token-resolve snapshot (every item has form.alignmentCue/avoidCue + steps[]); live up-next rendering → device pass |
| WKT-05 | Run persistence (`PATCH /api/workouts/[id]/run`) | P | Idempotent; resume restores position | replayed PATCH doesn't double-advance; run on other practitioner's session → 404 | PASS (advance→200; replay same revision→200 `{ok,stale:true}` no double-advance; nonexistent/cross-tenant→404 "Session run not found") |
| WKT-06 | Rate (`POST /api/workouts/[id]/rate`) | P | Rating + notes saved; notes screening-linted | banned term in notes → rejected with message | PASS (banned clinical terms→422 "remove clinical terms"; clean→200; upsert one-per-run) |
| SHR-01 | Share link mint + `/s/[token]` | P, ST, A | Share mints expiring link, raw token shown once with copy; client page is redacted projection (no internal ids) | expired token → uniform 404; revoked → uniform 404; token enumeration (2 garbage tokens) → uniform 404, rate-limited; approved-then-deleted assessment → tombstone 404 | PASS — mint `share:true`→200 share_link; valid resolve→200 REDACTED projection (only clientFirstName+snapshot+expiresAt, zero internal ids); 2 garbage tokens→uniform 404 "not available"; anon-context /s page redacted, NO nav leak (earlier S4 retracted). Expired/revoked/tombstone-404 not driven (uniform-404 path shown) |
| SHR-02 | Token rate (`/api/workouts/token/[token]/rate`) | ST | Client can rate via token; same lint rules | rate after token expiry mid-session | PASS (valid token clarity/pace→200; free-text notes DROPPED on public path per rating.ts allowNotes:false — no injection surface; garbage token→uniform 404). Rate-after-expiry not driven |

## Settings, misc, cross-cutting

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| SET-01 | `/settings` + organization settings | P | Profile + org branding save; branding appears on PDFs | empty org name on PDF; oversized logo upload | PASS (profile save→"Settings saved successfully", practice name persisted, polite aria-live; Org/HIPAA-BAA gate + logo upload present; PDF-branding + oversized-logo not exhaustively tested) |
| MSC-01 | `/`, `/privacy`, `/terms` | A | Root renders the public product page; legal pages render; authenticated app routes remain protected | (expand) | PASS (Iteration 1 redirect behavior was replaced intentionally by the Iteration 2 public product page; /privacy and /terms remain public and render screening-safe copy) |
| MSC-02 | `/dashboard` | P | Correct counts vs seeded data (calculate expected numbers); recent activity accurate | fresh empty account state | FAIL(QA-001) — "Total Clients 30" but should be 28 (counts 2 tombstoned); recent activity ALSO lists tombstoned Carl Smith's assessment. Empty-account PASS (fresh account: 0/0 + "No assessments yet") |
| XC-01 | a11y sweep | all | axe (a11y.spec) has no critical violations on: sign-in, dashboard, wizard, results, player | player contrast during video playback | PARTIAL(device) — PASS-06 full desktop Chromium Axe budget is green across 7 tests, including auth, static, CRUD, consent, wizard, and results surfaces; workout keyboard regression is green. Video-overlay contrast and physical-device audio/player behavior remain manual. |
| XC-02 | Error states | all | Killed API mid-flow → user-facing message, no raw error text leaks (error-states.spec parity) | /api/health DB-down body leaks nothing (PR #50 hardening) | PASS — every error path walked returned a clean user-facing message, never raw error text: 403 (approval/PHI), 404 (uniform "not available"), 422 (zod "Invalid payload"/lint), 409 (tombstone). No stack traces/DB errors leaked |
| XC-03 | Screening vocabulary sweep | all | No banned terms visible anywhere in the seeded UI walk | generated content paths (cues, captions, PDFs) | PASS — screening vocab clean across every walked page (dashboard, results w/ 10 findings+program, muscles, exercises, consent, share, onboarding, legal); disclaimers "screening tool only / not a medical diagnosis / not medical orders" consistent; no diagnos*/treat*/cure*/patient* in UI copy |
| XC-04 | Mobile viewport integrity | all | Every P-page usable at 390×844; touch targets ≥44px on primary actions | player controls reachable one-thumb | PASS — PASS-06 measured identified workout controls at ≥44 px and raised exercise filters and assessment-sheet close controls to the same floor. Marketing, dashboard, and exercises report no horizontal overflow at 320, 375, 414, 768, 1024, or 1440 px. Physical one-thumb reach remains part of CAM-REAL. |

## Retired

(none yet)
