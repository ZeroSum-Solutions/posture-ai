# Array redesign — migration tracker

Replaces the v1 "Posture AI Dark" design system with "Array" (see `/DESIGN.md` v2).
Source of truth for the visual target: the design handoff bundle
(`design_handoff_array_redesign/`), whose eight screens are high-fidelity and
whose `DESIGN.md` is the new contract.

**This branch is not deployable until every route below is migrated.** `globals.css`
was replaced wholesale in the first checkpoint, so any route still referencing a v1
utility class renders unstyled. Checkpoints are internal recovery points.

## Checkpoints

| # | Scope | State |
|---|-------|-------|
| 1 | Tokens, primitives, island nav, Today | done |
| 2 | Clients list + `list_owned_clients_page` RPC migration | done |
| 3 | Client detail (dropped `recharts`) | done |
| 4 | Review — Findings + Evidence + Program, 3 tabs | done |
| 5 | Exercise library (establishes the session-builder contract) | done |
| 6 | Workout player (consumes that contract) | done |
| 7 | Capture — characterization tests first, presentation only | done |
| 8 | Repository-wide v1 purge | done |
| 9 | External audit (Kimi K3) + applied findings | done |

Checkpoints 5, 6 and 8 landed together in `988e383`; 7 in `d90e4f4`. The purge is
verified two ways rather than by inspection: no source file references any of the
nine deleted v1 Tailwind tokens (`--color-surface{,-elevated,-strong}`,
`--color-border{,-strong}`, `--color-brand`, `--color-danger`, `--color-warning`,
`--radius-control`), and every `var(--x)` referenced anywhere under `app/`,
`components/` or `lib/` resolves against a CSS file — the sole exception being
`--font-ui`, which `next/font` injects onto `<html>` at runtime and which
`globals.css` already reads through a `'Roboto'` fallback.

Capture is last because it is safety-sensitive, not because it is optional: camera
lifecycle, pose-worker messaging, shutter gating and sensor-roll thresholds are
locked by characterization tests **before** any restyle, and that checkpoint carries
no cleanup or dependency removal so a regression stays attributable.

## Designed screens → repo files

1. Today → `app/dashboard/` — **done**
2. Clients → `app/clients/page.tsx`, `app/api/clients/route.ts`, RPC — **done**
3. Capture → `app/assessments/new/FullScreenCapture.tsx`, `LiveGuides.tsx`
4. Review · Findings → `app/assessments/[id]/`
5. Review · Evidence → same route, Evidence tab
6. Client detail → `app/clients/[id]/` — **done**
7. Exercise library → `app/exercises/`
8. Workout player → `app/workouts/_player/`

## Surfaces the handoff does not draw

These carry no designed screen but reference v1 tokens or classes, so they must be
re-expressed in Array tokens or they ship broken. Grouped by how much judgement each
needs; none may keep a v1 token.

**Forms and flows** (Array form tokens + pill actions, no new layout invention)
`app/auth/*` and `components/AuthFrame.tsx` are **done** — they were the login path,
and on this branch their deleted v1 tokens rendered the sign-in and MFA screens
unstyled, which reads as "two-factor is locking me out" rather than as a CSS fault.
`globals.css` now carries the shared field vocabulary (`.a-form`, `.a-field`,
`.a-input`, `.a-help`, `.a-error`) that the rest of this group should use.
Remaining: `app/clients/ClientForm.tsx`, `app/clients/new/`, `app/clients/[id]/edit/`,
`app/onboarding/`, `app/settings/`,
`components/InPersonConsentForm.tsx`, `components/ConsentResponder.tsx`,
`components/RemoteConsentButton.tsx`, `components/PrivacyLifecycleControls.tsx`

**Documents** (prose surfaces; body never above 14px)
`app/privacy/`, `app/terms/`, `components/LegalDocumentView.tsx`,
`components/LegalNotice.tsx`, `app/s/[token]/`, `app/consent/[token]/`

**Utility states**
`app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx`, `app/_components/ConfirmDialog.tsx`,
`app/_components/RouteSkeleton.tsx`, every `loading.tsx`

**Adjacent libraries** (same row/tile vocabulary as Clients)
`app/muscles/`, `app/assessments/[id]/ExerciseDetailSheet.tsx`, `WhyThisSheet.tsx`,
`PriorityProgram.tsx`, `MuscleBodyMap.tsx`, `MuscleModel3D.tsx`

