# Wave 4 PR2a — Honesty Foundation (invisible data + storage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the database, engine-helper, storage, and content foundation for the two-uncertainty honesty model — with **zero visible change** to the screen, chips, `/muscles/[slug]`, or PDF — so PR2b can add the rendering gate by reading columns that already exist and are populated.

**Architecture:** Two additive forward-only schema migrations (one `assessment_findings` column, four `muscle_imbalance_links` columns) plus a pure engine projection helper and a small extracted storage builder. The engine stays frozen at `ENGINE_VERSION 1.2.0`: `metric_validity` is computed by a new pure `metricValidity(key)` helper in `thresholds.ts` (a read-only projection of existing boundary provenance — no `Finding`-shape or version change) and stamped onto findings at storage time by the POST route. No read path is touched, and **PR2a performs no row-modifying write on `muscle_imbalance_links`/`exercise_muscles`/`muscles`** — both migrations are metadata-only `ADD COLUMN`s (Postgres 11+ does not rewrite rows for nullable or constant-default columns), so no heap row is relocated and the unordered link/exercise SELECTs cannot reorder. All link-data population (`link_evidence` backfill, the KB-seed regen + display-only re-add, and deterministic read ordering) is deferred to PR2b's gate. The only DB delta is new write-only columns that nothing renders until PR2b, plus `metric_validity` stamped on newly-scored findings going forward.

**Tech Stack:** TypeScript, Next.js 16 App Router, Supabase Postgres (RLS), Zod content schema, Vitest (node env), `@posture-ai/engine` workspace, Supabase CLI migrations + Management API push.

## Global Constraints

- **Engine frozen at `ENGINE_VERSION 1.2.0`.** No change to `Finding`, `AssessmentResult`, scoring math, or the version constant. `metricValidity()` is an *additive, pure* export — a projection over `THRESHOLDS` provenance, not a scoring change.
- **Zero *rendered* change (the PR2a contract).** No read-path file changes: `app/api/assessments/[id]/route.ts`, `app/api/reports/route.ts`, `app/assessments/[id]/page.tsx`, `app/muscles/[slug]/page.tsx`, `lib/pdf/report.tsx`, `app/assessments/[id]/MuscleBodyMap.tsx`. PR2a performs no row-modifying write on `muscle_imbalance_links`/`exercise_muscles`/`muscles` (both migrations are metadata-only `ADD COLUMN`s; no row is added, removed, or relocated), so the rendered rows **and their order** are identical to current prod. **One intended, backward-compatible API delta:** the GET findings route does `.select('*')` then spreads `...f` (`app/api/assessments/[id]/route.ts:37,75`), so the `/api/assessments/[id]` JSON additively gains a `metric_validity` field (NULL on old rows) — unrendered (the React page destructures only known fields; no test asserts the finding payload shape) and exactly the field PR2b's frame badge consumes. The link and `/muscles/[slug]` selects use explicit columns, so the four `muscle_imbalance_links` columns do **not** leak. PR2a is therefore invisible to users; it is not strictly write-only at the API layer, and that one additive field is intentional (do not convert the GET to an explicit-column select here — PR2b's shared enrichment owns that select).
- **PR2a writes NO `muscle_imbalance_links` data at all (schema-only).** The `link_evidence` backfill, the KB-seed regen, the `scored:false` re-add of the 3 demoted knee links (`gastrocnemius-soleus`, `popliteus`, `quadriceps`), and the `scored = true` chokepoint filter are ALL deferred to PR2b's gate. Reasons this must wait: (1) re-adding those rows before the filter makes their chips/markers reappear (the results GET route + `/muscles/[slug]` have no `scored` filter); (2) a full regen reorders `exercise_muscles` on muscle pages; (3) even a pure `UPDATE` to `link_evidence` would relocate heap tuples and reorder the unordered link SELECTs (chip order on existing assessments). PR2a only `ADD COLUMN`s the four columns (metadata-only — no row touched); PR2b populates them and adds deterministic `ORDER BY` to the read paths.
- **Screening-only vocabulary.** Content (incl. new `exclusionReason` text) must pass `BANNED_TERM_PATTERNS` (`/diagnos/`, `/\btreat\w*/`, `/\bcure\w*/`, `/\bpatient\w*/`, `/\bprescri\w*/`). Lint runs via `screeningText()` in `content/muscles/types.ts` and `lib/ui-vocabulary.test.ts`.
- **TDD throughout** (Iron Law: failing test first for every unit). Green gate before each commit: `npx tsc --noEmit` + `npx eslint` (0 errors; the 2 pre-existing `<img>` warnings are OK) + `npx vitest run` + `npx next build`.
- **Migrations are forward-only**, named `YYYYMMDDHHMMSS_<name>.sql`. Latest existing is `20260627000000`; PR2a uses `20260628000000` (findings column) and `20260628010000` (links columns) — two independent additive schema migrations. Never edit an applied migration.
- **Production DB writes require explicit user go-ahead** (Task 7 is a hard STOP). Local `npx supabase db reset` is the dev/CI check; cloud push is via the Management API with the ZS Vault `SUPABASE_ACCESS_TOKEN` (prod ref `dhrkezfypzutiwtmcmof`, org Zerosumsolutions-Projects).
- **Conventional commits, attribution disabled** (no `Co-Authored-By`). One feature branch `wave4-pr2a-honesty-foundation`; land via `~/bin/zs-land` only after the GPT-5.5 gate returns SHIP.
- **GPT-5.5 adversarial gate before land** (Task 8): `codex exec -s read-only -m gpt-5.5 -c model_reasoning_effort="high" -C <repo> - < promptfile`. Confirm each finding against code; fix every BLOCK delta; re-run until SHIP.

