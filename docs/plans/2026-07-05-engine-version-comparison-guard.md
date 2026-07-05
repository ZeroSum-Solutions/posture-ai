# Engine-Version Comparison Guard Implementation Plan (audit play ③)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD.

**Goal:** Stop presenting a misleading "improved / slipped" grade verdict (and grade-level delta) when the two assessments being compared were scored by **different engine versions**. v2.0.0 recalibrated the grade bands dramatically, so a physically-unchanged client can appear to regress across a version boundary.

**Architecture:** `scoring_engine_version` is stamped on every assessment at scoring time (`app/api/assessments/route.ts:139`, value `ENGINE_VERSION = '2.0.0'` from `packages/posture-engine/src/engine.ts:17`) but is **never read** in the comparison path. The comparison lives in `POST /api/reports` (`app/api/reports/route.ts`): it fetches a prior assessment (`:83`), builds `priorMeta` (`:109-115`), computes per-finding deltas (`:153-203`), and `buildClientComparison` (`lib/reports/clientComparison.ts:44-56`) turns grade rank + score into the printed "improved/steady/slipped" verdict shown in the client PDF (`lib/pdf/clientReport.tsx:212`). None of these consult the version. Grade bands shifted (`packages/posture-engine/src/thresholds.ts:92-98`: a score of 30 was B under v1.x, is C under v2.0), so a cross-version grade delta is not a valid signal.

**Recommended resolution (default — flag for review):** **(b) caveat + verdict suppression.** When the two assessments' versions differ (or the prior's is `NULL` = pre-stamp), `buildClientComparison` returns a `not_comparable` overall state instead of improved/slipped, and both PDFs render a short caveat callout; the UI picker labels cross-version options. Per-finding degree deltas may still be shown under the caveat (they are physical measurements), but the **grade-level verdict is the misleading part and is what we suppress.** Alternatives (a) hard-block (422) and (c) recompute-prior-under-new-engine are recorded as a decision point below.

**Tech Stack:** Next.js 16 route, `@react-pdf` renderers, `lib/reports/clientComparison.ts`, Vitest, Playwright. **No schema change** — the column has existed since `20260101000000_initial_schema.sql:43`.

**Audit evidence:** `docs/qa/AUDIT.md` 2026-07-05 delta finding #2 ("Grade comparisons cross engine versions unguarded").

## Global Constraints

- No migration (column exists, nullable). Local Supabase only (`supabase status` = 127.0.0.1).
- Screening-vocabulary ban applies to the new caveat copy — no `diagnos`/`treat`/`cure`/`patient`/`prescri` stems. Draft: *"These screenings used different scoring versions, so the grade change isn't directly comparable."*
- Treat `scoring_engine_version IS NULL` on either side as a mismatch (version-unknown).
- The current assessment's version comes from its own row (or `ENGINE_VERSION` as the known fallback for a just-scored approved assessment).
- One feature branch → `~/bin/zs-land`. Never commit to main.

---

## Decision point (recommended default recorded — flag in PR body)

| Option | Behavior | Integration point | Trade-off |
|---|---|---|---|
| **(b) caveat + suppress verdict** ← default | Comparison still renders, grade verdict becomes "not comparable", caveat callout shown | `app/api/reports/route.ts` after same-client check (~:101) → props into both PDFs + `buildClientComparison` | Preserves the feature honestly; per-finding deltas still shown (labeled) |
| (a) hard block | `POST /api/reports` returns 422 when versions differ | same location | Safest, but practitioner loses cross-version comparison entirely until re-score |
| (c) recompute prior | Re-score the prior assessment's stored `captures.pose_frame` under the current engine, compare like-for-like | same location + `assessPosture(priorFrames)` | Most correct; +1 DB read + compute per export; `pose_frame` JSONB is guaranteed stored |

Proceed with **(b)** unless Devin chooses otherwise. (a) is a one-line swap of the caveat for a 422; (c) is a follow-up enhancement.

---

## Task 1: Thread the version into the reports route + detect mismatch

**Files:**
- Modify: `app/api/reports/route.ts` (`:50-53` primary select, `:83` prior select, mismatch computed after the same-client check ~`:101`)

**Interfaces:**
- Produces: a boolean `engineVersionMismatch` in scope where `priorMeta` and the comparison are built, passed downstream to `buildClientComparison` and both PDF renderers.

- [ ] **Step 1: Add the column to both selects.**
  - Primary assessment select (`:50-53`): append `scoring_engine_version`.
  - Prior assessment select (`:83`): append `scoring_engine_version`.
- [ ] **Step 2: Compute the flag** immediately after the existing same-client guard (~`:101`):

```ts
const currentVersion = assessment.scoring_engine_version ?? null
const priorVersion = prior.scoring_engine_version ?? null
const engineVersionMismatch = currentVersion !== priorVersion || priorVersion === null
```

- [ ] **Step 3: Thread it** into `buildClientComparison(...)` (new arg) and into the practitioner/client PDF props. Typecheck will drive the signature updates in the next tasks. Commit at the end of Task 3.

---

## Task 2: `buildClientComparison` returns `not_comparable` on mismatch (TDD)

**Files:**
- Modify: `lib/reports/clientComparison.ts` (`ClientComparison` type + `buildClientComparison`)
- Modify: `lib/reports/clientComparison.test.ts`

