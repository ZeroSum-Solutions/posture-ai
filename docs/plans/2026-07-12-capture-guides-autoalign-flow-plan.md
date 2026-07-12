# Capture Screen: Live Guides, Auto-Align & Free-Order Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live pose-guided framing, device-local auto-correction, a free-order four-view (front / left-side / right-side / back) capture flow, a per-shot quality score, and per-side aggregate-finding scoring — without changing the privacy model or the deterministic scoring of existing data.

**Architecture:** A single worker-owned pose runtime drives live VIDEO inference for on-camera guides + a translation-only shutter gate; the existing IMAGE landmarker still does review/submit detection, sequenced so the two are never both resident. Auto-correction and the reference grid are **device-local, ephemeral** (report/DB stay landmark-only). The engine scores each side profile independently and emits **one aggregate finding per metric** (worst side) plus per-side observations.

**Tech Stack:** Next.js 16 App Router / React 19, TypeScript, `@mediapipe/tasks-vision@0.10.35` (BlazePose 33), `@posture-ai/engine` workspace pkg, Supabase/Postgres, Zod, Vitest, Playwright.

**Companion spec (authoritative for frozen values):** `docs/plans/2026-07-12-capture-guides-autoalign-flow-design.md` — **§11** governs every exact constant/formula. This plan references §11.x rather than re-stating long formulas (DRY); those references are the spec, not placeholders.

## Global Constraints

- **Determinism preserved.** Engine stays a pure function of its input; no `Date.now()`/RNG in metrics. Bump `ENGINE_VERSION` `2.0.0` → `2.1.0` (side-profile capability). (`packages/posture-engine/src/engine.ts:17`)
- **Scoring byte-identical for existing data.** A single-`side` (no `profileSide`) assessment must produce the exact same findings/score as today. Aggregate scored fields are copied verbatim from the driving observation, incl. `reliable`, with `reliable === (zone !== 'unreliable')` (§11.2).
- **Additive migrations only.** No `view_enum` change, no uniqueness change; new columns nullable; legacy `NULL` renders exactly as today.
- **Privacy is immutable.** No image bytes persisted or POSTed; correction is device-local/ephemeral; the frame POST stays landmark-only. Existing privacy tests must keep passing. (`captures_no_image_bytes CHECK`, `RUNBOOK.md`)
- **Detection channel is raw-only.** Only `rawRepresentativeUrl` / `rawBurstUrls` / `rawPoseFrame` may reach `detectPose`; `displayPreviewUrl` may not (§4.3).
- **Frame validation:** total cap 20, per-`(view, profileSide)` burst cap 5, `profileSide` only on `view === 'side'` (§11.3).
- **Quality gating unchanged:** only `no_person` on a **required** slot (front/side) blocks proceed; missing joints stay warnings (§11.4).
- **Runtime exclusivity:** ≤1 landmarker resident at any instant; awaited teardown before switching backends (§11.1).
- **Single support-base anchor** (§11.6) drives the shutter gate, the quality centering subscore, and display auto-centering.
- **Git:** branch `feat/capture-guides-autoalign` (never commit to `main`); conventional commits; attribution disabled. The bugfix/refactor test lands in the same commit as its change.

---

## Slice 1 — Data model + engine (no UI)

Ships behind existing gates; nothing visible changes. Delivers per-side scoring, the additive migration, and the persistence path, with full back-compat.

### Task 1.1: Engine types — `profileSide`, `SideObservation`, aggregate fields

**Files:**
- Modify: `packages/posture-engine/src/types.ts`
- Test: `packages/posture-engine/__tests__/types.test.ts` (type-level; compile-only assertions)

**Interfaces — Produces:**
- `PoseFrame.profileSide?: 'left' | 'right'`
- `interface SideObservation { profileSide: 'left'|'right'; deviation: number; direction: string; severityPct: number; zone: Zone; confidence: number; reliable: boolean; stabilityScore?: number; uncertaintyDeg?: number; borderline?: boolean }`
- `Finding.observations?: SideObservation[]`, `Finding.drivingProfileSide?: 'left' | 'right'`

- [ ] **Step 1: Write the failing test** — a type-level fixture that only compiles once the fields exist.

```ts
// packages/posture-engine/__tests__/types.test.ts
import { describe, it, expect } from 'vitest'
import type { PoseFrame, Finding, SideObservation } from '../src/types'

describe('per-side types', () => {
  it('accepts profileSide and observations', () => {
    const obs: SideObservation = {
      profileSide: 'left', deviation: 3, direction: 'Forward',
      severityPct: 40, zone: 'warning', confidence: 0.9, reliable: true,
    }
    const frame: Pick<PoseFrame, 'profileSide'> = { profileSide: 'right' }
    const finding: Pick<Finding, 'observations' | 'drivingProfileSide'> = {
      observations: [obs], drivingProfileSide: 'left',
    }
    expect(frame.profileSide).toBe('right')
    expect(finding.observations?.[0].profileSide).toBe('left')
    expect(finding.drivingProfileSide).toBe('left')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm run test -- packages/posture-engine/__tests__/types.test.ts`. Expected: TS compile error / `SideObservation` not exported.

