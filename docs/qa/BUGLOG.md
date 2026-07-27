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