**Interfaces:**
- `buildClientComparison(current, prior, opts?: { engineVersionMismatch?: boolean })` → when `engineVersionMismatch` is true, `overall` is `'not_comparable'` (new union member) regardless of grades/scores; per-finding data is unchanged.

- [ ] **Step 1: Write the failing test** — append to `clientComparison.test.ts`:

```ts
it('returns not_comparable when engine versions differ, ignoring grade rank', () => {
  const c = buildClientComparison(
    { grade: 'C', score: 30, /* …findings… */ },
    { grade: 'B', score: 30, /* …findings… */ },   // would read as "slipped" under matching versions
    { engineVersionMismatch: true },
  )
  expect(c.overall).toBe('not_comparable')
})
it('still computes improved/slipped when versions match (regression guard)', () => {
  const c = buildClientComparison(current, prior, { engineVersionMismatch: false })
  expect(['improved', 'steady', 'slipped']).toContain(c.overall)
})
```

- [ ] **Step 2:** `npx vitest run lib/reports/clientComparison.test.ts` → FAIL.
- [ ] **Step 3: Implement** — add `'not_comparable'` to the `overall` union in the `ClientComparison` type (`:17`), and at the top of `buildClientComparison` (before the grade-rank logic at `:44`):

```ts
if (opts?.engineVersionMismatch) {
  return { ...perFindingResult, overall: 'not_comparable' }
}
```

- [ ] **Step 4:** `npx vitest run lib/reports/clientComparison.test.ts` → PASS.

---

## Task 3: Render the caveat + suppress the verdict in both PDFs; surface in the picker

**Files:**
- Modify: `lib/pdf/clientReport.tsx` (`:212` grade→grade line — show caveat + hide arrow verdict when `not_comparable`)
- Modify: `lib/pdf/report.tsx` (`Props` `:391`; render a caveat callout near the delta note `:497-501`)
- Modify: `app/api/clients/[id]/assessments/route.ts` (`:36-39` select — add `scoring_engine_version` so the picker can label)
- Modify: `app/assessments/[id]/page.tsx` (`:649-650` prior type + `:1157-1161` option label)

- [ ] **Step 1: Client PDF** — when `comparison.overall === 'not_comparable'`, replace the `Grade {prior} → {current}` verdict line (`:212`) with the caveat copy; do not render an improvement arrow/color.
- [ ] **Step 2: Practitioner PDF** — add `engineVersionMismatch?: boolean` to `Props` (`:391`); when true, render a one-line caveat callout beside the existing delta-column note (`:497-501`): the per-finding degree deltas stay, prefixed by the caveat.
- [ ] **Step 3: Picker API** — add `scoring_engine_version` to the select in `app/api/clients/[id]/assessments/route.ts:36-39` (both the with- and without-findings branches).
- [ ] **Step 4: Picker UI** — extend the `priorAssessments` state type (`page.tsx:649-650`) with `scoring_engine_version: string | null`, and in the option render (`:1157-1161`) append `" (different scoring version)"` when it differs from the current assessment's version. Copy passes the vocab ban.
- [ ] **Step 5: Vocab + type + suite** — `npx tsc --noEmit && npx vitest run lib/ui-vocabulary.test.ts && npx vitest run` → PASS.
- [ ] **Step 6: Commit** — `feat(reports): guard grade comparison across engine versions (caveat + suppress verdict)`.

---

## Task 4: e2e — a cross-version comparison shows the caveat, not a false verdict

**Files:**
- Modify: `e2e/report-approval.spec.ts` (append a flow)

- [ ] **Step 1: Write the spec** — create two approved assessments for one client (via the test helpers already in this spec), then patch the prior's `scoring_engine_version` to `'1.3.0'` (direct API/service patch, mirroring how flow 3 of the workout spec patches state; or a small SQL update against local Supabase). Request `POST /api/reports` with `compared_to_assessment_id` and assert the response/PDF path succeeds AND (for option b) that the comparison is flagged not-comparable — assert via the report payload or a rendered marker. If option (a) was chosen instead, assert HTTP 422.
- [ ] **Step 2:** `npm run test:e2e -- --grep "report"` → PASS (existing same-client 400 + unapproved 403 flows still green).
- [ ] **Step 3: Commit + land** — `test(e2e): cross-version report comparison is flagged not-comparable` → `~/bin/zs-land`.

---

## Success Criteria

- [ ] `POST /api/reports` reads `scoring_engine_version` for both assessments; a mismatch (or NULL prior) sets `engineVersionMismatch`.
- [ ] `buildClientComparison` returns `not_comparable` on mismatch (unit-tested); matching-version behavior unchanged (regression-tested).
- [ ] Both PDFs render the caveat and suppress the grade verdict on mismatch; the picker labels cross-version options.
- [ ] `npx tsc --noEmit` clean; full `npx vitest run` green; report e2e green.

## Non-goals

- Recomputing historical assessments under the current engine (option c) — a separate enhancement; note it in `docs/qa/AUDIT.md` if deferred.
- Back-stamping `scoring_engine_version` on NULL legacy rows (they are correctly treated as version-unknown).
- Changing the grade bands or engine version.