- [ ] **Step 3: Add the fields.** In `types.ts`: add `profileSide?: 'left' | 'right'` to `PoseFrame`; add the `SideObservation` interface after `Finding`; add `observations?: SideObservation[]` and `drivingProfileSide?: 'left' | 'right'` to `Finding`.

- [ ] **Step 4: Run test to verify it passes** — Run: `npm run test -- packages/posture-engine/__tests__/types.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(engine): add profileSide + SideObservation types"`

### Task 1.2: Bind the captured side into the three sagittal metrics

The three side metrics currently pick the **more-visible** side (`useRight = rightX.visibility > leftX.visibility`). Add an optional `profileSide` that, when present, forces the near-side landmark set; absent → today's visibility behavior (back-compat).

**Files:**
- Modify: `packages/posture-engine/src/metrics.ts` (`forwardHeadPosture:25`, `trunkLean:96`, `kneeExtensionBackKnee:253`)
- Test: `packages/posture-engine/__tests__/metrics.side-binding.test.ts`

**Interfaces — Produces:** `forwardHeadPosture(side, profileSide?)`, `trunkLean(side, profileSide?)`, `kneeExtensionBackKnee(side, profileSide?)` where `profileSide` maps `'left'→useRight=false`, `'right'→useRight=true`.

- [ ] **Step 1: Write the failing test** — a frame where the *more visible* side and the *declared* side disagree; assert the declared side's landmarks drive the result.

```ts
// packages/posture-engine/__tests__/metrics.side-binding.test.ts
import { describe, it, expect } from 'vitest'
import { forwardHeadPosture } from '../src/metrics'
import type { PoseFrame } from '../src/types'

// right ear/shoulder are MORE visible but describe a NEUTRAL head;
// left ear/shoulder are less visible but describe a FORWARD head.
const frame: PoseFrame = { view: 'side', landmarks: {
  right_ear: { x: 0.50, y: 0.20, visibility: 0.99 },
  right_shoulder: { x: 0.50, y: 0.40, visibility: 0.99 },
  right_foot_index: { x: 0.55, y: 0.98, visibility: 0.9 },
  right_heel: { x: 0.48, y: 0.98, visibility: 0.9 },
  left_ear: { x: 0.60, y: 0.20, visibility: 0.60 },
  left_shoulder: { x: 0.50, y: 0.40, visibility: 0.60 },
  left_foot_index: { x: 0.55, y: 0.98, visibility: 0.6 },
  left_heel: { x: 0.48, y: 0.98, visibility: 0.6 },
} }

describe('sagittal side binding', () => {
  it('scores the DECLARED left profile even when right is more visible', () => {
    const f = forwardHeadPosture(frame, 'left')
    expect(f.landmarksUsed).toEqual(['left_ear', 'left_shoulder'])
  })
  it('falls back to visibility when profileSide is undefined', () => {
    const f = forwardHeadPosture(frame)
    expect(f.landmarksUsed).toEqual(['right_ear', 'right_shoulder'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm run test -- packages/posture-engine/__tests__/metrics.side-binding.test.ts`. Expected: FAIL (`forwardHeadPosture` takes one arg).

- [ ] **Step 3: Implement.** In each of the three metrics replace the `const useRight = (…visibility) > (…visibility)` line with:

```ts
export function forwardHeadPosture(side: PoseFrame, profileSide?: 'left' | 'right'): Finding {
  // …existing landmark reads…
  const useRight = profileSide ? profileSide === 'right'
    : (rightEar?.visibility ?? 0) > (leftEar?.visibility ?? 0)
  // …unchanged…
}
```
Apply the identical pattern to `trunkLean` (keyed on shoulder visibility; declared-left `landmarksUsed` = `['left_shoulder','left_hip']`) and `kneeExtensionBackKnee` (keyed on knee visibility; declared-left `landmarksUsed` = `['left_hip','left_knee','left_ankle']`). Do not change any other line — `sagittalFacing`, the angle math, and `makeFinding` are untouched. **Extend the test with the same disagreement + undefined-fallback assertions for `trunkLean` and `kneeExtensionBackKnee`, not just forward head** (all three edited metrics must be covered).

- [ ] **Step 4: Run tests** — Run: `npm run test -- packages/posture-engine/__tests__/metrics.side-binding.test.ts` and the existing `engine.test.ts`. Expected: new PASS; existing engine tests still PASS (undefined `profileSide` = old behavior).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(engine): bind profileSide into sagittal metrics (falls back to visibility)"`

### Task 1.3: Worst-side comparator + aggregation helper

**Files:**
- Create: `packages/posture-engine/src/sides.ts`
- Test: `packages/posture-engine/__tests__/sides.test.ts`

**Interfaces — Produces:**
- `toObservation(f: Finding, profileSide: 'left'|'right'): SideObservation`
- `compareSide(a: SideObservation, b: SideObservation): number` (total order, §11.2)
- `aggregateSagittal(left: {finding: Finding; side:'left'} | null, right: {finding: Finding; side:'right'} | null): Finding | null` — picks the worst of two **already-aggregated** per-side findings (each produced by the existing `aggregate()` so per-side burst **stability is preserved**) via `compareSide`, returns one `Finding` whose scored fields (`deviation, severityPct, zone, direction, confidence, viewUsed, reliable`, plus `uncertaintyDeg/stabilityScore/borderline`) are copied from the driving finding, with `observations` = all present sides and `drivingProfileSide` = winner.

