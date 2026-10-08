# QA Bug Log — posture-ai

Append-only. One entry per bug found by `/qa-loop`. Never renumber; never
delete — mark `fixed (PR #N)` / `wontfix (reason, ack)` instead.

Severity: **S1** data-loss / security / crash · **S2** feature broken ·
**S3** degraded but usable · **S4** cosmetic / copy.

Template:

```
## QA-NNN — <one-line title>
severity: S? · status: open · found: PASS-NN · item: <INVENTORY id>
repro (from fresh seed):
  1. …
expected: …
actual: …
evidence: docs/qa/evidence/QA-NNN-*.png · console: … · network: <route status+body>
```

---

## QA-001 — Erased (tombstoned) clients still appear in the clients list and dashboard count
severity: S3 · status: FIXED (branch fix/qa-001-erased-client-read-paths) · found: PASS-01 · item: CLI-01, CLI-05, MSC-02
FIX: added `.is('deleted_at', null)` to the client-list query (app/clients/page.tsx:31), the
dashboard Total-Clients count (app/dashboard/page.tsx:29), and the new-assessment client
picker (app/assessments/new/page.tsx:66); converted the dashboard Recent-Activity query to
`clients!inner(... , deleted_at)` + `.is('clients.deleted_at', null)` so a tombstoned client's
assessment can't surface. Regression test e2e/clients.spec.ts "erased client is hidden from the
clients list" (asserts by id-bearing row href, which survives PII redaction). Verified in the
rebuilt prod bundle: /clients 28 rows (no Beth/Carl), dashboard 28, recent activity clean,
wizard picker 28 — all four read paths. typecheck + 8 clients/deletion e2e green.
root cause: inconsistent soft-delete filtering across client read paths. The clients
list server query (`app/clients/page.tsx:30`) and the dashboard "Total Clients" count
(`app/dashboard/page.tsx:~26`) filter only `.is('archived_at', null)` and OMIT
`.is('deleted_at', null)`. The API route `app/api/clients/route.ts:20-21` correctly
filters BOTH. So an erased client (deleted_at set, the GDPR/BIPA tombstone) remains
listed and counted, contradicting the deletion contract and disagreeing with the API.
repro (from fresh seed, `qa+prac-typical@example.test` / `TestPass1234!`):
  1. Sign in as prac-typical → /dashboard shows "Total Clients 30".
  2. DB truth: 28 active (deleted_at IS NULL) + 2 tombstoned (deleted_at set): Beth Smith, Carl Smith.
  3. Go to /clients — 30 rows render, including "Beth Smith DOB 12/12/1975" and "Carl Smith DOB 9/13/1982" (both tombstoned), each linking to a detail page.
