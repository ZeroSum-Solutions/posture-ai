# Decision Record: C5 — Historical Muscle-Map Rendering Stays Live-Join (backlog item 3)

**Date:** 2026-07-05 · **Decided by:** Devin · **Status:** CLOSED (decision recorded; no implementation)

## Context

Assessment muscle maps join the CURRENT knowledge-base links at read time:

- `app/api/assessments/[id]/route.ts` (~L60) — `muscle_imbalance_links` joined `.in('imbalance_key', keys)` on every read.
- `app/assessments/[id]/muscleMap.ts` (~L185, `regionsForRole`) — prefers live links over the legacy-name fallback.

Consequence: an assessment viewed months later renders the map from **today's** KB (grades, roles, scored flags), not the KB as it stood when the assessment was captured. This surfaced as Codex adversarial finding C5 during Plan 2 and was deferred as a possible design task ("frozen historical map": snapshot each finding's tight/weak links onto the assessment row at write time, read those, backfill).

## Decision

**Keep the live join. Do not snapshot links at write time.** No migration, no backfill, no design doc.

## Rationale

1. **This is the behavior Devin explicitly approved** in the Plan 2 T5 links-first flip (2026-07-04, with a controller-verified divergence report: 6/11 keys changed, 0 muscles dropped).
2. **KB changes are corrections, not drift.** Every regrade is literature-cited and gated (coherence ratchet, grade-count pin). When the KB improves, old assessments *should* render the corrected muscle picture — showing a client a map we now know was wrong, for fidelity's sake, is the worse product outcome for a screening tool.
3. **Reversible.** Assessments store the raw findings (`assessment_findings.imbalance_key` + metrics); the map is derived at read time. If snapshotting is ever wanted, historical rows can be back-rendered against any KB version — nothing is lost by deferring.
4. **The safety-relevant record is unaffected.** Scores, grades, and finding rows are frozen at write time (including `scoring_engine_version`); only the muscle-involvement *visualization* is live.

## What would reopen this

- A compliance/audit requirement that a practitioner-shared artifact be byte-reproducible as originally shown (e.g., a client dispute over what a report displayed).
- Cross-version *comparison* features that mix map states (note: the related but distinct engine-version comparison gap is already tracked as an S3 finding in `docs/qa/AUDIT.md` §Delta re-audit 2026-07-05 — that one IS actionable and is not closed by this decision).

If reopened, the sketch from the deferred-followups handoff stands: snapshot each finding's tight/weak links onto the assessment row at WRITE time, read those instead of the live join, plus a backfill migration for existing rows.

## Pointers

- Deferred-item source: `.claude/handoffs/posture-ai-deferred-followups.md` (item 3)
- Approved links-first behavior: Plan 2 Task 5 (PR #80, commit `6d3334a`), divergence report in `.superpowers/sdd/task-p2-5-report.md`
- Audit rows touching this surface: `docs/qa/AUDIT.md` (2026-07-05 delta — legacy fallback NO-ISSUE; 2D/3D low-confidence display mismatch S3, separate item)