- [ ] **Step 1: Write the failing test** covering the §11.2 total order + edges.

```ts
// packages/posture-engine/__tests__/sides.test.ts
import { describe, it, expect } from 'vitest'
import { compareSide } from '../src/sides'
import type { SideObservation } from '../src/types'

const obs = (o: Partial<SideObservation>): SideObservation => ({
  profileSide: 'left', deviation: 0, direction: 'Neutral', severityPct: 0,
  zone: 'maintain', confidence: 1, reliable: true, ...o,
})

describe('compareSide total order (worse first ⇒ negative)', () => {
  it('reliable outranks unreliable', () => {
    expect(compareSide(obs({ reliable: true, zone: 'maintain' }),
                       obs({ reliable: false, zone: 'unreliable' }))).toBeLessThan(0)
  })
  it('then higher severityPct', () => {
    expect(compareSide(obs({ severityPct: 60 }), obs({ severityPct: 40 }))).toBeLessThan(0)
  })
  it('then higher |deviation|', () => {
    expect(compareSide(obs({ severityPct: 40, deviation: 9 }),
                       obs({ severityPct: 40, deviation: 3 }))).toBeLessThan(0)
  })
  it('stable tiebreak left before right', () => {
    expect(compareSide(obs({ profileSide: 'left' }), obs({ profileSide: 'right' }))).toBeLessThan(0)
  })
  it('both unreliable → left wins despite unequal deviations', () => {
    const a = obs({ profileSide: 'right', reliable: false, zone: 'unreliable', deviation: 9 })
    const b = obs({ profileSide: 'left', reliable: false, zone: 'unreliable', deviation: 1 })
    expect(compareSide(a, b)).toBeGreaterThan(0) // b (left) wins despite a's larger deviation
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm run test -- packages/posture-engine/__tests__/sides.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `sides.ts`.**

```ts
import type { PoseFrame, Finding, SideObservation } from './types'

export function toObservation(f: Finding, profileSide: 'left' | 'right'): SideObservation {
  return {
    profileSide, deviation: f.deviation, direction: f.direction,
    severityPct: f.severityPct, zone: f.zone, confidence: f.confidence,
    reliable: f.reliable,
    ...(f.stabilityScore !== undefined ? { stabilityScore: f.stabilityScore } : {}),
    ...(f.uncertaintyDeg !== undefined ? { uncertaintyDeg: f.uncertaintyDeg } : {}),
    ...(f.borderline ? { borderline: true } : {}),
  }
}

// Returns <0 when a is WORSE (should win) than b. Total order per spec §11.2.
export function compareSide(a: SideObservation, b: SideObservation): number {
  if (a.reliable !== b.reliable) return a.reliable ? -1 : 1
  // §11.2 special case: both unreliable → left deterministically (unreliable
  // severityPct is 0 and unreliable deviations aren't meaningfully comparable).
  if (!a.reliable && !b.reliable)
    return a.profileSide === 'left' ? -1 : b.profileSide === 'left' ? 1 : 0
  if (a.severityPct !== b.severityPct) return b.severityPct - a.severityPct
  const ad = Math.abs(a.deviation), bd = Math.abs(b.deviation)
  if (ad !== bd) return bd - ad
  return a.profileSide === b.profileSide ? 0 : a.profileSide === 'left' ? -1 : 1
}

// Takes findings ALREADY aggregated per side (median + withStability, via the
// engine's existing aggregate()) so per-side burst stability is never lost.
export function aggregateSagittal(
  left: { finding: Finding; side: 'left' } | null,
  right: { finding: Finding; side: 'right' } | null,
): Finding | null {
  const parts = [left, right].filter(Boolean) as { finding: Finding; side: 'left' | 'right' }[]
  if (parts.length === 0) return null
  const observations = parts.map(p => toObservation(p.finding, p.side))
  const winnerIdx = observations
    .map((o, i) => [o, i] as const)
    .sort(([a], [b]) => compareSide(a, b))[0][1]
  const driver = parts[winnerIdx].finding
  return { ...driver, observations, drivingProfileSide: parts[winnerIdx].side }
}
```

- [ ] **Step 4: Run tests** — Run: `npm run test -- packages/posture-engine/__tests__/sides.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(engine): deterministic worst-side comparator + aggregation"`

### Task 1.4: Engine — per-side grouping + aggregate; bump version

**Files:**
- Modify: `packages/posture-engine/src/engine.ts` (`assessPosture:53`, findings array `:82`, `ENGINE_VERSION:17`)
- Test: `packages/posture-engine/__tests__/engine.per-side.test.ts`

- [ ] **Step 1: Write the failing test** — two side frames (L and R) with different forward-head deviations; assert one aggregate finding = worst side, with both observations; and that a single legacy `side` frame is unchanged.