expected: erased clients excluded everywhere — list and dashboard count = 28, matching the API route and the clients list's own `deleted_at`-aware siblings.
actual: list shows 30 (incl. 2 erased); dashboard counts 30. Ghost rows + inflated count + list/dashboard/API disagreement.
evidence: docs/qa/evidence/QA-001-clients-list-tombstoned.png (Beth & Carl visible) · DB: `select count(*) filter (where deleted_at is null)`=28 vs `archived_at is null`=30 · code: clients/page.tsx:30, dashboard/page.tsx count query, api/clients/route.ts:20-21
note: seed tombstones are not PII-redacted, so full names show here; production erasure redacts PII, so prod would show redacted ghost rows — still wrong. Clusters with AUDIT.md Area 4 WEAK (clients/[id]/assessments omits deleted_at). Fix = add `.is('deleted_at', null)` to the read paths (one root-cause branch).
ADDITIONAL read-path leaks found this pass (same root cause, same branch):
  - Dashboard "Recent Activity" lists a tombstoned client's assessment (Carl Smith shown on /dashboard) — assessment/recent-activity query joins clients without `deleted_at` filter.
  - Assessment wizard client picker (`/assessments/new` step 1) lists tombstoned Beth Smith + Carl Smith as selectable — client-select query omits `deleted_at`. (Submit would still be blocked by the `assessments_reject_deleted_client` trigger, so it's a UX/consistency leak, not a data-integrity hole.)
Full fix scope = add `.is('deleted_at', null)` to: clients list (page.tsx:30), dashboard count (dashboard/page.tsx), dashboard recent-activity query, and the wizard client-select query. Audit whether `clients/[id]/assessments` (AUDIT Area 4) needs it too. One branch, one regression test per read path.

## QA-002 — Muscle Guide + all muscle detail pages + results muscle links dead-end in production build
severity: S3 · status: FIXED (PR-07 clinical-content governance) · found: PASS-01 · item: KB-01, RES-02
PR-07 FIX: assessment-only mode now removes clinical knowledge links and the
Muscle Guide navigation at the server boundary, while direct list/detail requests
return 404. An activated release exposes only exact HG-03-approved muscle/link
dependencies, so results cannot create links to an unapproved detail route. The
old per-row `reviewed_at` production switch described below is no longer the
runtime authority.
PASS-05 update: the current branch now renders a truthful "reviewed guide is being
prepared" empty state, resolving the misleading empty-search copy. The results-page
muscle chips still link unconditionally to detail routes that 404 when every entry is
unreviewed, so QA-002 remains open with that reduced scope.
root cause: the reviewed-content gate hides 100% of muscle content in prod because
0 of 29 seeded muscles have `reviewed_at` set. `app/muscles/page.tsx:8` +
`app/muscles/[slug]/page.tsx:6` compute `SHOW_UNREVIEWED = NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT==='1' || NODE_ENV!=='production'`.
In a `next start` (NODE_ENV=production) build the list query filters `.not('reviewed_at','is',null)`
(page.tsx:22) and the detail page calls `notFound()` when `!reviewed_at` (\[slug\]/page.tsx:49).
With 0 reviewed rows: `/muscles` renders an empty library ("No muscles match \"\""),
every `/muscles/[slug]` 404s, and the results page muscle chips
(`app/assessments/[id]/MuscleBodyMap.tsx:164` → `<Link href={`/muscles/${slug}`}>`) all
dead-end at 404. The gate itself is intentional (clinical review before go-live), but the
app degrades ungracefully: a blank guide with a "No muscles match" false-empty message and
live links to 404s, rather than an empty-state explanation + suppressed dead links.
repro (from fresh seed, prod build on :3100, `qa+prac-typical`):
  1. Visit /muscles → "Muscle Guide" header + disclaimer, then "No muscles match \"\"." — zero entries, empty search box.
  2. Visit any /muscles/[slug] (e.g. /muscles/upper-trapezius) → 404 not-found.
  3. Open a results page with implicated muscles → tight/weak muscle chips are clickable Links that 404.
  4. DB truth: `select count(*), count(*) filter (where reviewed_at is not null) from muscles` = 29 total / 0 reviewed.
expected: either (a) muscle content is clinically reviewed before launch (content/governance — set reviewed_at), OR (b) the app degrades gracefully when no reviewed content exists: a real empty-state ("Muscle guides are being finalized") instead of a search "no match" message, and results-page muscle chips render as plain text (not 404 links) when the target isn't reviewable.
actual: empty guide with misleading "No muscles match" copy; 29 dead detail routes; live 404 links from the core results flow.
evidence: docs/qa/evidence/QA-002-muscles-empty-prod.png · code: app/muscles/page.tsx:8,22, app/muscles/[slug]/page.tsx:6,49, app/assessments/[id]/MuscleBodyMap.tsx:164 · DB: muscles 29/0 reviewed
note: this is a launch-readiness + graceful-degradation issue, not a crash. Two-part fix — content review is a product decision (out of code scope); the code-side fix (graceful empty-state + suppress dead muscle links when target unreviewed) is one root-cause branch. Verified library FUNCTIONALITY separately by temporarily marking muscles reviewed on local DB (renders/searches/links correctly), so the components themselves are sound.

## QA-003 — Results-page program comboboxes lack id/name (a11y)
severity: S4 · status: FIXED (branch feat/strength-track) · found: PASS-01 · item: XC-01, RES-04
FIX: added stable, unique `id` and `name` attributes to the client-capability and
per-exercise swap selects, and associated each swap label with its control. The focused
assessment-flow regression failed with 13 anonymous selects before the fix and passed
afterward.
root cause: the assessment results page renders ~13 `<select>` controls (per-focus
CLIENT CAPABILITY + per-exercise SWAP dropdowns) without an `id` or `name` attribute.
Chrome DevTools Issues reports "A form field element should have an id or name attribute
(count: 13)". Screen-reader users get a usable accessible name from surrounding text, but
the missing id/name is a real a11y/autofill hygiene gap and the only console signal on an
otherwise-clean results page.
repro: open any /assessments/[id] results page → DevTools Issues → 1 issue, count 13.
expected: each select has an id and/or name (e.g. `swap-${slug}`, `capability-${focusKey}`).
actual: 13 anonymous form fields; DevTools issue emitted.
evidence: console issue msgid on assessment 97221b37 results page · likely in the RampTable / program-render component (SWAP + capability selects).
note: cosmetic/hygiene — bundle with QA-002 muscle-guide graceful-degradation branch OR its own tiny a11y branch. Add id/name to the select elements + a regression test asserting the results page emits zero DevTools form-field issues.

## QA-004 — CSS-variable alpha suffixes turn assessment highlights black or discard styles
severity: S3 · status: FIXED (branch feat/strength-track) · found: PASS-05 · item: RES-01, RES-02, RES-04
root cause: the design-token migration retained eight-digit-hex suffixes after replacing
hex colors with CSS variables, producing invalid values such as `var(--danger)40` and
`var(--brand)aa`. Chromium resolves the SVG muscle fills to black and discards affected
background, shadow, and disabled-text declarations.
repro: render a results muscle map with one tight and one weak muscle; inspect the computed
ellipse fills. Before the fix both invalid fills resolve to black instead of distinct
semantic colors.
expected: tight, weak, and possible muscle regions retain distinct semantic colors and
every translucent assessment style parses as valid CSS.
actual: muscle regions lose their red/blue distinction and several translucent styles are
silently ignored.
evidence: focused `MuscleBodyMap` regression failed before the fix and passes afterward;
production-code scan finds no direct `var(--token)<hex-alpha>` values. FIX: SVG fills now
use `fillOpacity`; other assessment surfaces use `color-mix(..., transparent)`.

## QA-005 — Motion orchestrator mutates route DOM before Suspense hydration completes
severity: S3 · status: FIXED (branch codex/ui-optimization-loop) · found: PASS-05 · item: WIZ-01
PASS-06 FIX: replaced descendant discovery, observers, class mutation, and inline delay
mutation with one keyed route-level entrance. The full desktop Chromium Axe suite,
including the wizard/results flow, passed; a separate browser sweep reported zero
console errors on the wizard and touched routes.
root cause: `MotionOrchestrator` hydrates in `AppShell` before the nested assessment-wizard
Suspense boundary, then its layout effect adds `motion-reveal` / `motion-visible` classes
and `--motion-delay` styles to still-dehydrated route nodes. React later compares those
nodes with the wizard's unchanged props and reports an attribute mismatch.
repro: run the desktop Chromium assessment golden path and visit
`/assessments/new?testMode=1`; capture browser console errors.
expected: the route hydrates with no React mismatch warning.
actual: React reports that server-rendered attributes do not match, listing the motion
classes and delay styles inserted into wizard descendants.
evidence: `node scripts/run-e2e.mjs e2e/assessment-flow.spec.ts --project=desktop-chromium
--grep 'create client, run fixture assessment' --workers=1`; a temporary regression
listener reproduced the warning reliably. Passive-effect and frame-delay timing changes
were tried locally and rejected because they did not remove the race. A structural fix
must avoid mutating React-owned descendants before their boundary hydrates.

## QA-006 — Assessment results route has no document title
severity: S3 · status: FIXED (branch feat/strength-track) · found: PASS-05 · item: RES-01, XC-01
root cause: the dynamic assessment-results page is a client component and its route had no
server layout metadata, so the rendered document contained no non-empty `<title>`.
repro: complete the fixture assessment flow, then run the Axe serious-impact budget on
the results page.
expected: the results document has a descriptive title for browser and assistive-navigation
context.
actual: Axe reports `document-title` (serious) against the root `html` element.
evidence: the focused accessibility test failed before the fix and passed afterward.
FIX: added route-level server metadata in `app/assessments/[id]/layout.tsx`, producing
`Assessment Results · Posture AI` through the root title template.

## QA-007 — Opacity-hidden workout controls remain keyboard focusable behind player content
severity: S3 · status: FIXED (branch codex/ui-optimization-loop) · found: PASS-06 · item: WKT-02, XC-01
root cause: the workout player hid its progress, voice, caption, exit, and transport chrome
with opacity and pointer-events only. Native keyboard traversal could still focus the
invisible controls, and traversal from the fixed player could reach obscured app-shell
navigation.
repro: begin a workout, choose `Start now`, wait for chrome auto-hide, then press Tab.
expected: hidden chrome is absent from the accessibility/focus order and keyboard intent
reveals the player controls before focus enters them.
actual: controls retained their default tab order while invisible.
evidence: the new workout-player flow fails against the old behavior and passes with
`visibility`, `aria-hidden`, managed `tabIndex`, and pre-traversal reveal/focus. The same
test verifies the three compact chrome controls measure at least 44 × 44 CSS px.

## QA-008 — Global application navigation obscures immersive workout and capture surfaces
severity: S2 · status: FIXED (branch codex/ui-optimization-loop) · found: PASS-07 · item: WKT-02, WIZ-02, XC-04
root cause: `AppShell` rendered its sticky, inline-styled navigation and footer for every
authenticated route, while workout/capture overlays lived inside the animated route
stacking context. Equal/high z-index layers left the global bar over the dedicated flow.
repro: open a workout or enter fullscreen capture; inspect the top controls and content.
expected: the immersive surface owns the viewport and supplies its own local escape.
actual: the Posture AI bar remains visible and overlaps the player/camera UI.
evidence: the new browser assertions fail against the old shell and pass when either
immersive surface is mounted; normal wizard/application routes retain their navigation.
FIX: mark both fullscreen roots with `data-immersive-surface` and let the shell hide its
direct navigation/footer while raising the immersive route layer.

## QA-009 — Workout Exit disappears with optional playback chrome
severity: S2 · status: FIXED (branch codex/ui-optimization-loop) · found: PASS-07 · item: WKT-02, XC-01, XC-04
root cause: Exit shared the same `chromeStyle`, `aria-hidden`, and managed `tabIndex` as
optional progress, caption, mute, and transport controls. The 3.2-second idle timer
therefore removed the only obvious escape from sight and keyboard traversal.
repro: begin a workout, enter playback, then stop moving the pointer for 3.2 seconds.
expected: optional playback chrome may clear, but an explicit Exit stays visible and
keyboard reachable at all times.
actual: the close glyph fades out and becomes `tabindex=-1` until pointer/Tab activity.
evidence: the fail-first playback test reproduces the hidden control; the final mobile
viewport test verifies Exit opacity/visibility/tab order/geometry after secondary chrome
hides, and the live Codex-browser screenshot confirms the labelled control.
FIX: separate a labelled `× Exit` pill from auto-hide style/state while preserving managed
reveal behavior for secondary controls.

## QA-010 — Completed screening results are one long, section-stacked review
severity: S2 · status: FIXED (PR #139; assessment-only release remains fail-closed) · found: PASS-06 · item: RES-01, RES-02, RES-04, XC-01
PASS-07 update: the exact local-only clinical fixture and SQL contract hashes now
match the generated inventory, so the full governance/unit suite passes without
adding a production release or approval. The source-controlled clinical ledger and
production activation variables remain absent. PR #139 may therefore land in the
documented assessment-only mode; licensed-clinician approval is still required
before enabling Program, Exercises, Evidence, workouts, or knowledge links.
root cause: the completed-screening route mounted Summary, Findings, Program, Exercises,
and Evidence as five consecutive sections. The grade was visually subordinate to the
review controls, all 50 exercises were part of the same document, and the section-jump
links looked like navigation without providing tab semantics or containing page length.
repro: open a completed nine-finding fixture assessment at 390 × 844. Before the fix the
full route is 14,874 px tall (17.62 viewports); the practitioner must scroll through the
entire document to understand or relocate findings, program content, and exercises.
expected: grade and finding counts are readable at a glance; Findings is an immediately
visible destination; Program, Exercises, and Evidence are separate tabs; only the selected
panel is mounted; dense finding/exercise detail is collapsed by default.
actual: one 17.62-viewport mobile document with five stacked sections and expanded content.
evidence: `docs/qa/evidence/UI-RESULTS-pass-01-mobile-clinical-before.png`,
`docs/qa/evidence/UI-RESULTS-final-mobile-summary.png`,
`docs/qa/evidence/UI-RESULTS-final-mobile-findings.png`, and
`docs/qa/evidence/UI-RESULTS-final-desktop-summary.png`.
FIX: added one accessible tab system shared by clinical and assessment-only results;
introduced grade-first summary metrics; reduced findings to practitioner-scan rows with
disclosed detail; closed the exercise collection by default; moved accuracy, grade
reference, and screening notice into disclosures; and placed the tabbed canvas before
the action dock on narrow screens. The final mobile summary is 3.22 viewports, findings
is 3.85, desktop summary is 1.56, all five tabs are visible at 375 px, and there is no
horizontal overflow.
approval boundary: `ClinicalAssessmentResults.tsx` is deliberately included in the
governed recommendation-engine inventory. Regenerating the inventory changes its algorithm
and inventory hashes, so production release literals and human-reviewed activation cannot
be updated as part of this UI loop. The branch must not land in production while the
governance suite fails closed; a new clinical review/activation cycle must approve the
generated inventory first.
PASS-07 clarification: the literals updated by this branch are explicitly labeled
local/test-only fixtures and are not HG-03 evidence. Production activation remains
separate and unmodified.

## QA-011 — Recorded-score disclosure blocks interaction under CPU slowdown
severity: S2 · status: FIXED (PR #144) · found: PASS-08 · item: PRG-01, XC-04
root cause: opening the native disclosure synchronously mounted and painted the full
recorded-score table on the long client page. Official failure p95 was 304 ms.
FIX: present the disclosure immediately, defer table mount for 300 ms, and retain it
after first mount. The focused 4× CPU Chromium probe measured p95 64 ms.

## QA-012 — Hidden/unmounted camera can continue a stale permission preflight
severity: S2 · status: FIXED (consolidated branch) · found: PASS-08 · item: CAM-REAL, WIZ-02
root cause: the request generation was established after awaiting Permissions API state.
FIX: establish generation before the await and reject hidden, unmounted, or superseded
work before changing permission state or calling `getUserMedia`.

## QA-013 — WebKit worker fallback breaks Chromium worker startup
severity: S2 · status: FIXED (consolidated branch) · found: PASS-08 · item: CAM-REAL, WIZ-02
root cause: a module WASM loader was selected even when Turbopack emitted a classic worker.
FIX: retain the Chromium classic fileset, install the supported import hook only for the
WebKit-shaped scope, and require a valid landmarker before emitting ready.

## QA-014 — Health reports ready while required directory RPCs are absent
severity: S2 · status: FIXED (consolidated branch) · found: PASS-08 · item: XC-02, MSC-02
root cause: readiness probed current tables and columns but not three required RPC
signatures. FIX: row-free probes now classify missing PostgREST/Postgres functions as
`pending_migration`.

## QA-015 — Workout progress saves fail invisibly and can commit out of order
severity: S2 · status: FIXED (consolidated branch) · found: PASS-08 · item: WKT-05
root cause: fire-and-forget client writes advanced the local watermark before
acknowledgement, while the server's revision read/update was not atomic.
FIX: practitioner-scoped CAS plus one acknowledged retrying client queue with conflict
rebase, visible unsaved state, and manual retry. Abrupt process termination before the
latest acknowledgement remains a documented memory-queue limit.

## QA-016 — Public bearer-token rate limits fail open and global script CSP is permissive
severity: S3 · status: FIXED (consolidated branch) · found: PASS-08 · item: CON-03, SHR-01, SHR-02, XC-02
root cause: three anonymous token routes used the availability-oriented limiter, while
production CSP allowed inline/eval scripts. FIX: those routes use strict denial before
token work; nonce/strict-dynamic CSP removes script inline/eval allowances in production,
adds `object-src 'none'`, and preserves only the MediaPipe WASM exception.

## QA-017 — Failed logo metadata persistence can orphan storage objects
severity: S3 · status: FIXED (consolidated branch) · found: PASS-08 · item: SET-01
root cause: upload completed before practitioner metadata update and had no compensation.
FIX: unique user-prefixed objects, compensating delete on metadata failure, and scoped
cleanup of the prior object after success.

## QA-018 — Legacy reads and dashboard averages can truncate at the API row cap
severity: S3 · status: FIXED (consolidated branch) · found: PASS-08 · item: CLI-01, PRG-01, MSC-02
root cause: compatibility requests omitted limits and the dashboard averaged a single
unbounded response. FIX: no-limit compatibility calls fail before DB access; dashboard
scores use deterministic 500-row pages and fail visibly on any partial-page error.

## QA-019 — Named route-file exports break the optional webpack production build
severity: S3 · status: FIXED (consolidated branch) · found: PASS-08 · item: XC-02
root cause: tests imported named helpers from Next Page modules. FIX: implementations and
helpers moved to non-route modules. Turbopack and webpack production builds both pass.

## QA-020 — Genu varum/valgum share direction-specific muscle and program links
severity: S2 · status: APPROVAL REQUIRED · found: PASS-08 · item: RES-02, RES-04
root cause: the reserved `direction_applicability` field is unpopulated and render/program
paths do not gate links by finding direction. Correcting this requires a governed
schema/content migration, regenerated hashes, and the existing clinician-review boundary.
PR #157 removed the clinical-content gate, so the defect is visible to practitioners;
`/api/health` reports `clinical_content: active, reason: clinical_content_gate_removed`.
On an approved prac-typical result from a fresh seed, the "Knee Alignment (Left)" Why sheet lists
Hip Adductors (tight, knock-knee rationale) and TFL & IT Band (tight, bow-knee rationale) together;
`GET /api/clinical-content/findings/genu_varum_valgum_left/muscles` returns all four muscles and every
`muscle_imbalance_links.direction_applicability` value for genu keys is NULL. Status remains APPROVAL REQUIRED (S2).
evidence: docs/qa/evidence/QA-020-PASS09-knee-sheet-both-directions.png

## QA-021 — Password reset dead-ends for every MFA-enrolled account
severity: S2 · status: open · found: PASS-09 · item: AUTH-07, XC-02
repro (from fresh seed; :3101 = same production build with POSTURE_TEST_MODE_ENABLED=1 for fixture legal text):
  1. Use any practitioner that has completed MFA (all seeded/invited accounts do), e.g. a freshly invited and activated practitioner.
  2. In one browser, open /auth/forgot-password, submit the account email.
  3. Open the "Reset your Posture AI password" email in local Mailpit (127.0.0.1:55324) and follow its /auth/confirm?token_hash=…&type=recovery link (host rewritten to the app origin) in the same browser.
  4. /auth/update-password shows the form. Enter the same new password twice and press "Update password".
expected: password changes, then the app sends the user to MFA (`/auth/mfa?mode=recovery`), per AUTH-07 AC1 and the page's own flow.
actual: the form stays open with the raw Auth error "AAL2 session is required to update email or password when MFA is enabled."; the password is not changed. A recovery session is AAL1, and `supabase.auth.updateUser` runs before any MFA challenge, so no MFA-enrolled user can complete a reset. The raw provider message also breaches XC-02 AC1.
evidence: docs/qa/evidence/QA-021-recovery-aal2-error.png · network: supabase.auth.updateUser error "AAL2 session is required…" · results: docs/qa/evidence/PASS-09/recovery.json

## QA-022 — Capture endpoint accepts archived clients
severity: S2 · status: open · found: PASS-09 · item: WIZ-04
repro (from fresh seed, prac-typical session):
  1. POST /api/clients with an adult DOB, in-person consent (signer_name, signer_relationship=self, current subject_consent legal document fields).
  2. PATCH /api/clients/<id> {"archived_at": "<now ISO>"} → 200; GET /api/clients/<id> now returns 404 and the client is gone from /clients.
  3. POST /api/assessments {"client_id": "<id>", "submission_id": "<uuid>", "test_mode": true}.
expected: HTTP 404 and no assessment or capture row (WIZ-04 E1, AC3).
actual: HTTP 200 with `status=complete`; one `assessments` row is created for the archived client (rows 0→1). Root cause matches the inventory note: the route and prototype transaction filter `deleted_at` but not `archived_at`.
evidence: docs/qa/evidence/PASS-09/archived.json (freshly created client and assessment IDs are in the response)

## QA-023 — Share-token mint accepts archived clients and the public link resolves
severity: S2 · status: open · found: PASS-09 · item: SHR-05, WKT-07
repro (from fresh seed, prac-typical session):
  1. Create a consented adult client (as QA-022 step 1), POST /api/assessments (test_mode), and take the assessment ID from that response; PATCH /api/assessments/<aid>/approve {"approved": true}.
  2. PATCH /api/clients/<cid> {"archived_at": "<now ISO>"}.
  3. POST /api/workouts {"assessment_id": "<aid>", "share": true}.
  4. Open the returned /s/<token> anonymously.
expected: denial with no share link and no token-bearing `workout_sessions` row (SHR-05 AC3/E1).
actual: HTTP 200 with `share_link`; one token-bearing session row; GET /api/workouts/token/<token> returns 200 and /s/<token> renders the archived client's first name and workout. The archived client's session also lists in the practitioner /workouts library.
evidence: docs/qa/evidence/QA-023-archived-client-share-page.png · docs/qa/evidence/PASS-09/archived.json

## QA-024 — Client DOB validation: malformed dates return HTTP 500, future dates are saved
severity: S3 · status: open · found: PASS-09 · item: CLI-02, CLI-04
repro (from fresh seed, prac-typical):
  1. Create a client from a fresh seed, take its ID from POST /api/clients, then PATCH /api/clients/<id> {"date_of_birth": "2999-99-99"} (also "not-a-date", "1990-02-30").
  2. POST /api/clients {"first_name":"Inv","last_name":"Dob","date_of_birth":"2999-99-99","consent_mode":"remote"}.
  3. In the UI, /clients/new: enter names, Date of Birth 2099-01-01, sign consent, press "Create Client".
expected: HTTP 400 with a field error and no write; the UI shows a DOB field error and creates no row (CLI-02 E3, CLI-04 E2).
actual: steps 1–2 return HTTP 500 {"error":"Failed to update client."} / {"error":"Failed to create client."}; PATCH {"date_of_birth":"2999-01-01"} returns 200 and stores it; step 3 creates the client (redirects to its detail page). A future DOB is later treated as "under 13" by the capture gate, so it fails safe, but the record is wrong.
evidence: docs/qa/evidence/QA-024-future-dob-created.png · docs/qa/evidence/PASS-09/api.json

## QA-025 — Production CSP blocks a nonce-less script chunk on practitioner pages
severity: S3 · status: open · found: PASS-09 · item: XC-02, MSC-02, CLI-01
repro (from fresh seed): sign in as prac-typical (phone or desktop), open /dashboard, /clients, /clients/new, /clients/<id> or /clients/<id>/edit and read the console.
expected: no CSP violations (QA-016 nonce + strict-dynamic policy).
actual: every load logs "Loading the script '/_next/static/chunks/1m2lg5781dfuu.js' violates … script-src 'self' 'nonce-…' 'strict-dynamic' …. The action has been blocked." The blocked element is `<script src="/_next/static/chunks/1m2lg5781dfuu.js" async>` hoisted into <head> without a nonce (chunk holds the Surface CSS-module map). Pages still render in this pass, but a blocked chunk is a latent hydration/styling failure and noise on every practitioner page.
evidence: docs/qa/evidence/QA-025-dashboard.png · docs/qa/evidence/PASS-09/matrix-signed.log (errs column)

## QA-026 — Posture map stays on "Loading your posture map…" when WebGL is unavailable
severity: S3 · status: open · found: PASS-09 · item: RES-02
repro (from fresh seed): launch Chromium with --disable-webgl --disable-3d-apis, sign in as prac-typical, open an owned approved result via /clients/<id> assessment history, and wait 30 s.
expected: the model area shows an unavailable message; finding text stays usable (RES-02 AC2/E1).
actual: the region still reads "Loading your posture map…" after 30 s; its controls stay disabled. Console: "THREE.WebGLRenderer: Error creating WebGL context." (uncaught in the viewer iframe). Findings list stays visible.
evidence: docs/qa/evidence/QA-026-no-webgl-map-loading.png

## QA-027 — Results header clips and overlaps at 320 px with 200% text
severity: S3 · status: open · found: PASS-09 · item: XC-04, V4-TOPBAR
repro (from fresh seed): prac-typical, viewport 320×700, open an owned approved result via /clients/<id> assessment history, then set root font-size to 200%.
expected: title and controls stay inside the viewport without overlap (XC-04 E1, V4-TOPBAR E3).
actual: "Camera level not verified" badge runs off the right edge, "Why?" overlaps the "DEVIATION SCORE" label, the "Monitor" zone label and "Launch session" are cut off. (Chip rows on /clients and the findings table scroll horizontally by design and were not counted.)
evidence: docs/qa/evidence/QA-027-results-header-320-200pct.png

## QA-028 — Enlarged capture photo intermittently never finishes loading
severity: S3 · status: open · found: PASS-09 · item: RES-03 (carry-over item 2)
repro (fresh seed, :3101 production build): `E2E_PORT=3101 npm run test:e2e -- capture-images.spec.ts --project=desktop-chromium --workers=1 --retries=0 --repeat-each=4`.
expected: the "front capture photo" dialog image loads at 390 px and 1280 px.
actual: in run 2, dialog <img> never reached complete && naturalWidth > 0 within 5 s although the page's GET /api/captures/<id>/image returned 200 in 503 ms. Runs 3–4 loaded the image.
evidence: docs/qa/evidence/QA-028-trace-network.txt · docs/qa/evidence/PASS-09/e2e-batch4.txt

## QA-029 — Foreign, archived and missing record pages answer HTTP 200 instead of 404
severity: S3 · status: open · found: PASS-09 · item: CLI-03, RES-01, WKT-10
repro (from fresh seed): as prac-typical request a prac-heavy client's ID (get it from the heavy account's /clients list), a newly erased client's ID (save the ID before DELETE), and a newly archived client's ID; as prac-heavy request a prac-typical assessment ID from that account's /clients/<id> history; as athlete request /workouts/manual/00000000-0000-4000-8000-000000000000.
expected: HTTP 404 with no record fields (CLI-03 E1/E2, RES-01 E1, WKT-10 E1–E3).
actual: no record data leaks, but the client pages redirect to /clients (final 200), the assessment page returns 200 with "Assessment not found.", and the routine page returns 200 "Routine unavailable · Routine was not found" with a Retry button. Workout sessions already return 404, so behaviour is inconsistent.
evidence: docs/qa/evidence/QA-029-foreign-assessment-200.png · docs/qa/evidence/PASS-09/matrix-signed.log

## QA-030 — /onboarding re-shows the agreement after acceptance
severity: S4 · status: open · found: PASS-09 · item: AUTH-06
repro (from fresh seed): invite + activate a new practitioner (issue_practitioner_invitation_with_state, MFA), sign in, accept all three documents (lands on /dashboard), then open /onboarding.
expected: a completion state or redirect to /dashboard (AUTH-06 AC2).
actual: "Review and accept the legal terms · Step 1 of 3" renders again with an active "I agree" button.
evidence: docs/qa/evidence/QA-030-onboarding-revisit.png

## QA-031 — Raw browser/runtime error strings shown to users
severity: S3 · status: open · found: PASS-09 · item: XC-02
repro (from fresh seed): (a) /assessments/new?testMode=1, pick a consented client, abort the POST /api/assessments response (offline) and press "Run Test Analysis"; (b) /clients/<id>/edit, go offline, press Save; (c) open capture while /mediapipe/wasm assets fail to load.
expected: plain retry/unavailable copy, no raw error text (XC-02 AC1).
actual: (a) "Screening needs attention · Failed to fetch · Try Again"; (b) alert "Failed to fetch"; (c) pose readiness reads "Pose model could not start on GPU or CPU. GPU: [object Event] CPU: [object Event]". (The consent page already shows "Network error — please try again.") Retry itself works and does not duplicate the assessment.
evidence: docs/qa/evidence/QA-031-failed-to-fetch.png · docs/qa/evidence/PASS-09/e2e-batch1.txt (scan-recovery failure text)

## QA-032 — Zero-scan client offers an enabled Compare action
severity: S4 · status: open · found: PASS-09 · item: REP-02
repro (from fresh seed): prac-typical → find an owned zero-scan client in /clients (the fresh seed includes declined or pending-consent clients) → "Compare" in the action group.
expected: Compare absent, or disabled with a reason (REP-02 E3).
actual: an enabled link to #client-workspace; activating it only scrolls the page, with no explanation.
evidence: docs/qa/evidence/QA-032-compare-zero-scans.png

## QA-033 — Practitioner call to athlete erasure returns 404 instead of 403
severity: S4 · status: open · found: PASS-09 · item: TRN-02
repro (from fresh seed): prac-typical session → POST /api/training/privacy/erase {"requestId":"<uuid>"}.
expected: HTTP 403, nothing erased (TRN-02 E1).
actual: HTTP 404 {"error":"training_subject_not_found"}; nothing erased (safe, wrong contract).
evidence: docs/qa/evidence/PASS-09/api.json

## QA-034 — Focus lands on <main>, not the page heading, after navigation
severity: S4 · status: open · found: PASS-09 · item: XC-01
repro (from fresh seed): prac-typical phone → /dashboard → activate the "Clients" dock link; read document.activeElement.
expected: focus moves to the new page heading (XC-01 AC2).
actual: activeElement is <main id="main">; the h1 "Clients" is not focused. (Sheets do move focus inside and return it to the trigger.)
evidence: docs/qa/evidence/PASS-09/misc.json

## QA-035 — Success toast renders under the open sheet scrim, over the page title
severity: S4 · status: open · found: PASS-09 · item: V4-TOAST
repro (from fresh seed): prac-typical phone → /settings → Practice info → change Practice name → Save changes.
expected: the Island toast is legible above other layers (V4-TOAST AC1).
actual: "Settings saved successfully" draws behind the dimmed scrim and over the large "Profile" title, so it is hard to read; the sheet stays open.
evidence: docs/qa/evidence/QA-035-toast-under-sheet.png

## QA-036 — Public share exposes the client's first name
severity: S3 · status: open · found: PASS-09 · item: SHR-01
repro (from fresh seed): as prac-typical, create a consented adult client and approved assessment, mint a share link from that assessment, then open `/s/<token>` without a session and GET `/api/workouts/token/<token>`.
expected: neither the public page nor token JSON contains the client's legal name (SHR-01 AC2).
actual: the JSON includes `clientFirstName`; the public page shows "<first name>’s session" and the player greets the client by first name. `lib/workout/tokenProjection.ts` deliberately copies `client_first_name` into the public projection. Devin must decide whether a first name is acceptable under AC2; until then SHR-01 fails its written criterion.
evidence: docs/qa/evidence/QA-023-archived-client-share-page.png · `lib/workout/tokenProjection.ts` · `app/s/[token]/ShareTokenClient.tsx`

## QA-037 — One-photo client erasure exceeds 30 seconds
severity: S3 · status: open · found: PASS-09 · item: CLI-06
repro (fresh seed, :3101 production build): `E2E_PORT=3101 npm run test:e2e -- capture-images.spec.ts --project=desktop-chromium --workers=1 --retries=0 --repeat-each=4`; follow the one-photo client created by the spec and time its DELETE `/api/clients/<id>`.
expected: erasure returns a complete or pending receipt promptly, with storage cleanup reflected by that receipt (CLI-06 AC3/E3).
actual: run 1 timed out after more than 30 s on DELETE for a client with one stored photo. The request outcome and later receipt transition were not established by that run. The image-load symptom in run 2 remains QA-028.
evidence: docs/qa/evidence/PASS-09/e2e-batch4.txt · docs/qa/evidence/QA-028-trace-network.txt

## QA-038 — In-person grant leaves an earlier remote consent link live
severity: S3 · status: open · found: PASS-09 · item: CON-01, CON-03
repro (fresh seed, :3101 fixture-legal build): create an active client, POST `/api/consent/link` and retain its `/consent/<token>` URL; POST a valid in-person grant to `/api/consent` for the same client; open the earlier public link and submit a second valid affirmative response.
expected: the earlier link becomes unavailable after the in-person grant and cannot add another consent event.
actual (source-confirmed; browser rerun pending): the in-person RPC inserts an enrollment and stamps the client but does not consume or delete `consent_tokens`. The public page checks only token use, expiry and pinned legal text. The remote RPC can consume the still-live token and insert a second enrollment; `getConsentStatus` reads the latest event, so the second grant becomes current. There is no separate decline action on the remote page; a later decline recorded as a withdrawal through `withdraw_client_consent` deletes outstanding tokens and records a revocation, preventing that link from granting consent afterward. This is a stale-link lifecycle defect; the remote submission still requires an affirmative signature and governed legal evidence.
evidence: `supabase/migrations/20260720000000_legal_document_provenance.sql` (`record_inperson_consent_governed`, `record_remote_consent_governed`) · `supabase/migrations/20260720010000_privacy_lifecycle.sql` (`withdraw_client_consent`) · `app/consent/[token]/page.tsx`
