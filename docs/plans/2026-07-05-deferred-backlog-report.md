# Deferred-Backlog Report — Audit, Decisions, and Plans

**Date:** 2026-07-05 · **Commit audited:** `85293c4` (main) · **Author mode:** plans + report only (no implementation, nothing landed)

This report closes the writing phase for the six deferred follow-ups left after Plan 2
("Pipeline Accuracy v2", PRs #76–#86) and the application-wide delta audit Devin requested.
Every decision below was made by Devin in-session on 2026-07-05.

---

## 1. Audit outcome (full detail: `docs/qa/AUDIT.md`, §Delta re-audit 2026-07-05)

Method: five parallel readers over the 26-commit delta (`c4aa299..85293c4`) plus re-verification
of every 2026-07-04 finding; the orchestrator independently re-verified the load-bearing new
claims in `playerMachine.ts`, `runState.ts`, and `buildProgram.ts`.

**Health baseline:** 540/540 tests pass, typecheck clean (root + engine package), production
build clean (47 routes). Plan 2's new surface is structurally sound: KB-only idempotent
migrations, citations never reach DB or client payloads, new copy passes the vocab sweep,
QA seed localhost-locked, coherence ratchet enforces both directions.

**Top findings (new):**

| # | Finding | Sev |
|---|---|---|
| 1 | Red-flag screen works once, client-side only: resume auto-plays without re-asking; server accepts completion with ack null; no practitioner surface; share-link drops it | S2×3 + S3 |
| 2 | Grade comparisons cross engine versions unguarded (v2 recalibrated bands; `scoring_engine_version` stored but never consulted) | S3 |
| 3 | All 2026-07-04 security headliners still open: plaintext consent tokens, CSP `unsafe-inline`/`unsafe-eval`, fail-open rate limiter, 9 uncovered mutating routes (3 new) | S2/S3 |
| 4 | New-surface polish: why-this sheet lacks focus trap/scroll lock; 2D map legend conditional on "possible" tier; 2D/3D disagree on low-confidence display; WorkoutPlayer at 815 lines (>800 max) | S2/S3 |
| 5 | Role-blind evidence pooling inflates stretch-exercise rank on dual-role muscles | S4 |

**Leverage plays, ranked:** ① red-flag integrity cluster (planned, item 2 below) → ② consent-token
hashing + rate-limit coverage → ③ engine-version comparison guard → ④ new-surface a11y branch →
⑤ scale guards (unbounded queries, recharts dynamic import, snapshot version guard) → ⑥ hygiene
batch (lint plan below, player split, pooling fix). Plays ②–⑤ are audit recommendations with no
plan doc yet — candidates for the next writing/build round.

---

## 2. The six items — end states

| Item | Decision (Devin, 2026-07-05) | End state |
|---|---|---|
| 1. Coherence-debt burn-down (30 pairs + hamstrings role) | Two-stage: 12 safe unmaps first, then evidence-reviewed re-scoring | **Plan written** → `docs/plans/2026-07-05-coherence-debt-burndown.md` (8 tasks) |
| 2. C1 — red-flag on resume | Full integrity cluster (not UI-only) | **Plan written** → `docs/plans/2026-07-05-red-flag-integrity.md` (5 tasks) |
| 3. C5 — frozen historical map | Keep live-join; record and close | **CLOSED** → `docs/plans/2026-07-05-frozen-map-c5-decision.md` |
| 4. Plan 2 retroactive record | Dropped — no doc of any kind; the 9 task briefs + SDD ledger are the record (verbatim copy at `~/Desktop/posture-ai-sdd-briefs-2026-07-05/`) | **CLOSED (dropped)** |
| 5. Prod deploy (Plan 1 tail) | — | **BLOCKED** on explicit "yes, apply to prod" (see §4) |
| 6. Pre-existing eslint debt (9 errors) | Fix errors only, warnings out of scope | **Plan written** → `docs/plans/2026-07-05-eslint-debt-cleanup.md` (3 tasks) |

### Item 1 highlights (why this plan looks the way it does)

A fresh literature pass (PubMed/PMC, 2026-07-05) drove the per-category dispositions, all
recorded in the plan's disposition table. Three calls worth surfacing here:

- **Safety flag:** `seated-hamstring-stretch × knee_extension_back_knee` is *contraindicated*,
  not just incoherent — hamstrings are abnormally LONG in genu recurvatum (PMID 20308923).
  The plan removes the pairing as a safety fix (Task 3), not hygiene.
- **Re-score where evidence supports it:** middle-trapezius (weak/MEDIUM, RCT PMID 36833034)
  + rhomboids (weak/LOW) for posterior shoulder imbalance; pec-minor (tight/MEDIUM) +
  thoracic-ES (weak/MEDIUM, EMG PMID 25463688) for forward head posture.
- **Do NOT re-score:** pelvic_axial_rotation links (no healthy-adult evidence; the 2D
  transverse metric is unreliable by our own validation) and pelvic_obliquity glute-max/hip-flexor
  links (evidence is sagittal-plane, not lateral tilt).
- **Hamstrings/trunk_lean role contradiction:** recode `weak → tight` (sway-back literature is
  unambiguous: short/overactive), re-home the dependent strengthen exercises (plan Task 8).

### Item 2 highlights

The audit upgraded C1 from "safety-UX judgment call" to a defect cluster: the handoff's
"transitively safe" claim only holds for a client's first session. The plan makes the
acknowledgement ride every patch, rejects unacknowledged completion server-side (422 +
structured log), re-asks on every mount including resume, and gives practitioners a run list
with a pain-check badge. No schema change needed.

---

## 3. Execution queue (for build mode — nothing started)

Recommended order; each row = one feature branch → `~/bin/zs-land`:

| # | Branch | Source | Size | Note |
|---|---|---|---|---|
| 1 | ESLint cleanup | eslint plan, Tasks 1–3 | XS | Land FIRST — touches `WorkoutPlayer.tsx`, which #2 restructures |
| 2 | Red-flag integrity | red-flag plan, Tasks 1–5 | M | Closes the audit's top tier |
| 3 | Coherence Stage 1 | burn-down plan, Tasks 1–3 | S | 15 pairs cleared, content-only, no migration |
| 4 | Coherence Stage 2 | burn-down plan, Tasks 4–6, 8 | M | One branch per task (each carries a seed migration) |
| 5 | Coherence Stage 3 | burn-down plan, Task 7 | S | Orphan disposition — per-exercise Devin sign-off inside the task |
| 6 | Audit quick wins | audit plays ②③ | S–M | Consent-token hashing, rate-limit coverage, version-mismatch caveat — plans not yet written |

Also uncommitted right now (needs a docs branch when build mode opens): `docs/qa/AUDIT.md` delta
+ the five docs this session created (`red-flag-integrity`, `coherence-debt-burndown`,
`eslint-debt-cleanup`, `frozen-map-c5-decision`, this report).

---

## 4. Item 5 — prod deployment (standing blocker) — **URGENCY UPGRADED 2026-07-05**

**New evidence (read-only Vercel check, 2026-07-05):** Vercel production auto-deploys from main
and is currently serving commit `85293c4` (deployment `dpl_Gzj5e6XPRNJstHm15k27FPGrRDjw`, READY).
The prod app therefore runs ALL Plan 1+2 code while the prod DB lacks the 6 migrations. The
backlog's "non-blocking, non-crashing" framing only considered the trunk_lean link gap; the skew
is wider:

- `PATCH /api/workouts/[id]/run` selects `session_runs.red_flag_acknowledged` (route L61) — the
  column doesn't exist on prod, so the select errors and every run-save returns 404: **workout
  progress/resume/acknowledgement persistence is presumed broken in prod right now**.
- New assessments write `assessment_findings.borderline` (added `20260706010000`) — if the insert
  includes the column, **new prod assessment creation may fail outright**.
- ~~The assessments API selects `muscle_imbalance_links.link_evidence, scored` — if those columns
  arrived with `20260707000000`, the prod muscle-map payload errors too.~~ **FALSE ALARM (verified
  2026-07-05):** `link_evidence` and `scored` arrived with `muscle_links_evidence_columns`
  (applied on prod as `20260628190604`) — they already exist on prod. The muscle-map payload select
  is fine.

### Apply log — 2026-07-05 (build mode, Devin authorized "yes, apply to prod")

Read-only verification (Vercel + Supabase MCP) confirmed the skew at the schema level and, importantly,
found **no runtime evidence of live breakage**: 7-day runtime errors show *zero* on `/api/workouts/[id]/run`
(only an unrelated `/middleware` refresh-token error, last 2026-07-03), and 24h logs are empty — prod is
effectively idle, so the missing-column failures are latent, not observed. Column-level check confirmed
`session_runs.red_flag_acknowledged` and `assessment_findings.borderline` were both **absent** on prod.

Applied (via Supabase MCP `execute_sql`, canonical ledger rows recorded):
- ✅ `20260707020000_session_runs_red_flag` — `session_runs.red_flag_acknowledged` now present (fixes run-save/resume 404).
- ✅ `20260706010000_findings_borderline` — `assessment_findings.borderline` now present (fixes new-assessment insert).

**Still pending (blocked):** the 4 entangled content migrations — `20260706000000_trunk_lean_merge`,
`20260707000000_muscle_kb_regrade_seed` (178KB destructive re-seed: `DELETE`+re-INSERT of
muscle_imbalance_links and exercise_muscles), `20260707010000_trunk_lean_thoracic_es_weak_unmap_scapular`,
`20260707030000_thoracic_es_weak_prose`. These must be applied **as one in-order unit via `psql -f`**
(faithful, no transcription risk) — blocked because the vault's `posture_ai_supabase_db_password`
is stale (pooler auth fails; password NOT rotated). Unblock: refresh the vault password, then psql-apply
the four in order + verify. Not urgent-broken: prod's muscle content stays functional (already seeded) until then.

Untouched otherwise, per standing rule. When Devin gives an explicit in-session **"yes, apply to prod"**
(project `dhrkezfypzutiwtmcmof`), the pending work is, in order:

1. Apply forward-only migrations not yet on prod. **DDL columns done 2026-07-05** (`findings_borderline`,
   `session_runs_red_flag` — see apply log above). Remaining content chain, in order, via `psql -f`:
   `20260706000000_trunk_lean_merge.sql` → `20260707000000_muscle_kb_regrade_seed.sql` →
   `20260707010000_trunk_lean_thoracic_es_weak_unmap_scapular.sql` → `20260707030000_thoracic_es_weak_prose.sql`.
   (Until then, new prod trunk_lean findings have no muscle links — non-crashing, no FK.)
2. Physical (Devin): capture Tier B volunteer photos per `packages/posture-engine/golden/protocol.md`,
   then `node scripts/golden-model-compare.mjs` (Plan 1 Task 13 Steps 2–4).

Note: any coherence Stage 2 migrations landed locally (item 1) will join this queue.

---

## 5. Open threads after this report

- Devin's go/no-go on the execution queue (§3) and its order.
- Plans not yet written for audit plays ②–⑤ (consent hashing, version guard, a11y branch, scale guards).
- Item 5 authorization + Tier B photos.
- The 22 lint *warnings* (explicitly out of item 6's scope) — decide whether to ever chase them.