---

## File Structure

**Create:**
- `supabase/migrations/20260628000000_assessment_findings_metric_validity.sql` — adds the `metric_validity` column.
- `supabase/migrations/20260628010000_muscle_links_evidence_columns.sql` — adds `link_evidence`, `scored`, `exclusion_reason`, `direction_applicability`.
- `lib/findings/buildFindingRow.ts` — pure mapper `Finding → assessment_findings` row (stamps `metric_validity`). Seeds the `lib/findings/` module PR2b's shared enrichment will join.
- `lib/findings/buildFindingRow.test.ts` — unit tests for the mapper.

**Modify:**
- `packages/posture-engine/src/thresholds.ts` — append `MetricValidity` type + `metricValidity(key)` helper.
- `packages/posture-engine/__tests__/thresholds.test.ts` — add a `metricValidity` describe block.
- `app/api/assessments/route.ts:96-110` — replace the inline findings map with `buildFindingRow(...)`.
- `content/muscles/types.ts:73-75` — add optional `exclusionReason` to `muscleLinkSchema`.
- `content/muscles/gastrocnemius-soleus.ts`, `content/muscles/popliteus.ts`, `content/muscles/quadriceps.ts` — add `exclusionReason` to each display-only knee link.
- `content/content.test.ts:87-97` — add an `exclusion_reason` invariant after the display-only test.

PR2a touches no seed/generator scripts and writes no `muscle_imbalance_links` data — `link_evidence` backfill, the full KB-seed regen (skip removed + `scored` filter + 8-col INSERT), and read-path `ORDER BY` are all PR2b's, where they land with the gate.

---

### Task 1: `metricValidity()` engine helper

**Files:**
- Modify: `packages/posture-engine/src/thresholds.ts` (append after `toPercentile`, line 112)
- Test: `packages/posture-engine/__tests__/thresholds.test.ts` (import line 2; new describe after line 64)

**Interfaces:**
- Produces: `export type MetricValidity = 'VALIDATED' | 'LITERATURE_CITED' | 'SCREENING_ONLY'` and `export function metricValidity(key: string): MetricValidity`. Rule: both zone boundaries `source === 'literature'` ⇒ `LITERATURE_CITED`; an absent key or any engineering boundary ⇒ `SCREENING_ONLY`; `VALIDATED` is reserved (no metric qualifies today). Consumed by Task 3 (`buildFindingRow`).

- [ ] **Step 1: Write the failing test** — append to `packages/posture-engine/__tests__/thresholds.test.ts`, and extend the import on line 2 to `import { THRESHOLDS, toZoneAndPct, metricValidity } from '../src/thresholds'`:

```typescript
describe('metricValidity (projection over threshold provenance)', () => {
  it('knee_extension_back_knee is LITERATURE_CITED (both boundaries peer-reviewed)', () => {
    expect(metricValidity('knee_extension_back_knee')).toBe('LITERATURE_CITED')
  })

  it('every proxy + genu metric is SCREENING_ONLY (engineering boundaries)', () => {
    for (const key of [...PROXY_KEYS, 'genu_varum_valgum_left', 'genu_varum_valgum_right']) {
      expect(metricValidity(key), key).toBe('SCREENING_ONLY')
    }
  })

  it('an absent / unscored key is SCREENING_ONLY (most conservative default)', () => {
    expect(metricValidity('pelvic_axial_rotation')).toBe('SCREENING_ONLY')
    expect(metricValidity('nonexistent_metric')).toBe('SCREENING_ONLY')
  })

  it('no metric is VALIDATED yet (reserved for the Layer-1 validation study)', () => {
    for (const key of Object.keys(THRESHOLDS)) {
      expect(metricValidity(key), key).not.toBe('VALIDATED')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @posture-ai/engine -- thresholds`
Expected: FAIL — `metricValidity is not a function` / `not exported`.

- [ ] **Step 3: Write minimal implementation** — append to `packages/posture-engine/src/thresholds.ts`:

```typescript
/**
 * Dominant honesty frame for a scored metric, derived purely from boundary
 * provenance (no scoring change — this is a read-only projection over THRESHOLDS):
 *   LITERATURE_CITED — both zone boundaries are peer-reviewed cut-points
 *                      (only knee_extension_back_knee today).
 *   SCREENING_ONLY   — any engineering boundary, or an absent/unscored key.
 *   VALIDATED        — reserved for metrics that clear the Layer-1 validation
 *                      study; nothing qualifies yet.
 * Stored per finding by the POST route (see lib/findings/buildFindingRow.ts).
 */
export type MetricValidity = 'VALIDATED' | 'LITERATURE_CITED' | 'SCREENING_ONLY'

export function metricValidity(key: string): MetricValidity {
  const t = THRESHOLDS[key]
  if (!t) return 'SCREENING_ONLY'
  if (t.warn.source === 'literature' && t.danger.source === 'literature') {
    return 'LITERATURE_CITED'
  }
  return 'SCREENING_ONLY'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @posture-ai/engine -- thresholds`