```ts
// packages/posture-engine/__tests__/engine.per-side.test.ts
import { describe, it, expect } from 'vitest'
import { assessPosture } from '../src/engine'
import { forwardHeadPosture } from '../src/metrics'
import type { PoseFrame } from '../src/types'
// helper builds a side frame with a given forward-head magnitude on its near side
function sideFrame(profileSide: 'left'|'right', fhpDeg: number): PoseFrame { /* …construct ear/shoulder so the near side yields ~fhpDeg forward… */ return /* … */ }

describe('per-side engine', () => {
  it('emits ONE forward_head finding = worst side, with both observations', () => {
    const r = assessPosture([sideFrame('left', 2), sideFrame('right', 8)])
    const fhp = r.findings.filter(f => f.key === 'forward_head_posture')
    expect(fhp).toHaveLength(1)
    expect(fhp[0].drivingProfileSide).toBe('right')
    expect(fhp[0].observations?.map(o => o.profileSide).sort()).toEqual(['left','right'])
  })
  it('legacy side input is byte-identical to pre-change scoring', () => {
    const legacy = sideFrame('right', 8); delete (legacy as any).profileSide
    const r = assessPosture([legacy])
    const fhp = r.findings.find(f => f.key === 'forward_head_posture')!
    const direct = forwardHeadPosture(legacy) // same metric run on the raw frame
    expect(fhp.observations).toBeUndefined()
    expect(fhp.drivingProfileSide).toBeUndefined()
    expect({ deviation: fhp.deviation, severityPct: fhp.severityPct, zone: fhp.zone,
             direction: fhp.direction, reliable: fhp.reliable })
      .toEqual({ deviation: direct.deviation, severityPct: direct.severityPct, zone: direct.zone,
                 direction: direct.direction, reliable: direct.reliable })
  })
  // The existing engine.test.ts + golden suite (frozen expected values) must also
  // stay green — that is the authoritative byte-identical guarantee for score/ranks.
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test -- packages/posture-engine/__tests__/engine.per-side.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement grouping.** In `assessPosture`, after the `side` filter, split by profileSide and route the three sagittal metrics through `aggregateSagittal`, preserving the legacy path when no `profileSide` present:

```ts
import { aggregateSagittal } from './sides'
// …
const side = frames.filter(f => f.view === 'side')
const sideLeft = side.filter(f => f.profileSide === 'left')
const sideRight = side.filter(f => f.profileSide === 'right')
const hasProfiles = sideLeft.length > 0 || sideRight.length > 0

// Aggregate EACH side through the existing aggregate() (median + withStability)
// so per-side burst stability is preserved, THEN pick the worst. Validation
// (Task 1.5) rejects mixing unspecified-side with named-side frames, so when
// !hasProfiles every side frame is legacy → byte-identical to today.
const sag = (m: (f: PoseFrame, s?: 'left' | 'right') => Finding) => {
  if (!hasProfiles) return aggregate(side, (f) => m(f)) // legacy path unchanged
  const l = sideLeft.length ? aggregate(sideLeft, (f) => m(f, 'left')) : null
  const r = sideRight.length ? aggregate(sideRight, (f) => m(f, 'right')) : null
  return aggregateSagittal(l ? { finding: l, side: 'left' } : null, r ? { finding: r, side: 'right' } : null)
}
```
Replace the three `aggregate(side, forwardHeadPosture|trunkLean|kneeExtensionBackKnee)` entries in the `findings` array with `sag(forwardHeadPosture)`, `sag(trunkLean)`, `sag(kneeExtensionBackKnee)`. Bump `ENGINE_VERSION = '2.1.0'`. Per-side burst stability is preserved because each side is run through the existing `aggregate()` (median + `withStability`) before the worst-side pick; a single-frame side carries no stability, matching today.

- [ ] **Step 4: Run tests** — Run: `npm run test -- packages/posture-engine` (whole engine suite). Expected: new PASS; **all existing engine/golden/stability tests still PASS** (legacy path unchanged).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(engine): per-side sagittal grouping → aggregate finding + observations (2.1.0)"`

### Task 1.5: Frame validation — `profileSide`, cap 20, cross-field

**Files:**
- Modify: `lib/validation/frames.ts` (`frameSchema:40`, `MAX_BURST_PER_VIEW:61`, total cap `:69`, superRefine `:70`)
- Test: `lib/validation/frames.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** — (a) a `side` frame with `profileSide:'left'` is accepted; (b) `profileSide` on a `front` frame is rejected; (c) 4 views × 5 = 20 frames accepted; (d) 6 same-`(view,profileSide)` frames rejected.

```ts
// add to lib/validation/frames.test.ts
it('accepts profileSide on side frames and rejects it on front', () => {
  const ok = parseAssessmentPayload({ client_id: UUID, frames: [sideFrame({ profileSide: 'left' })] }, { testModeEnabled: false })
  expect(ok.ok).toBe(true)
  const bad = parseAssessmentPayload({ client_id: UUID, frames: [frontFrame({ profileSide: 'left' })] }, { testModeEnabled: false })
  expect(bad.ok).toBe(false)
})
it('caps at 20 total and 5 per (view, profileSide)', () => {
  expect(parseAssessmentPayload({ client_id: UUID, frames: twentyValidFrames() }, { testModeEnabled: false }).ok).toBe(true)
  expect(parseAssessmentPayload({ client_id: UUID, frames: sixLeftSideFrames() }, { testModeEnabled: false }).ok).toBe(false)
})
```

- [ ] **Step 2: Run to verify fails** — Run: `npm run test -- lib/validation/frames.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `frameSchema` add `profileSide: z.enum(['left','right']).optional()` and a `.superRefine` rejecting `profileSide` unless `view === 'side'`. Change `MAX_BURST_PER_VIEW` cap usage: total `.max(4 * MAX_BURST_PER_VIEW)`; in the array `.superRefine`, key the per-group counter on `` `${f.view}:${f.profileSide ?? ''}` `` instead of `f.view`. **Also reject a payload that mixes an unspecified-side frame (`view==='side' && !profileSide`) with any named-side frame** — the engine can't group mixed legacy+per-side capture, so it must be a validation error (not silently dropped). Add a test asserting a `{side, no profileSide}` + `{side, profileSide:'left'}` payload is rejected.