**Marketing** — `app/_components/marketing/` keeps its own composition but must stop
importing v1 tokens.

## Verification harness

`scripts/testing/array-visual/` captures each migrated screen on an iPhone 14 viewport
into `docs/screenshots/array/`. Set `ARRAY_VISUAL_CLIENT_ID` to a seeded client with
several completed scans so client detail captures a real trend rather than one dot. It asserts nothing — it exists so the build can be
graded against the handoff. **Delete the whole directory when the redesign lands.**

It lives outside `e2e/` on purpose: that directory's spec list feeds the
production-readiness gate, which compares a live `playwright --list` against a signed
inventory, so scaffolding placed there fails the release check (`E2E_SOURCE_DRIFT`).
It is also excluded in `vitest.config.ts`, since a Playwright spec cannot run under vitest.

Running it:

```bash
npx supabase start && npm run qa:seed
npx playwright test --project=setup                      # mints an AAL2 practitioner
npx playwright test --config scripts/testing/array-visual/playwright.config.ts
```

The seeded QA practitioners and the e2e practitioner are different accounts, so the
seeded fixtures have to be re-pointed at the e2e practitioner id for the screens to
show populated data.

## RELEASE BLOCKER — clinical content re-review required

The Array redesign rewrote `app/layout.tsx` and `components/AppShell.tsx`, both of
which are in `lib/clinical-content/inventory.ts`'s `algorithmSourcePaths` because they
carry the `clinicalContentEnabled` gating flag down to `NavBar`/`IslandNav`. This
changes `inventory_sha256` and invalidates the currently-approved
`clinical_content_releases` row. Clinical content (recommendations, programs, workouts,
knowledge links) will render as disabled (`database_activation_mismatch`) in any
environment until a licensed clinician reviews the regenerated inventory and a new
approved release row is added with the updated hash. **This branch must not go to an
environment with clinical content live until that re-approval lands.**

The local QA bindings were regenerated to match (`supabase/seed.sql`,
`supabase/tests/*.sql`, `docs/qa/clinical-content-governance.md`) so the local stack
still activates; that is a development fixture, not an approval.

`app/assessments/[id]/reviewModel.ts` is a new provenance candidate: it derives the
on-screen grade band, the finding zone labels, and every directional claim on the
review screen. Add it to `algorithmSourcePaths` at the purge checkpoint, in the same
single edit as the change below — not before, so there is one final hash.

At the v1-purge checkpoint, `components/NavBar.tsx` must be replaced in the provenance
list by `components/array/IslandNav.tsx` and `components/array/islandPolicy.ts` — the
files that inherited the gating logic — requiring a further regeneration and re-review
pass. Do **not** add `AmbientField.tsx` or `Surface.tsx`: neither touches the gating
path, and the list should cover exactly the shell files that participate in the
`clinicalContentEnabled` decision, not "shell files" as a category.

Deleting `NavBar.tsx` without editing `algorithmSourcePaths` first will make
`readFileSync` throw and break the inventory build outright.

## Deploy authority — ruled 2026-08-04

Standing delegation: permission calls go to Fable 5 in the owner's place.

- **Preview deployments of this branch are allowed.** `serverClinicalContentAccess()`
  calls `verifyClinicalContentAccess()` on every request regardless of `VERCEL_ENV`,
  so an unapproved `inventory_sha256` disables clinical content automatically —
  preview cannot leak unreviewed clinical content. Conditions: keep Vercel
  Deployment Protection on, do not share the URL while surfaces are unstyled, and
  never set `POSTURE_TEST_MODE_ENABLED` / `NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT` on
  preview — that pair is the one path that would render unreviewed content.
  `vercel.json` crons are Production-only, so the privacy-maintenance cron is not a
  preview concern.
- **Merge and Production are held.** "Deploy" is the terminal step of the checkpoint
  chain, not the next action.
- **One inventory regeneration, one review.** The v1-purge regeneration must land
  *before* the clinician is asked to review. Reviewing hash #1 now and hash #2 after
  the purge spends the clinician's attention twice, invites a rubber stamp on the
  second pass, and would leave an approved row pointing at `NavBar.tsx` — a file
  already scheduled for deletion.

Ordered gates before Production:

1. ~~Migrate the remaining screens and the undesigned surfaces below.~~ **done**
2. ~~Complete the v1-purge checkpoint.~~ **done**
3. ~~Regenerate `content/clinical-content-inventory.json` once, post-purge.~~ **done** (`034a56c`)
4. Send the clinician that single final hash. **← next action, needs the owner**
5. On approval, add the `clinical_content_releases` row so the RPC matches.
6. ~~Re-run the full test, type and lint suite.~~ **done** — 2113/2113 vitest,
   `tsc --noEmit` clean, eslint 0 errors / 21 pre-existing warnings, `next build` clean.
7. Refresh preview; confirm clinical content *activates* (not merely fails safe)
   and every screen renders styled. **Partially done** — preview is up and every
   screen renders styled; clinical content still reads `database_activation_mismatch`
   by design, and can only *activate* once gate 5 lands.
8. Merge to the default branch. **held**
9. Promote to Production; confirm the cron and the clinical gate behave identically. **held**

### The hash to send the clinician (gate 4)

```
inventory_sha256                 72d3140f7edb59211c9261383bd6faeff7c1eae4b767448b043129aa2ecba12d
algorithm:recommendation-engine  d39b84842febd3fbc0324cdd1971f1fd2fcd700eb208d38a20064458a46eb629
```

Reviewing this is narrower than it looks, and that is a checkable claim rather
than a reassurance. Diffing the regenerated inventory against the pre-redesign
baseline shows **exactly one item hash moved**: `algorithm:recommendation-engine`,
which digests the governed source files. All 29 muscles, 73 exercises, 46 links,
119 exercise-muscle rows, 1 contraindication and 12 report-copy entries are
byte-identical. No authored clinical content changed; what changed is the
presentation layer inside files the provenance list happens to govern.

Reproduce with:

```bash
npx vite-node --config vitest.config.ts scripts/generate-clinical-content-inventory.ts
git show 71245b0~1:content/clinical-content-inventory.json > /tmp/baseline.json
```

### Preview

`https://posture-1jq73njtn-devin-wiggins-projects.vercel.app` — Vercel Preview on
project `posture-ai`, behind Deployment Protection (unauthenticated requests 302
to `vercel.com/sso-api`, verified). `POSTURE_TEST_MODE_ENABLED` and
`NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT` are unset, so the one path that would render
unreviewed clinical content is closed.

**Stray project — needs cleanup.** A first deploy attempt ran from this worktree,
which carries no `.vercel/` of its own, so the CLI created a *second* Vercel project
called `posture-ai-array` and treated the deploy as its production. It is behind the
team's Deployment Protection (verified 302 to SSO) and was never given environment
variables, so it cannot reach Supabase and holds no data — but it should be deleted,
and worktrees should be linked before deploying from them.

## Production schema is nine migrations behind (found 2026-08-04)

Not caused by this branch. The cloud ledger for `dhrkezfypzutiwtmcmof` stops at
`20260712000000_per_side_observations`; the local chain has nine files after it.
Verified directly against the live schema, not inferred from the ledger.

Consequences on production today, independent of the redesign: the clients
directory and the client-detail server seed cannot resolve their RPCs, the clinical
content gate fails closed, the privacy lifecycle has no tables, and consent legal
state cannot be evaluated. The code fails closed rather than showing wrong data, so
this presents as features being unavailable, not as incorrect clinical output.

### The redesign needs three of the nine, and none of the gated ones

Corrects an earlier reading of this gap, which assumed the whole chain had to land
before `20260803000000_client_directory_trend.sql` could. It does not.
`20260803000000` hard-depends only on `20260722011000_owned_client_search`, which
creates the `list_owned_clients_page` it drops and recreates, plus a soft
(performance-only) dependency on `20260722010000_bounded_history_indexes`. Neither
gated migration appears anywhere in that dependency graph.

Safe subset, verified against the live schema before applying — baseline
`clients.deleted_at` and `assessments.practitioner_approved` present, no marker
column/type from any skipped migration present, target functions and indexes absent,
`clients`=12 / `assessments`=11 rows so index locks are negligible:

1. `20260722010000_bounded_history_indexes` — two partial indexes
2. `20260722011000_owned_client_search` — `current_keyset_snapshot`, 5-arg page fn
3. `20260803000000_client_directory_trend` — 6-arg page fn, summary, longest-since-scan