Expected: PASS (all provenance + metricValidity tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/posture-engine/src/thresholds.ts packages/posture-engine/__tests__/thresholds.test.ts
git commit -m "feat(engine): add metricValidity() projection over threshold provenance"
```

---

### Task 2: `assessment_findings.metric_validity` migration

**Files:**
- Create: `supabase/migrations/20260628000000_assessment_findings_metric_validity.sql`

**Interfaces:**
- Produces: a nullable `metric_validity TEXT` column (CHECK in the 3 enum values) on `assessment_findings`. Written by Task 3 at runtime; read by PR2b. Existing rows stay NULL (PR2b treats NULL as `SCREENING_ONLY`).

- [ ] **Step 1: Create the migration**

```sql
-- Wave 4 PR2a: store per-finding metric validity (the dominant honesty frame).
--
-- metric_validity records how trustworthy the SCORE is, independent of any muscle
-- inference. Derived at scoring time from engine threshold provenance
-- (packages/posture-engine/src/thresholds.ts -> metricValidity()):
-- LITERATURE_CITED when both zone boundaries are peer-reviewed cut-points (only
-- knee_extension_back_knee today), else SCREENING_ONLY. VALIDATED is reserved for
-- metrics that clear the Layer-1 validation study. Nullable: rows scored before
-- this migration stay NULL, and the PR2b render path treats NULL as SCREENING_ONLY
-- (the most conservative frame). Write-only in PR2a — nothing reads it yet.
-- Idempotent.

ALTER TABLE assessment_findings
  ADD COLUMN IF NOT EXISTS metric_validity TEXT
  CHECK (metric_validity IN ('VALIDATED', 'LITERATURE_CITED', 'SCREENING_ONLY'));
```

- [ ] **Step 2: Apply the full chain locally and verify the column exists**

Run:
```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d assessment_findings" | grep metric_validity
```
Expected: `npx supabase db reset` completes through every migration; the `grep` prints a `metric_validity | text` line.
(If `psql` is not on PATH: `supabase db reset` applying cleanly is the CI-parity check, and the column is exercised at runtime by the Task 3 POST flow / e2e `assessment-flow.spec.ts`, which inserts `metric_validity` — a missing/misnamed column makes that INSERT fail.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260628000000_assessment_findings_metric_validity.sql
git commit -m "feat(db): add assessment_findings.metric_validity column"
```

---

### Task 3: stamp `metric_validity` on stored findings (`buildFindingRow`)

**Files:**
- Create: `lib/findings/buildFindingRow.ts`
- Test: `lib/findings/buildFindingRow.test.ts`
- Modify: `app/api/assessments/route.ts` (add import after line 7; replace the inline map at lines 96-110)

**Interfaces:**
- Consumes: `Finding` from `@posture-ai/engine`; `metricValidity` from `@posture-ai/engine/thresholds`.
- Produces: `export interface FindingRow` and `export function buildFindingRow(f: Finding, assessmentId: string, practitionerId: string): FindingRow`. Returns exactly the columns the POST route already inserts (`assessment_id, practitioner_id, imbalance_key, region, label, deviation, standard, unit, direction, severity_pct, zone, view_used, confidence`) **plus** `metric_validity: metricValidity(f.key)`. The `view_used` ternary is preserved verbatim from the route (behavior-identical extraction).

- [ ] **Step 1: Write the failing test** — `lib/findings/buildFindingRow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Finding } from '@posture-ai/engine'
import { buildFindingRow } from './buildFindingRow'

const baseFinding: Finding = {
  key: 'knee_extension_back_knee',
  label: 'Recurvatum',
  region: 'leg',
  deviation: 7,
  standard: 0,
  unit: 'deg',
  direction: 'Hyperextended',
  severityPct: 50,
  zone: 'warning',
  viewUsed: 'side',
  confidence: 0.9,
  reliable: true,
  landmarksUsed: ['left_hip', 'left_knee', 'left_ankle'],
}

describe('buildFindingRow', () => {
  it('maps engine fields to the assessment_findings row shape', () => {
    const row = buildFindingRow(baseFinding, 'assess-1', 'prac-1')
    expect(row.assessment_id).toBe('assess-1')
    expect(row.practitioner_id).toBe('prac-1')
    expect(row.imbalance_key).toBe('knee_extension_back_knee')
    expect(row.region).toBe('leg')
    expect(row.severity_pct).toBe(50)
    expect(row.zone).toBe('warning')
    expect(row.view_used).toBe('side')
    expect(row.confidence).toBe(0.9)
  })

  it('stamps LITERATURE_CITED for the literature-cited recurvatum metric', () => {
    expect(buildFindingRow(baseFinding, 'a', 'p').metric_validity).toBe('LITERATURE_CITED')
  })

  it('stamps SCREENING_ONLY for an engineering-default metric', () => {
    const fhp: Finding = { ...baseFinding, key: 'forward_head_posture' }
    expect(buildFindingRow(fhp, 'a', 'p').metric_validity).toBe('SCREENING_ONLY')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/findings/buildFindingRow.test.ts`
Expected: FAIL — cannot resolve `./buildFindingRow`.

- [ ] **Step 3: Write minimal implementation** — `lib/findings/buildFindingRow.ts`:

```typescript
import type { Finding } from '@posture-ai/engine'
import { metricValidity } from '@posture-ai/engine/thresholds'

/** Row shape inserted into assessment_findings by POST /api/assessments. */
export interface FindingRow {
  assessment_id: string
  practitioner_id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number
  standard: number
  unit: string
  direction: string
  severity_pct: number
  zone: string
  view_used: string
  confidence: number
  metric_validity: string
}

/**
 * Pure mapper from an engine Finding to its persisted row. Stamps metric_validity
 * (the dominant honesty frame) from threshold provenance at storage time — the
 * engine stays frozen and never carries this field on Finding.
 */
export function buildFindingRow(
  f: Finding,
  assessmentId: string,
  practitionerId: string,
): FindingRow {
  return {
    assessment_id: assessmentId,
    practitioner_id: practitionerId,
    imbalance_key: f.key,
    region: f.region,
    label: f.label,
    deviation: f.deviation,
    standard: f.standard,
    unit: f.unit,
    direction: f.direction,
    severity_pct: f.severityPct,
    zone: f.zone,
    view_used: f.viewUsed === 'back' ? 'back' : f.viewUsed,
    confidence: f.confidence,
    metric_validity: metricValidity(f.key),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/findings/buildFindingRow.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the route to the extracted builder** — in `app/api/assessments/route.ts`, add after line 7:

```typescript
import { buildFindingRow } from '@/lib/findings/buildFindingRow'
```

Then replace the inline map (current lines 96-110) with:

```typescript
      // Save findings (metric_validity stamped from threshold provenance)
      const findingsToInsert = result.findings.map((f) =>
        buildFindingRow(f, assessmentId, user.id),
      )
```

- [ ] **Step 6: Verify the build is green and behavior is unchanged**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: type-clean; tests pass; build succeeds. The inserted row now carries `metric_validity` (runtime requires Task 2's column — applied by `supabase db reset`); all other columns are byte-identical to before. Note: the GET route's `.select('*')` means `/api/assessments/[id]` now additively returns `metric_validity` — backward-compatible and unrendered (no test asserts the finding payload shape; `app/assessments/[id]/page.tsx` reads only known fields). This is intended (PR2b consumes it); do **not** convert the GET to an explicit-column select in PR2a — that would touch a read path, and PR2b's shared enrichment will own that select.

- [ ] **Step 7: Commit**

```bash
git add lib/findings/buildFindingRow.ts lib/findings/buildFindingRow.test.ts app/api/assessments/route.ts
git commit -m "feat(api): stamp metric_validity on stored findings via buildFindingRow"
```

---

### Task 4: `muscle_imbalance_links` evidence columns migration

**Files:**
- Create: `supabase/migrations/20260628010000_muscle_links_evidence_columns.sql`

**Interfaces:**
- Produces: four columns on `muscle_imbalance_links` — `link_evidence TEXT` (CHECK high/medium/low), `scored BOOLEAN NOT NULL DEFAULT true`, `exclusion_reason TEXT`, `direction_applicability TEXT` (CHECK varum/valgum/both). All are **schema-only foundation in PR2a — no data is written**: `scored` is `true` for every existing row via the DEFAULT (metadata-only, no rewrite), and `link_evidence` / `exclusion_reason` / `direction_applicability` are NULL until PR2b's seed regen populates them. The migration is a pure additive `ADD COLUMN` (no table rewrite, no row relocation in Postgres 11+).

- [ ] **Step 1: Create the migration**

```sql
-- Wave 4 PR2a: per-link evidence metadata on muscle_imbalance_links.
--
-- Foundation for the PR2b honesty gate. Schema-only in PR2a: no data is written
-- here (scored defaults true; the other three stay NULL) and no read path consumes
-- any of them until PR2b populates + renders them. Pure additive ADD COLUMN
-- (metadata-only in PG 11+: no table rewrite, no row relocation). Idempotent.
--
--   link_evidence            per-link confidence grade (content `confidence`).
--   scored                   false = display-only (excluded from the scored map
--                            in PR2b). DEFAULT true so pre-existing rows are scored.
--   exclusion_reason         why a display-only link is excluded (surfaced in PR2b).
--   direction_applicability  RESERVED for PR3 genu direction-conditioning
--                            (varum / valgum / both); unpopulated in PR2a.

ALTER TABLE muscle_imbalance_links
  ADD COLUMN IF NOT EXISTS link_evidence TEXT
    CHECK (link_evidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS scored BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT,
  ADD COLUMN IF NOT EXISTS direction_applicability TEXT
    CHECK (direction_applicability IN ('varum', 'valgum', 'both'));
```

- [ ] **Step 2: Apply the full chain locally and verify the columns exist**

Run:
```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d muscle_imbalance_links" | grep -E "link_evidence|^ scored|exclusion_reason|direction_applicability"
```
Expected: `supabase db reset` completes; the four new columns appear. (If `psql` is not on PATH: these columns carry no PR2a data, so beyond `supabase db reset` applying cleanly their existence is confirmed at push time via Task 6 Step 2(b)'s `information_schema` query.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260628010000_muscle_links_evidence_columns.sql
git commit -m "feat(db): add evidence columns to muscle_imbalance_links"
```

---

### Task 5: author `exclusion_reason` on the display-only knee links

**Files:**
- Modify: `content/muscles/types.ts` (add `exclusionReason` to `muscleLinkSchema` after the `scored` field, line 73)
- Modify: `content/muscles/gastrocnemius-soleus.ts`, `content/muscles/popliteus.ts`, `content/muscles/quadriceps.ts` (the `knee_extension_back_knee` link only)
- Test: `content/content.test.ts` (new `it(...)` after the display-only test, line 97)

**Interfaces:**
- Produces: optional `exclusionReason?: string` on each link (screening-linted, 20–300 chars). **Not consumed by anything in PR2a** — PR2a writes no `muscle_imbalance_links` data. It is authored and locked by the content test now; its DB write happens in PR2b's seed regen (which re-adds the display-only rows and emits this column). `directionApplicability` is intentionally NOT added to the content schema in PR2a — it arrives in PR3 with its first genu consumer.

- [ ] **Step 1: Write the failing test** — append to the `describe('muscle content', …)` block in `content/content.test.ts`, after the display-only test (line 97):

```typescript
  // Each display-only knee link must carry a screening-safe exclusion_reason
  // explaining why it is kept educational but out of the scored map (surfaced in PR2b).
  it('display-only knee links carry an exclusion_reason', () => {
    const displayOnly = ALL_MUSCLES.flatMap(m =>
      m.links
        .filter(l => l.imbalanceKey === 'knee_extension_back_knee' && l.scored === false)
        .map(l => ({ slug: m.slug, reason: l.exclusionReason }))
    )
    expect(displayOnly.map(d => d.slug).sort()).toEqual(
      ['gastrocnemius-soleus', 'popliteus', 'quadriceps']
    )
    for (const d of displayOnly) {
      expect(typeof d.reason === 'string' && d.reason.length > 0, d.slug).toBe(true)
    }
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run content/content.test.ts -t "exclusion_reason"`
Expected: FAIL — `exclusionReason` is `undefined` (and TS may also flag the property as unknown until Step 3).

- [ ] **Step 3: Add the schema field** — in `content/muscles/types.ts`, insert into `muscleLinkSchema` immediately after the `scored` field (after line 73, before `rationale`):

```typescript
  /**
   * Screening-safe note explaining why a display-only (scored:false) link is kept
   * out of the scored muscle map. Authored for the demoted knee links; surfaced in
   * the PR2b results/PDF gate. Absent for scored links.
   */
  exclusionReason: screeningText(20, 300).optional(),
```

- [ ] **Step 4: Add the reason to each display-only knee link**

In `content/muscles/gastrocnemius-soleus.ts`, the `knee_extension_back_knee` link (currently lines 20-27) gains an `exclusionReason` after `scored: false`:

```typescript
      scored: false,
      exclusionReason:
        'Display-only: the calf to recurvatum link rests on stroke-population and direction-ambiguous evidence (Grade C), below the asymptomatic-population bar the hamstring link cleared, so it is kept educational rather than scored.',
```

In `content/muscles/popliteus.ts`, the `knee_extension_back_knee` link (lines 14-21):

```typescript
      scored: false,
      exclusionReason:
        'Display-only: no causal recurvatum data supports the popliteus inference (Grade C+); it stays on the muscle page as education but is excluded from the scored map alongside the calf and quadriceps links.',
```

In `content/muscles/quadriceps.ts`, the `knee_extension_back_knee` link (lines 14-21):

```typescript
      scored: false,
      exclusionReason:
        'Display-only: the quadriceps to recurvatum inference is the weakest of the four (Grade D) and could not be supported in the 2026-06-27 evidence scan, so it is kept educational and excluded from the scored map.',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run content/content.test.ts`
Expected: PASS — the new `exclusion_reason` test passes; the schema/vocabulary-lint test still passes (no banned terms in the three reasons).

- [ ] **Step 6: Commit**

```bash
git add content/muscles/types.ts content/muscles/gastrocnemius-soleus.ts content/muscles/popliteus.ts content/muscles/quadriceps.ts content/content.test.ts
git commit -m "feat(content): author exclusion_reason on display-only knee links"
```

---


### Task 6: production migration push (GO-AHEAD GATE)

**Files:** none (ops). Pushes the two already-committed schema migrations to prod.

> **HARD STOP — explicit user go-ahead required before any prod write.** Do not run this task autonomously. Confirm: "Push the two PR2a schema migrations to prod `dhrkezfypzutiwtmcmof`?" and wait for an unambiguous yes.

- [ ] **Step 1: Confirm the token is available** (ZS Vault; the session may already export it)

Run: `test -n "$SUPABASE_ACCESS_TOKEN" && echo "token present" || echo "run: export SUPABASE_ACCESS_TOKEN=\$(zsvault get SUPABASE_ACCESS_TOKEN)"`

- [ ] **Step 2: Push the two migrations and verify — one self-cleaning block.** The bearer token must never appear in `curl` argv (ZS Vault rule). Write it to a `chmod 600` curl config via a heredoc (so it stays out of every process's args) and pass it with `curl -K`; a `trap` deletes the file on exit. Both migrations are pure additive `ADD COLUMN` (metadata-only in Postgres 11+ for nullable / constant-default columns — no table rewrite, no row relocation), so they cannot reorder any rendered data. Verify the new columns directly via the Management API query endpoint (`/api/health` does NOT probe these columns, per RUNBOOK §Migrations).

```bash
REF=dhrkezfypzutiwtmcmof

# Auth header in a 0600 file (heredoc expands the token WITHOUT putting it in argv); auto-removed.
cfg="$(mktemp)"; chmod 600 "$cfg"; trap 'rm -f "$cfg"' EXIT
cat > "$cfg" <<EOF
header = "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"
EOF

# (a) Push the two schema migrations (independent; order not load-bearing).
for f in 20260628000000_assessment_findings_metric_validity \
         20260628010000_muscle_links_evidence_columns; do
  jq -Rs "{query: ., name: \"$f\"}" < "supabase/migrations/$f.sql" | \
  curl -sS -K "$cfg" -X POST "https://api.supabase.com/v1/projects/$REF/database/migrations" \
    -H "Content-Type: application/json" --data @-
  echo " <- pushed $f"
done

# (b) Verify the five new columns exist (jq builds the JSON so SQL literals stay valid).
read -r -d '' SQL <<'SQL'
select table_name, column_name
from information_schema.columns
where (table_name = 'assessment_findings' and column_name = 'metric_validity')
   or (table_name = 'muscle_imbalance_links'
       and column_name in ('link_evidence', 'scored', 'exclusion_reason', 'direction_applicability'))
order by 1, 2;
SQL
jq -n --arg q "$SQL" '{query: $q}' | \
  curl -sS -K "$cfg" -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Content-Type: application/json" --data @-

# (c) Confirm PR2a wrote NO link data: link_evidence all NULL, no display-only rows, row count unchanged.
jq -n --arg q "select count(*) filter (where link_evidence is not null) as graded, count(*) filter (where scored is false) as display_only, count(*) as total from muscle_imbalance_links;" '{query: $q}' | \
  curl -sS -K "$cfg" -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Content-Type: application/json" --data @-
```
Expected: (a) each push prints `<- pushed …` with no error body; (b) 5 rows — `assessment_findings/metric_validity` + the four `muscle_imbalance_links` columns; (c) `graded = 0` and `display_only = 0` (PR2a writes no link data — `link_evidence` is backfilled in PR2b), `total` unchanged from the prior link count (metadata-only ADD COLUMN, no rows added/removed/reordered).

- [ ] **Step 3: Health + app sanity**

Run: `curl -s https://posture-ai-ivory.vercel.app/api/health`
Expected: a JSON object containing `"status":"ok"`, `"database":"connected"`, `"schema":"ready"` (plus a `timestamp` field — do not assert exact equality). This only confirms the probed tables (`practitioners`, `muscles`, `assessments.priority_keys`) are healthy; `/api/health` does **not** probe the PR2a columns, which are verified directly in Step 2 (b)/(c) via the Management API query.

---

### Task 7: GPT-5.5 adversarial gate → land

**Files:** `/private/tmp/claude-501/.../scratchpad/pr2a-review-prompt.md` (review prompt; not committed).

- [ ] **Step 1: Write the review prompt** capturing the full PR2a diff (`git diff main...HEAD`) and explicitly flagging the architecture decisions for adversarial scrutiny:
  1. **PR2/PR2a split** — PR2a is invisible foundation; PR2b is the gate.
  2. **`metricValidity` as a pure projection** stamped at storage time (engine frozen, no `Finding`/`ENGINE_VERSION` change). Is deriving-at-write (vs storing engine output) defensible? Is NULL-as-SCREENING_ONLY the right conservative default?
  3. **Kept the `scored === false` skip** — confirm that re-adding the demoted rows now (without the PR2b `scored` filter) would be a visible regression, and that deferring both to PR2b is correct.
  4. **`direction_applicability` reserved column** with no PR2a/PR2b consumer — YAGNI vs landing the link-evidence schema as one ALTER. Defensible, or split to PR3?
  5. **Invisibility proof** — "no read-path file changed + unchanged emitted row set" + the **one intended additive API field**: `/api/assessments/[id]` returns `metric_validity` via the existing `.select('*')` spread (`route.ts:37,75`) — unrendered, backward-compatible, consumed by PR2b; the link and `/muscles/[slug]` selects are explicit-column so they don't leak. Is accepting that additive field sufficient, or must PR2a instead convert the GET to an explicit-column select / add a click-through?
  Require the verdict to end with `SHIP` or `BLOCK` + numbered deltas, using `[CONFIRM]`/`[DISAGREE]` tags.

- [ ] **Step 2: Run the gate (background)**

```bash
codex exec -s read-only -m gpt-5.5 -c model_reasoning_effort="high" \
  -C /Users/zero-suminc./projects/posture-ai - < <scratchpad>/pr2a-review-prompt.md
```
(Launch with `run_in_background: true`; it runs for minutes.)

- [ ] **Step 3: Confirm each finding against code, fix every BLOCK delta, re-run until SHIP.** Confirm (don't refute) — PR1's loop showed its critiques are ~all legitimate. New tests for any behavioral fix (TDD).

- [ ] **Step 4: Land** — only after SHIP and a fully clean tree:

```bash
git status --porcelain   # must be empty (stash untracked scratch if any)
~/bin/zs-land
```
(owner `wiggdevin` ⇒ zs-land auto-merges: push → PR with summary + test plan → squash-merge → delete branch → sync `main`.)

---

## Self-Review

**1. Spec coverage** (vs the converged design's PR2a scope): `metric_validity` storage ✔ (T1–T3); `muscle_imbalance_links` evidence schema `link_evidence`/`scored`/`exclusion_reason`/`direction_applicability` (schema-only) ✔ (T4); content `exclusionReason` on demoted links ✔ (T5); engine freeze honored ✔ (helper is an additive projection, no `Finding`/version change); prod push + verify ✔ (T6); GPT gate + land ✔ (T7). Deferred-by-design and explicitly noted: ALL `muscle_imbalance_links` data writes — `link_evidence` backfill, the KB-seed regen / `scored:false` re-add, the `scored` chokepoint filter, read-path `ORDER BY`, `metric_validity` rendering, evidence tokens, `exclusion_reason` DB write, `directionApplicability` content field + genu conditioning → PR2b/PR3.

**2. Placeholder scan:** every code/SQL step contains real content; migrations are full SQL, helpers/tests are full code. No TBD/TODO.

**3. Type consistency:** `metricValidity(key: string): MetricValidity` (T1) is imported and called identically in `buildFindingRow` (T3); `FindingRow.metric_validity` is `string` (DB TEXT); the four SQL columns added in T4 (`link_evidence`, `scored`, `exclusion_reason`, `direction_applicability`) are schema-only and populated in PR2b; `exclusionReason` (T5) is authored in content and read by nothing in PR2a. `view_used` ternary preserved verbatim from the route.

**4. Invisibility check:** no read-path file is modified (asserted mechanically in T3/T5 build-green steps). PR2a performs **no row-modifying write** on `muscle_imbalance_links` / `exercise_muscles` / `muscles` — both migrations are pure additive `ADD COLUMN`s, which in Postgres 11+ are metadata-only for nullable / constant-default columns (no table rewrite, no heap-tuple relocation), so the unordered link/exercise SELECTs return the same rows **in the same order** as today. (This is why even the UPDATE-only `link_evidence` backfill is deferred: a real UPDATE relocates tuples and could reorder the no-`ORDER BY` chip/related-findings lists; PR2b populates the column and adds deterministic ordering.) `metric_validity` is written only on newly-scored findings going forward (existing rows stay NULL via metadata-only ADD COLUMN — no rewrite, no reorder). The four `muscle_imbalance_links` columns have no reader (link and `/muscles/[slug]` selects are explicit-column). The **one** API-layer delta is intended and backward-compatible: `/api/assessments/[id]` additively returns `metric_validity` through the existing `.select('*')` spread — unrendered (no finding-shape test exists; the page reads only known fields) and the field PR2b consumes. The `LEGACY_SEED_PARITY` suite and the full `vitest run` under `supabase db reset` (T3 Step 6) guard the production data path.