- [ ] **Step 4: Run tests** — Run: `npm run test -- lib/validation/frames.test.ts`. Expected: PASS (incl. existing).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(validation): profileSide + 20-frame cap + cross-field guard"`

### Task 1.6: Additive migration

**Files:**
- Create: `supabase/migrations/20260712000000_per_side_observations.sql`
- Test: covered by Task 1.7/1.8 round-trip + `npm run typecheck`; add a lightweight SQL presence check if the repo has a migration test harness.

- [ ] **Step 1: Write the migration** (exact, §11.3):

```sql
-- Per-side capture profiles + aggregate-finding observations (additive; no enum/uniqueness change)
ALTER TABLE captures ADD COLUMN IF NOT EXISTS profile_side TEXT NULL
  CHECK (profile_side IN ('left','right'));
ALTER TABLE captures ADD CONSTRAINT captures_profile_side_only_side
  CHECK (profile_side IS NULL OR view = 'side');
ALTER TABLE assessment_findings ADD COLUMN IF NOT EXISTS observations jsonb NULL;
```

- [ ] **Step 2: Apply to the local stack** — Run: `supabase db reset` (or the repo's migrate script). Expected: applies cleanly; existing rows get `NULL`.
- [ ] **Step 3: Regenerate types if the repo tracks them** — Run the repo's `generate:types` script if present; otherwise skip.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(db): additive profile_side + observations columns"`

### Task 1.7: Persistence adapters — write + read observations

**Files:**
- Modify: `lib/findings/buildFindingRow.ts` (`FindingRow`, `buildFindingRow`), `lib/findings/storedFindingToEngine.ts` (`StoredFinding`, `toEngineFinding`)
- Test: `lib/findings/observations.test.ts`

- [ ] **Step 1: Write the failing test** — a finding with observations round-trips into a row `{ observations: { sides, drivingProfileSide } }`; a finding without observations → `observations: null`; `toEngineFinding` ignores observations for program reconstruction (aggregate-only) and a legacy row (no observations) rebuilds unchanged.

```ts
// lib/findings/observations.test.ts
import { describe, it, expect } from 'vitest'
import { buildFindingRow } from './buildFindingRow'
import { toEngineFinding } from './storedFindingToEngine'

it('serializes observations as { sides, drivingProfileSide }', () => {
  const row = buildFindingRow(findingWithTwoSides(), 'a', 'p')
  expect(row.observations).toEqual({ sides: expect.any(Array), drivingProfileSide: 'right' })
})
it('null when no observations', () => {
  expect(buildFindingRow(plainFinding(), 'a', 'p').observations).toBeNull()
})
it('toEngineFinding rebuilds aggregate; ignores observations', () => {
  const f = toEngineFinding({ ...storedRow(), observations: { sides: [], drivingProfileSide: 'left' } })
  expect(f.severityPct).toBe(storedRow().severity_pct)
})
```

- [ ] **Step 2: Run to verify fails** — Run: `npm run test -- lib/findings/observations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `observations: { sides: SideObservation[]; drivingProfileSide: 'left'|'right' } | null` to `FindingRow`; in `buildFindingRow` set it from `f.observations && f.drivingProfileSide` else `null`. Add optional `observations` to `StoredFinding`; `toEngineFinding` keeps building the aggregate `Finding` as today (program reconstruction is aggregate-only — add a one-line comment; do not thread observations into program logic).
- [ ] **Step 4: Run tests** — Run: `npm run test -- lib/findings`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(findings): persist + read per-side observations (aggregate-only program logic)"`

### Task 1.8: API — insert `profile_side`; GET de-dup by `(view, profile_side)`

**Files:**
- Modify: `app/api/assessments/route.ts` (capture insert `:110-153`, findings insert)
- Modify: `app/api/assessments/[id]/route.ts` (select `:64`, capture de-dupe `:97-107`)
- Test: extend `e2e/assessment-flow.spec.ts` (test-mode) or an integration test if present

- [ ] **Step 1: Write the failing assertion** — POST a 4-view (L+R side) test-mode assessment; GET returns two distinct side captures (left + right), not one collapsed `side`.
- [ ] **Step 2: Run to verify fails.**
- [ ] **Step 3: Implement.** POST: include `profile_side: frame.profileSide ?? null` on capture inserts (side only); persist finding `observations`. GET: add `profile_side` to the capture `select`; change the capture de-dupe key from `view` to `` `${view}:${profile_side ?? ''}` ``; **and include `profile_side` in the mapped capture JSON + the `Capture` type** so callers can tell left from right (two indistinguishable `{view:'side'}` rows is the bug). The results consumer at `app/assessments/[id]/page.tsx:906` (which takes the first side row) must select by `profile_side`. The `(view, profile_side)` key does not break front/back — their `NULL` profile still yields one key per view.
- [ ] **Step 3b: Assert laterality** — the GET test asserts the two returned side captures have **distinct** `profile_side` values (`left` and `right`), not merely that two side rows exist.
- [ ] **Step 4: Run** the e2e/integration test + `npm run test`. Expected: PASS; existing single-side flow unaffected (legacy `NULL`).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(api): persist profile_side + observations; GET de-dup by (view, profile_side)"`

### Task 1.9: Golden + fixtures — L/R cases + back-compat

**Files:**
- Modify: `packages/posture-engine/golden/cases.ts` (+ L/R sagittal cases), `packages/posture-engine/golden/synthetic.ts` (emit `profileSide`), `packages/posture-engine/fixtures/test-landmarks.json` (add a `profileSide` on the side entry OR keep legacy + add a paired fixture)
- Test: `npm run golden`

- [ ] **Step 1: Add** a `left`+`right` sagittal golden case with known asymmetric forward-head/trunk-lean so `aggregateSagittal` picks the worse; keep an existing legacy `side` case untouched to prove back-compat.
- [ ] **Step 2: Run** `npm run golden`. Expected: MAE within `DRIFT_TOL` of baseline for unchanged cases; new cases produce the analytic worst-side deviation.
- [ ] **Step 3: Accept** new baselines only if intentional: `npm run golden -- --accept` (review the diff first).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(golden): L/R sagittal cases + back-compat"`

**Slice 1 gate:** `npm run test && npm run golden && npm run typecheck && npm run lint` all green; then Codex GPT-5.6 (xhigh) review of the slice diff before land.

---

## Slice 2 — Free-order four-view capture flow

Uses today's (post-capture) detection; no worker yet. Delivers the 4-tile free-order UI, the capture-race guard, and object-URL memory.

### Task 2.1: Slot keys + capture state

**Files:** Modify `app/assessments/new/types.ts` (`ViewKey`→`CaptureSlotKey='front'|'side-left'|'side-right'|'back'`, `VIEW_ORDER`, `VIEW_LABEL`, `CaptureSlot`), `app/assessments/new/page.tsx` (`Captures` record over 4 keys). Test: `app/assessments/new/__tests__/slots.test.ts`.
- [ ] TDD: test that `Captures` has 4 slots and each side slot carries `profileSide`; map slot→`{ view, profileSide }` (`side-left`→`{view:'side',profileSide:'left'}`). Add `rawRepresentativeUrl/rawBurstUrls/rawPoseFrame/displayPreviewUrl/correction/captureId` to `CaptureSlot` (raw channels per Global Constraints). Commit `feat(capture): four free-order slot keys + raw/display channels`.

### Task 2.2: Tile strip UI (free order + retake)

**Files:** Modify `app/assessments/new/FullScreenCapture.tsx` (`ViewSilhouette:49`, status strip, `selectView:401`, `nextUncapturedAfter:362`). Test: e2e `capture-camera.spec.ts` (test-mode).
- [ ] TDD/e2e: all four tiles selectable any time; captured tile shows thumbnail; one-tap retake re-enters live for that slot; mirror the side silhouette for L/R. Requiredness: front + both sides required, back optional. Commit `feat(capture): free-order four-view tile strip`.

### Task 2.3: Capture-race guard + object-URL memory

**Files:** Modify `FullScreenCapture.tsx` (`capture:262-303`, `useThisPhoto:371`, `retakeStill:392`), `page.tsx` (slot commit `:228-239`). Test: `__tests__/capture-race.test.ts`.
- [ ] TDD: snapshot the slot key + fresh `captureId` at shutter; `isCapturing` disables tile nav + shutter until burst+correction complete; correction/preflight keyed to `captureId`. Replace base64 data-URL long-lived state with `Blob` object URLs; revoke on retake/unmount; assert no view mis-association under a simulated mid-burst tile tap. Commit `fix(capture): race guard + object-URL memory (immutable captureId)`.

**Slice 2 gate:** tests green; Codex review of the diff.

---

## Slice 3 — Worker live runtime + overlay transform + guides + gate

### Task 3.1: `detect.ts` lifecycle — promise + close

**Files:** Modify `lib/pose/detect.ts` (`warmUpLandmarker:93`, singleton `:47`). Test: `lib/pose/detect.lifecycle.test.ts` (mock tasks-vision).
- [ ] TDD: `warmUpLandmarker(): Promise<void>`; add `closeLandmarker(): Promise<void>` calling `landmarker.close()` + nulling the singleton promise; a construction counter proves re-warm after close creates exactly one. Commit `feat(pose): closeable IMAGE landmarker lifecycle`.

### Task 3.2: Support-base anchor helper

**Files:** Create `lib/capture/support-anchor.ts`. Test: `lib/capture/support-anchor.test.ts`.
- [ ] TDD (freeze §11.6): `supportAnchorX(landmarks): number | null` — ankles-if-both≥floor → heels-if-both≥floor → null. Deterministic; unit-tested for each branch + the null case. Commit `feat(capture): support-base anchor (feet→heel→null)`.

### Task 3.3: Overlay affine

**Files:** Create `lib/capture/overlay-transform.ts`. Test: `lib/capture/overlay-transform.test.ts`.
- [ ] TDD (§11.7 WARN): `sourceToViewport({srcW,srcH,vpW,vpH,mirror})` → affine; `scale = max(vpW/srcW, vpH/srcH)`, centered cover offsets, mirror only when the displayed video is mirrored (capture uses environment camera → `mirror=false`); round-trip test (map a point, invert, recover). Commit `feat(capture): cover-crop overlay affine`.

### Task 3.4: Live worker

**Files:** Create `lib/pose/live-worker.ts` + `lib/pose/capture-runtime.ts`. Test: `lib/pose/capture-runtime.test.ts`.
- [ ] TDD (§11.1): worker owns one lite VIDEO `PoseLandmarker`; in-flight guard + monotonic timestamps + generation token + `currentTime` dedup; every `ImageBitmap` closed. `capture-runtime.ts` implements the awaited state machine `closed→live-video→closed→review-image→closed`; **residency-counter invariant test proves ≤1 landmarker resident** across live→review→next-view×4→submit incl. error/visibility/unmount. Remove the eager warm at `page.tsx:86`; route review-detection (`FullScreenCapture.tsx:334`) + preflight (`page.tsx:175`) through the runtime owner. Commit `feat(pose): worker live runtime + single-runtime state machine`.

### Task 3.5: On-camera guides + coaching + translation-only gate

**Files:** Modify `FullScreenCapture.tsx` (SVG overlay `:496-504`, shutter gate `:595-603`). Test: e2e overlay render (test-mode) + a gate unit test.
- [ ] TDD (§4.2, §11.6): draw center line, sensor level line, framing lines, and the **non-gating** tracking midline via the overlay affine; coaching messages; shutter gate = `tilt AND |anchorX−0.5|≤tol AND in-frame`, manual override preserved; **gate independent of midline angle** — deformation test: fix `anchorX`, vary lean/shoulder/head/knee → gate decision unchanged; when `anchorX===null`, gate on tilt+framing only. Commit `feat(capture): live guides + coaching + translation-only shutter gate`.

**Slice 3 gate:** tests green; **real-device evidence** (iPhone Safari + mid/low Android Chrome: init time, inference p95, long-task count, dropped frames, memory/context-loss, sustained four-view session); Codex review of the diff.

---

## Slice 4 — Device-local auto-correction + reference grid + quality score

### Task 4.1: No-crop correction transform

**Files:** Create `lib/capture/correction.ts`. Test: `lib/capture/correction.test.ts`.
- [ ] TDD (§11.5): compose rotation (sign per `geometry.ts:41-58`) + anchor-centering into an anchor-centered canvas sized `2·max|corner−anchor|` per axis. **Two property tests over roll×offset:** (i) every source corner ∈ destination bounds (no crop); (ii) the anchor maps to the destination center (centering happens). `anchorX===null` → straighten only. Commit `feat(capture): no-crop anchor-centered correction`.

### Task 4.2: Quality score

**Files:** Create `lib/pose/quality-score.ts`; extend `lib/pose/quality.ts` (near-side required-joint lists). Test: `lib/pose/quality-score.test.ts`.
- [ ] TDD (§11.4, frozen): `scoreFrameQuality(frame, view, profileSide, rollDeg) → { score, factors:{framing,joints,level}, warnings, blocked }`; freeze subscores exactly (joints 0–35, framing = span15+centering15+inFrame10, level 0–25; visibility floor 0.5; missing-signal → 0 + warning; `rollDeg===null`→level 18). `blocked` true **iff** `no_person` on a required slot. Fixture tests per band + each missing-signal case + the upload (`rollDeg===null`) case. Commit `feat(pose): frozen 0–100 quality score (gating unchanged)`.

### Task 4.3: Review UI — corrected shot + reference grid + score breakdown

**Files:** Modify `FullScreenCapture.tsx` (review phase `:334-348`, `:506-510`). Test: e2e review render.
- [ ] Wire: review shows the device-local corrected bitmap (Task 4.1) on a plumb-line/level reference grid with the non-gating midline; score breakdown (Person ✓ · Full body ✓ · Centered ✓ · Level ✓) from Task 4.2; hard-fail (`no_person`) blocks, soft warns. **Detection still runs on the raw representative only** (Global Constraints). Commit `feat(capture): device-local corrected review on reference grid + score breakdown`.

**Slice 4 gate:** tests green; privacy test asserts **no image bytes in the POST body**; Codex review of the diff.

---

## Slice 5 — Results surfacing of per-side observations

Bridges into Task 4 (results redesign). Read-only display of what Slice 1 persisted.

### Task 5.1: Results page — per-side observations block

**Files:** Modify `app/assessments/[id]/page.tsx` (finding types `:21`, `FindingCard:374`). Test: component/e2e.
- [ ] TDD: `FindingCard` renders the aggregate finding as today **plus** a "Left / Right" observation row when `observations` present; `NULL` renders exactly as today (back-compat). Commit `feat(results): show per-side observations on findings`.

### Task 5.2: PDF — per-side in the practitioner report

**Files:** Modify `app/api/reports/route.ts` (`PdfFinding` map `:212`), `lib/pdf/report.tsx` (`:265`). Test: `npm run test` PDF snapshot if present.
- [ ] TDD: `PdfFinding` carries optional observations; the practitioner PDF prints per-side values; aggregate still drives all program/comparison/workout logic; no capture imagery (privacy). Commit `feat(pdf): per-side observations in practitioner report`.

**Slice 5 gate:** tests green; Codex review; then `~/bin/zs-land` (owned repo) once the full suite + `npm run golden` are green.

---

## Must-fix when authoring Slices 2–4 (from the 2026-07-12 plan review)

Recorded so they aren't lost; each is applied when its slice's tasks are expanded to full step detail:

- **Slice 2 — attach `profileSide` on every submission path.** Add an explicit slot→domain frame builder (`side-left`→`{view:'side',profileSide:'left'}`, etc.) and thread it through **preflight** (`page.tsx:175`), **submit** (`page.tsx:275`), the burst, and any cached-frame path — else both side slots POST as legacy `view:'side'`, blowing the 5-per-`(view,profileSide)` cap and medianing L+R together. Test every submission path.
- **Slice 2 — kill order-based terminal behavior.** Replace "Back captured ⇒ auto-proceed" (`FullScreenCapture.tsx:362,384`) with readiness derived from **front + left-side + right-side present** (back optional), independent of capture order.
- **Slice 3 — freeze the shutter gate.** Pin `tol` (centering tolerance), the boolean definition of "in-frame," and whether manual override bypasses **tilt only** or **all** gates. Gating-affecting; don't leave to the implementer.
- **Slice 3 — enumerate every detection call in the runtime state machine.** Task 3.4 must include **submit's** direct `detectPose` calls (`page.tsx:272`) and close IMAGE afterward; make `useThisPhoto`/parent-preflight awaitable (today preflight is fire-and-forget and live starts immediately).
- **Spec §11.6 — make the anchor 2D.** §11.5 needs `A.y`/height; a scalar `anchorX` is insufficient. Freeze `anchor = { x, y }` = ankle-midpoint (→ heel-midpoint → null), or define horizontal-only centering with an explicit separate vertical pivot.
- **Spec §11.4 — correct the `no_person` definition.** Current `quality.ts` counts *populated landmark keys regardless of visibility* (`quality.ts:97`), not "≥4 landmarks at visibility ≥0.5." Restate §11.4's `blocked` rule to the actual repo rule so "exactly as today" is literally true (or explicitly approve a gating change and update both quality implementations + callers).
- **Slice 4 — the review must use `contain`, not `cover`.** Task 4.3 must switch the review image from `objectFit:'cover'` (`FullScreenCapture.tsx:509`) to `contain` + letterbox, else it re-crops the no-crop canvas. Test visible corner preservation.
- **Slice 1 follow-up — contradiction detector (§11.7 WARN).** A mislabeled profile is currently scored from the declared (possibly less-visible) side with no warning. Add a WARN-level task: if the declared near-side landmarks are materially less visible than the far-side (freeze the visibility-delta + min count), emit an indeterminate/quality warning — never silently swap.

## Deferred / follow-ups (not this plan)

- Mobile (`mobile/src/CameraCaptureScreen.tsx`, `poseFrameSource.ts`) still assumes front+side — a separate mobile slice mirrors Slices 2–4.
- Contradiction detector (§11.7) — declared near-side materially less visible than far-side → indeterminate + warn — can land as a WARN-level task inside Slice 1 (Task 1.2 follow-up) or Slice 3; freeze the visibility-delta threshold when implemented.
- Cross-assessment before/after → results redesign (Task 4 of the master brief).

## Self-review (done)

- **Spec coverage:** every §11.1–11.7 freeze maps to a task (11.1→3.1/3.4, 11.2→1.3, 11.3→1.6/1.7/1.8, 11.4→4.2, 11.5→4.1, 11.6→3.2/3.5, 11.7→3.3/3.4/1.5 + deferred contradiction detector). §9 build order preserved.
- **Type consistency:** `SideObservation`, `aggregateSagittal`, `compareSide`, `supportAnchorX`, `scoreFrameQuality`, `sourceToViewport`, `closeLandmarker` names are used consistently across producing/consuming tasks.
- **No placeholders:** logic-bearing tasks (1.2–1.5, 1.7, 3.1–3.4, 4.1–4.2) carry real code/tests; wiring tasks carry exact files + steps + the §11 frozen values they must implement.