All additive: indexes and functions only, no existing row read or written, all
`SECURITY INVOKER` with `SET search_path = ''` and explicit `REVOKE`/`GRANT`.
Record these three versions in `supabase_migrations.schema_migrations` so the CLI
reconciles; leave the other six showing as pending, because they are.

### Why the other six stay unapplied

Two are gated, and `docs/RUNBOOK.md` reserves them for the counsel/product and
licensed-clinician releases:

- `20260720000000_legal_document_provenance` — HG-02. Its DDL *is* inert: the latch
  row is inserted with `activated_at` NULL and the rejection trigger no-ops until
  `activate_legal_governance()` is called. Inert is not the same as in scope.
- `20260720020000_clinical_content_governance` — HG-03, and **not inert on apply**.
  Applying the DDL alone immediately privatizes the `exercise-media` storage bucket,
  revokes anon/authenticated read on the exercise, muscle and imbalance tables, and
  stubs `finalize_report_upload` / `create_workout_session_governed`. No data step
  needed for any of that.

Two more are dangerous for reasons that have nothing to do with regulation, and are
the stronger argument against a blind catch-up:

- `20260719020000_practitioner_admission` — backfills **every existing practitioner**
  to `access_status = 'review_required'` and then sets the column NOT NULL. On the
  current six accounts that is a full lockout until each is re-admitted.
- `20260720010000_privacy_lifecycle` — **irreversibly** nulls the free-text
  `clients.deletion_reason`, `client_deletion_log.reason` and
  `workout_share_events.actor` columns on every existing row, replacing them with
  coarse codes. The original text is not recoverable afterwards.

A full catch-up therefore needs an admission plan for the existing accounts and a
decision to accept that text loss. Neither belongs to a UI change.

Correction to an earlier note in this file: there is no `erasure_requests` table
anywhere in the codebase. The erasure machinery is `client_deletion_log` and
`privacy_storage_deletion_outbox`, both from `20260720010000_privacy_lifecycle`.

Recorded risk: one Supabase project serves production, preview and dev, so every
branch preview is a live client against real clinical records with no isolation.
A dedicated preview project would stop this being a per-PR judgement call.

Recorded risk: Vercel Deployment Protection is set to `all_except_custom_domains`
and the project has no custom domain, so every URL — production included — sits
behind a Vercel account login. A reviewer without Vercel access sees `vercel.com/login`
and never reaches the app, which reads as an app auth bug and is not one.

## Known conflicts and gaps

- **Grade B changes band.** `/DESIGN.md` v2 puts A and B under Maintain. v1
  `lib/scoring/grade-display.ts` maps B to `warning`, and that module still owns the
  **PDF report** palette (`GRADE_TONE_HEX_COLORS`). On-screen band colour now follows
  the contract; the PDF has not been changed. Decide whether the report should follow,
  because a grade B currently reads amber on paper and emerald on screen.
- **No scheduling exists.** The design's "next booked session" row has no backing
  table. Today ships the truthful equivalent — the client longest without a scan —
  and never presents it as a booking. A real booking row needs a scheduling feature.
- **Scan ordinal** (`Scan 03`) needs each client's full history; the queue omits it
  rather than showing a wrong number. Add it when the queue query can join history.
- **The comparison policy's wording is a phrase, not a chip label.** Client detail
  shows the magnitude in the pill and `comparisonStatusText` verbatim on its own
  full-width line. Crammed into a pill beside the card heading it wrapped mid-number.
  Finding rows show the phrase only when there is no signed magnitude — which is
  exactly when it carries information the row would otherwise lack.
- **The ±3-point tolerance is smaller than the dot it marks.** On a pinned 0–100
  domain the whisker the handoff draws is about eight user units, shorter than the
  diameter of the latest point. It is drawn instead as a shaded band spanning the
  compared interval: same quantity, visible, never inflated to be seen.
- **No consent date on client detail.** The only date available to that screen is
  `clients.consent_recorded_at`, which is not the record `getConsentStatus` decides
  from. State without a date beats a date attributed to the wrong evidence.
- **Status bar and home indicator** in the prototype are device chrome, not app UI.
  Deliberately not built. Safe-area insets are honoured instead.
- **Ambient photo** is a locally hosted downscale of the Vision Engine reference
  (`public/ambient/field.jpg`, 1080px, 37 KB). It sits under a 4px blur, so more
  resolution buys nothing. Replace with a licensed asset before production.
