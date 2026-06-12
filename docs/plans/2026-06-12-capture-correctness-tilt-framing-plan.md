# Capture Correctness: Tilt Correction + Framing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure camera roll at capture, gate/guide the user to a level shot, de-rotate and aspect-correct landmarks centrally in the scoring engine, add framing checks, and honestly flag uploads as level-unverified.

**Architecture:** Capture metadata (`captureRollDeg`, `aspectRatio`, `source`) rides on the existing `PoseFrame` from the wizard through Zod validation into the engine, where a single immutable `normalizeFrame` transform (aspect-correct + de-rotate) runs before all 10 metrics. Result gains `tiltCorrected`/`levelVerified` flags, persisted on the `assessments` row and surfaced as a badge.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Vitest 3, Playwright, Supabase (Postgres), MediaPipe tasks-vision (unchanged), DeviceOrientationEvent.

**Spec:** `docs/plans/2026-06-12-capture-correctness-tilt-framing-design.md`

**Branch:** `feat/capture-correctness` (already created; design doc committed).

---

## Conventions & facts the engineer needs

- **Run unit tests from repo root:** `npx vitest run <path>` (root `vitest.config.ts` picks up `packages/posture-engine/__tests__` and `lib/**`; environment is `node`, alias `@` → repo root).
- **Typecheck:** `npm run typecheck`. **Lint:** `npm run lint`.
- **Engine package:** `packages/posture-engine`, imported as `@posture-ai/engine` (subpath exports `/types`, `/geometry`, `/thresholds` exist already).
- **Immutability rule (project):** never mutate input objects; return new ones.
- **Conventional commits**, no attribution footer.
- **Math conventions used throughout** (derived in the spec; sign self-consistent):
  - Image/screen coords: x right, y down, normalized 0–1. `aspectRatio = width/height` (camera portrait = 720/960 = 0.75).
  - Aspect correction: `x' = x * aspectRatio`, `y' = y` puts both axes in height-fraction units; angles computed by the existing metric `atan2` math become true physical angles.
  - `captureRollDeg` is **positive when the phone's top edge is tilted to the photographer's right**. Correction rotates each aspect-corrected landmark about the image centre with the y-down matrix `[x', y'] = [dx·cosθ − dy·sinθ, dx·sinθ + dy·cosθ]`, θ = `captureRollDeg`.
  - Sensor mapping (robust against the β≈90° Euler gimbal lock): reconstruct gravity in device coords from W3C `deviceorientation` angles: `g = (cosβ·sinγ, −sinβ, −cosβ·cosγ)`. Then `rollDeg = atan2(g_x, −g_y)`, `pitchDeg = asin(clamp(−g_z))`. At upright portrait level (β=90, γ=0): roll 0, pitch 0. This refines spec §4.1 ("roll ≈ gamma"), which is unstable at β≈90; the gravity projection is exact. The 75–105° beta window in the spec maps to `|pitchDeg| ≤ 15`.
- **Calibration deviation from spec §4.2 (intentional):** spec says head-top→ankle span 70–90% of frame height. MediaPipe has no head-top landmark; we measure **eye/ear-to-ankle** span. The canonical fixture (which must keep passing `quality.test.ts` as `ok`) spans 0.865–0.885, and real heels/feet extend below ankles, so the operational thresholds are **0.65 ≤ span ≤ 0.95** on the measured eye-to-ankle span (0.65 ≈ the spec's 70% head-to-ankle minimum; 0.95 still leaves margin and genuinely cut-off bodies trip the out-of-frame check).
- **Golden-value shift (intentional, spec §6):** with `aspectRatio: 0.75` attached, the canonical fixture moves to `ranks.front = 21`, `ranks.side = 29` (overallScore stays 25, grade B, percentile 75); `forward_head_posture` 11.63°→8.78°, `anterior_imbalanced_shoulders` 2.90°→3.87°, `t1_tilt_backward` 3.69°→2.77° (**zone flips warning→maintain**). Frames *without* `aspectRatio` are untouched (aspect defaults to 1), so all existing fixtures/tests keep their current values.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/posture-engine/src/types.ts` | modify | `PoseFrame` optional capture metadata; `AssessmentResult` flags |
| `packages/posture-engine/src/geometry.ts` | modify | `rotatePoint`, `normalizeFrame` (pure, immutable) |
| `packages/posture-engine/src/engine.ts` | modify | apply `normalizeFrame`, compute flags, bump `ENGINE_VERSION` |
| `packages/posture-engine/__tests__/normalize.test.ts` | create | transform units, equivalence, golden values |
| `lib/validation/frames.ts` (+ `.test.ts`) | modify | Zod schema for the new optional fields |
| `lib/capture/orientation-math.ts` (+ `.test.ts`) | create | pure β/γ → roll/pitch math |
| `lib/capture/use-camera-level.ts` (+ `.test.tsx`) | create | DeviceOrientation hook: permission, listener, graceful degradation |
| `lib/pose/quality.ts` (+ `.test.ts`) | modify | geometric framing checks (span, centering, in-frame) |
| `lib/pose/detect.ts` | modify | attach `aspectRatio` + `source` to detected frames |
| `lib/pose/normalize-upload.ts` | create | EXIF-orientation normalization + size cap for uploads |
| `app/assessments/new/page.tsx` | modify | level gate UI, roll threading, upload normalization, slot note |
| `supabase/migrations/20260612050000_capture_level_flags.sql` | create | `assessments.tilt_corrected`, `assessments.level_verified` |
| `app/api/assessments/route.ts` | modify | persist flags + real capture source |
| `app/api/assessments/[id]/route.ts` | modify | return flags + per-capture roll |
| `app/assessments/[id]/page.tsx` | modify | level/tilt badge |
| `e2e/assessment-flow.spec.ts` | modify | badge assertion on fixture path |
| `e2e/capture-errors.spec.ts` | modify | camera degrades gracefully without sensors |

---

### Task 1: Engine geometry — `rotatePoint` + `normalizeFrame`

**Files:**
- Modify: `packages/posture-engine/src/types.ts`
- Modify: `packages/posture-engine/src/geometry.ts`
- Test: `packages/posture-engine/__tests__/normalize.test.ts` (new)

- [ ] **Step 1: Add the optional metadata fields to `PoseFrame`**

In `packages/posture-engine/src/types.ts`, replace the `PoseFrame` interface:

```ts
export interface PoseFrame {
  view: ViewLabel
  landmarks: Record<string, Landmark>
  /**
   * Signed camera roll in degrees, measured by device sensors at the capture
   * instant. Present only for sensor-verified live captures. Positive = the
   * phone's top edge was tilted to the photographer's right.
   */
  captureRollDeg?: number
  /** Image width / height (e.g. 0.75 for 720×960 portrait). */
  aspectRatio?: number
  source?: 'camera' | 'upload'
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/posture-engine/__tests__/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { PoseFrame, Landmark } from '../src/types'
import { rotatePoint, normalizeFrame } from '../src/geometry'

const EPS = 1e-6

function close(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps
}

describe('rotatePoint', () => {
  it('rotates 90° about the pivot in y-down screen coords', () => {
    // Point directly ABOVE the pivot (dy = -0.3). θ=90 → dx' = -dy·sin90 = +0.3
    const p = rotatePoint({ x: 0.5, y: 0.2 }, 90, { x: 0.5, y: 0.5 })
    expect(close(p.x, 0.8)).toBe(true)
    expect(close(p.y, 0.5)).toBe(true)
  })

  it('round-trips: rotate by θ then −θ returns the original point', () => {
    const orig: Landmark = { x: 0.37, y: 0.81, z: 0.1, visibility: 0.9 }
    const there = rotatePoint(orig, 12.5, { x: 0.375, y: 0.5 })
    const back = rotatePoint(there, -12.5, { x: 0.375, y: 0.5 })
    expect(close(back.x, orig.x)).toBe(true)
    expect(close(back.y, orig.y)).toBe(true)
  })

  it('does not mutate the input and preserves z/visibility', () => {
    const orig: Landmark = { x: 0.4, y: 0.6, z: -0.2, visibility: 0.7 }
    const out = rotatePoint(orig, 30, { x: 0.5, y: 0.5 })
    expect(orig).toEqual({ x: 0.4, y: 0.6, z: -0.2, visibility: 0.7 })
    expect(out).not.toBe(orig)
    expect(out.z).toBe(-0.2)
    expect(out.visibility).toBe(0.7)
  })
})

describe('normalizeFrame', () => {
  it('returns the same frame reference when no aspectRatio and no roll', () => {
    const f: PoseFrame = { view: 'front', landmarks: { nose: { x: 0.5, y: 0.1 } } }
    expect(normalizeFrame(f)).toBe(f)
  })

  it('aspect-corrects x by width/height and leaves y unchanged', () => {
    const f: PoseFrame = {
      view: 'front',
      aspectRatio: 0.75,
      landmarks: { nose: { x: 0.4, y: 0.3, visibility: 0.9 } },
    }
    const out = normalizeFrame(f)
    expect(close(out.landmarks.nose.x, 0.3)).toBe(true)
    expect(close(out.landmarks.nose.y, 0.3)).toBe(true)
    // input untouched
    expect(f.landmarks.nose.x).toBe(0.4)
  })

  it('de-rotates by captureRollDeg about the aspect-corrected centre', () => {
    // A vertical subject photographed with the camera rolled +10°
    // (top tilted right) appears tilted: head drifts LEFT of feet.
    // Simulate by applying the INVERSE rotation, then expect normalizeFrame
    // to restore verticality.
    const pivot = { x: 0.5, y: 0.5 } // aspect 1
    const headLevel: Landmark = { x: 0.5, y: 0.2, visibility: 0.9 }
    const feetLevel: Landmark = { x: 0.5, y: 0.9, visibility: 0.9 }
    const tilted: PoseFrame = {
      view: 'side',
      captureRollDeg: 10,
      landmarks: {
        left_ear: rotatePoint(headLevel, -10, pivot),
        left_ankle: rotatePoint(feetLevel, -10, pivot),
      },
    }
    // sanity: simulated tilt drifts the head left of the feet
    expect(tilted.landmarks.left_ear.x).toBeLessThan(tilted.landmarks.left_ankle.x)
    const out = normalizeFrame(tilted)
    expect(close(out.landmarks.left_ear.x, 0.5)).toBe(true)
    expect(close(out.landmarks.left_ear.y, 0.2)).toBe(true)
    expect(close(out.landmarks.left_ankle.x, 0.5)).toBe(true)
    expect(close(out.landmarks.left_ankle.y, 0.9)).toBe(true)
  })

  it('keeps view/metadata fields on the returned frame', () => {
    const f: PoseFrame = {
      view: 'side', aspectRatio: 0.75, captureRollDeg: 3, source: 'camera',
      landmarks: { nose: { x: 0.5, y: 0.1 } },
    }
    const out = normalizeFrame(f)
    expect(out.view).toBe('side')
    expect(out.captureRollDeg).toBe(3)
    expect(out.aspectRatio).toBe(0.75)
    expect(out.source).toBe('camera')
  })
})
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run packages/posture-engine/__tests__/normalize.test.ts`
Expected: FAIL — `rotatePoint`/`normalizeFrame` are not exported.

- [ ] **Step 4: Implement in `geometry.ts`**

Append to `packages/posture-engine/src/geometry.ts` (import `PoseFrame` by extending the existing import line to `import { Landmark, PoseFrame } from './types'`):

```ts
const DEG2RAD = Math.PI / 180

/**
 * Rotate a point about a pivot in y-down screen coordinates.
 * thetaDeg follows the captureRollDeg convention: applying θ = captureRollDeg
 * undoes the apparent scene rotation caused by a camera rolled by θ
 * (positive = phone top tilted to the photographer's right).
 * Returns a new Landmark; never mutates the input.
 */
export function rotatePoint(
  p: Landmark,
  thetaDeg: number,
  pivot: { x: number; y: number }
): Landmark {
  const t = thetaDeg * DEG2RAD
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return { ...p, x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
}

/**
 * Map a frame into a square, level reference space:
 *  - aspect-correct: x' = x * aspectRatio so both axes share a physical scale
 *  - de-rotate: rotate landmarks by captureRollDeg about the image centre so a
 *    photo taken with a rolled camera reads as if the camera were level
 * Frames without metadata pass through unchanged (aspect defaults to 1, roll
 * to 0), so historical payloads and fixtures keep their exact scores.
 * Returns a new frame; never mutates the input.
 */
export function normalizeFrame(frame: PoseFrame): PoseFrame {
  const aspect = frame.aspectRatio ?? 1
  const roll = frame.captureRollDeg ?? 0
  if (aspect === 1 && roll === 0) return frame
  const pivot = { x: 0.5 * aspect, y: 0.5 }
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [name, lm] of Object.entries(frame.landmarks)) {
    const scaled = aspect === 1 ? lm : { ...lm, x: lm.x * aspect }
    landmarks[name] = roll === 0 ? { ...scaled } : rotatePoint(scaled, roll, pivot)
  }
  return { ...frame, landmarks }
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run packages/posture-engine/__tests__/normalize.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add packages/posture-engine/src/types.ts packages/posture-engine/src/geometry.ts packages/posture-engine/__tests__/normalize.test.ts
git commit -m "feat(engine): frame metadata types + rotatePoint/normalizeFrame transform"
```

---

### Task 2: Engine integration — correct frames, flags, version bump

**Files:**
- Modify: `packages/posture-engine/src/types.ts` (AssessmentResult)
- Modify: `packages/posture-engine/src/engine.ts`
- Test: `packages/posture-engine/__tests__/normalize.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append the describes to `normalize.test.ts`, and add this import at the TOP of the file (next to the existing imports, not mid-file):

```ts
import { assessPosture, testLandmarksFrames } from '../src'

// Helper: simulate a photo of `frame`'s scene taken with a camera rolled by
// rollDeg on an image with the given aspect ratio. Works in corrected space
// (x·aspect), applies the inverse rotation, then maps back to image space.
function simulateTiltedCapture(frame: PoseFrame, rollDeg: number, aspect: number): PoseFrame {
  const pivot = { x: 0.5 * aspect, y: 0.5 }
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [name, lm] of Object.entries(frame.landmarks)) {
    const corrected = { ...lm, x: lm.x * aspect }
    const tilted = rotatePoint(corrected, -rollDeg, pivot)
    landmarks[name] = { ...tilted, x: tilted.x / aspect }
  }
  return { ...frame, landmarks, captureRollDeg: rollDeg, aspectRatio: aspect }
}

describe('assessPosture tilt correction (engine equivalence)', () => {
  const levelFrames = testLandmarksFrames.map(f => ({ ...f, aspectRatio: 0.75 }))

  it('a tilted capture with matching captureRollDeg scores identically to the level capture', () => {
    const tiltedFrames = testLandmarksFrames.map(f => simulateTiltedCapture(f, 4.2, 0.75))
    const level = assessPosture(levelFrames)
    const tilted = assessPosture(tiltedFrames)
    expect(tilted.findings.length).toBe(level.findings.length)
    tilted.findings.forEach((f, i) => {
      expect(f.key).toBe(level.findings[i].key)
      expect(Math.abs(f.deviation - level.findings[i].deviation)).toBeLessThan(1e-6)
      expect(f.zone).toBe(level.findings[i].zone)
    })
    expect(tilted.overallScore).toBe(level.overallScore)
  })

  it('flags: tiltCorrected true / levelVerified true when all frames carry a roll', () => {
    const tiltedFrames = testLandmarksFrames.map(f => simulateTiltedCapture(f, 3, 0.75))
    const r = assessPosture(tiltedFrames)
    expect(r.tiltCorrected).toBe(true)
    expect(r.levelVerified).toBe(true)
  })

  it('flags: measured-level capture (roll 0) is levelVerified but not tiltCorrected', () => {
    const frames = testLandmarksFrames.map(f => ({ ...f, captureRollDeg: 0, aspectRatio: 0.75 }))
    const r = assessPosture(frames)
    expect(r.tiltCorrected).toBe(false)
    expect(r.levelVerified).toBe(true)
  })

  it('flags: any frame without captureRollDeg makes levelVerified false', () => {
    const frames = testLandmarksFrames.map((f, i) =>
      i === 0 ? { ...f, aspectRatio: 0.75 } : { ...f, captureRollDeg: 0, aspectRatio: 0.75 }
    )
    const r = assessPosture(frames)
    expect(r.levelVerified).toBe(false)
  })

  it('flags: empty frame list is not levelVerified', () => {
    const r = assessPosture([])
    expect(r.levelVerified).toBe(false)
    expect(r.tiltCorrected).toBe(false)
  })
})

describe('aspect-ratio golden values (intentional score shift, spec §6)', () => {
  // Hand-derived by replaying the engine math on the canonical fixture with
  // x scaled by 0.75. Side-view from-vertical angles DROP (they were
  // overstated); front-view from-horizontal angles RISE (understated).
  const frames = testLandmarksFrames.map(f => ({ ...f, aspectRatio: 0.75 }))
  const EPSILON = 0.05

  it('locks the aspect-corrected canonical result', () => {
    const r = assessPosture(frames)
    expect(r.overallScore).toBe(25)
    expect(r.overallGrade).toBe('B')
    expect(r.overallPercentile).toBe(75)
    expect(r.ranks.front).toBe(21) // was 18 uncorrected
    expect(r.ranks.side).toBe(29)  // was 35 uncorrected

    const byKey = Object.fromEntries(r.findings.map(f => [f.key, f]))
    expect(Math.abs(byKey['forward_head_posture'].deviation - 8.7778)).toBeLessThan(EPSILON)        // was 11.63
    expect(Math.abs(byKey['anterior_imbalanced_shoulders'].deviation - 3.8655)).toBeLessThan(EPSILON) // was 2.90
    expect(Math.abs(byKey['t1_tilt_backward'].deviation - 2.7702)).toBeLessThan(EPSILON)            // was 3.69
    expect(byKey['t1_tilt_backward'].zone).toBe('maintain')                                          // was 'warning'
    expect(Math.abs(byKey['anterior_pelvic_shift'].deviation - 2.7702)).toBeLessThan(EPSILON)
    expect(Math.abs(byKey['knee_extension_back_knee'].deviation - 2.9112)).toBeLessThan(EPSILON)
    expect(Math.abs(byKey['genu_varum_valgum_left'].deviation - 0.6218)).toBeLessThan(EPSILON)
  })

  it('frames WITHOUT aspectRatio keep the historical values (no silent re-scoring)', () => {
    const r = assessPosture(testLandmarksFrames)
    expect(r.overallScore).toBe(25)
    expect(r.ranks.front).toBe(18)
    expect(r.ranks.side).toBe(35)
  })

  it('hand value: FHP fixture frame at aspect 0.75 → atan2(0.07·0.75, 0.10) ≈ 27.70°', () => {
    const fhp: PoseFrame = {
      view: 'side',
      aspectRatio: 0.75,
      landmarks: {
        left_ear:      { x: 0.570, y: 0.150, visibility: 0.90 },
        left_shoulder: { x: 0.500, y: 0.250, visibility: 0.90 },
      },
    }
    const r = assessPosture([fhp])
    const f = r.findings.find(x => x.key === 'forward_head_posture')!
    expect(Math.abs(f.deviation - 27.70)).toBeLessThan(0.05) // raw math gave 34.99
  })
})
```

Note: `rotatePoint` and `PoseFrame` are already imported at the top of this file from Task 1.

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run packages/posture-engine/__tests__/normalize.test.ts`
Expected: FAIL — `tiltCorrected` missing on result type; aspect goldens off (no correction applied yet).

- [ ] **Step 3: Add flags to `AssessmentResult`**

In `packages/posture-engine/src/types.ts`, add to `AssessmentResult` (after `missingViews`):

```ts
  /** True when at least one frame carried a non-zero measured camera roll that was removed. */
  tiltCorrected: boolean
  /** True when every submitted frame came from sensor-verified capture (captureRollDeg present). */
  levelVerified: boolean
```

- [ ] **Step 4: Apply the transform in `engine.ts`**

In `packages/posture-engine/src/engine.ts`:

1. Add import: `import { normalizeFrame } from './geometry'`
2. Bump: `export const ENGINE_VERSION = '1.1.0'`
3. Rename the parameter and normalize up front — replace:

```ts
export function assessPosture(frames: PoseFrame[]): AssessmentResult {
  const front = frames.find(f => f.view === 'front')
```

with:

```ts
export function assessPosture(rawFrames: PoseFrame[]): AssessmentResult {
  // Single insertion point: every metric below consumes aspect-corrected,
  // de-rotated landmarks (spec §4.4). Frames without metadata pass through.
  const frames = rawFrames.map(normalizeFrame)
  const tiltCorrected = rawFrames.some(f => (f.captureRollDeg ?? 0) !== 0)
  const levelVerified = rawFrames.length > 0 && rawFrames.every(f => f.captureRollDeg !== undefined)

  const front = frames.find(f => f.view === 'front')
```

4. Add the flags to the returned object (after `missingViews,`):

```ts
    tiltCorrected,
    levelVerified,
```

- [ ] **Step 5: Run the full engine + app unit suites**

Run: `npx vitest run packages/posture-engine lib`
Expected: ALL PASS — including the untouched `engine.test.ts` hand-computed values and `fixtures.test.ts` canonical snapshot (their frames carry no `aspectRatio`, so values are unchanged). If `fixtures.test.ts` fails, the no-metadata passthrough in `normalizeFrame` is broken — fix that, do not edit the fixture test.

- [ ] **Step 6: Check for result consumers that must compile**

Run: `grep -rn "assessPosture\|AssessmentResult" app lib --include='*.ts' --include='*.tsx' | grep -v node_modules`
Expected: only `app/api/assessments/route.ts` (handled in Task 9) and validation/type imports. New result fields are additive, so nothing breaks. Run `npm run typecheck` to confirm.

- [ ] **Step 7: Commit**

```bash
git add packages/posture-engine/src packages/posture-engine/__tests__/normalize.test.ts
git commit -m "feat(engine): aspect-correct + de-rotate frames in assessPosture, add level flags, bump to 1.1.0"
```

---

### Task 3: Zod schema — accept the new optional frame fields

**Files:**
- Modify: `lib/validation/frames.ts`
- Test: `lib/validation/frames.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('parseAssessmentPayload')` block in `lib/validation/frames.test.ts`, using the file's `validBody()` helper and its frame-spread pattern:

```ts
  describe('capture metadata fields', () => {
    it('accepts captureRollDeg, aspectRatio and source on a frame', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], captureRollDeg: -3.2, aspectRatio: 0.75, source: 'camera' }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
    })

    it('rejects captureRollDeg beyond ±45', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], captureRollDeg: 60 }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(422)
    })

    it('rejects aspectRatio outside 0.1–10', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], aspectRatio: 0.05 }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })

    it('rejects unknown source values', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], source: 'fixture' }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })

    it('still accepts frames without any metadata (historical payloads)', () => {
      const r = parseAssessmentPayload(validBody(), { testModeEnabled: false })
      expect(r.ok).toBe(true)
    })
  })
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run lib/validation/frames.test.ts`
Expected: FAIL — unknown keys are stripped by Zod object schema (accept test may pass) but the reject tests fail because invalid values are silently dropped. All five must pass only after Step 3.

- [ ] **Step 3: Extend `frameSchema`** in `lib/validation/frames.ts`:

```ts
const frameSchema = z.object({
  view: z.enum(['front', 'side', 'back']),
  landmarks: z
    .record(z.string(), landmarkSchema)
    .superRefine((landmarks, ctx) => {
      for (const name of Object.keys(landmarks)) {
        if (!landmarkNameSet.has(name)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown landmark "${name}"` })
        }
      }
    }),
  // Capture metadata (all optional — historical payloads predate these).
  captureRollDeg: z.number().finite().min(-45).max(45).optional(),
  aspectRatio: z.number().finite().min(0.1).max(10).optional(),
  source: z.enum(['camera', 'upload']).optional(),
})
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run lib/validation/frames.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/frames.ts lib/validation/frames.test.ts
git commit -m "feat(validation): accept captureRollDeg/aspectRatio/source frame metadata"
```

---

### Task 4: Orientation math — pure roll/pitch from β/γ

**Files:**
- Create: `lib/capture/orientation-math.ts`
- Test: `lib/capture/orientation-math.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/capture/orientation-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rollPitchFromOrientation } from './orientation-math'

const close = (a: number, b: number) => Math.abs(a - b) < 0.01

describe('rollPitchFromOrientation', () => {
  it('upright portrait, level: β=90 γ=0 → roll 0, pitch 0', () => {
    const { rollDeg, pitchDeg } = rollPitchFromOrientation(90, 0)
    expect(close(rollDeg, 0)).toBe(true)
    expect(close(pitchDeg, 0)).toBe(true)
  })

  it('pure 10° roll right (device reports β=80 γ=90 in the gimbal-lock regime) → roll +10, pitch 0', () => {
    // Physically rolling an upright phone 10° clockwise (photographer view)
    // makes the W3C Euler angles snap to γ=±90 with β=90−roll.
    const { rollDeg, pitchDeg } = rollPitchFromOrientation(80, 90)
    expect(close(rollDeg, 10)).toBe(true)
    expect(close(pitchDeg, 0)).toBe(true)
  })

  it('pure 10° roll left (β=80 γ=−90) → roll −10', () => {
    const { rollDeg } = rollPitchFromOrientation(80, -90)
    expect(close(rollDeg, -10)).toBe(true)
  })

  it('pure 5° pitch (β=85 γ=0) → roll 0, pitch 5', () => {
    const { rollDeg, pitchDeg } = rollPitchFromOrientation(85, 0)
    expect(close(rollDeg, 0)).toBe(true)
    expect(close(pitchDeg, 5)).toBe(true)
  })

  it('phone flat on its back (β=0 γ=0) → pitch 90 (camera aims straight down)', () => {
    const { pitchDeg } = rollPitchFromOrientation(0, 0)
    expect(close(pitchDeg, 90)).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run lib/capture/orientation-math.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `lib/capture/orientation-math.ts`:

```ts
// Pure sensor math for the camera level gate. No DOM access — unit-testable.

export interface RollPitch {
  /** Camera roll in degrees. Positive = phone top tilted to the photographer's right. */
  rollDeg: number
  /** Camera pitch off the horizontal aim, degrees. 0 = aimed straight ahead. */
  pitchDeg: number
}

const RAD2DEG = 180 / Math.PI

/**
 * Reconstruct roll/pitch from W3C deviceorientation beta/gamma by projecting
 * gravity into device coordinates: g = (cosβ·sinγ, −sinβ, −cosβ·cosγ).
 * This avoids the Euler gimbal lock at β≈90° (upright portrait), where raw
 * gamma is unstable; the gravity projection is exact for any orientation.
 */
export function rollPitchFromOrientation(betaDeg: number, gammaDeg: number): RollPitch {
  const b = betaDeg / RAD2DEG
  const g = gammaDeg / RAD2DEG
  const gx = Math.cos(b) * Math.sin(g)
  const gy = -Math.sin(b)
  const gz = -Math.cos(b) * Math.cos(g)
  const rollDeg = Math.atan2(gx, -gy) * RAD2DEG
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, -gz))) * RAD2DEG
  return { rollDeg, pitchDeg }
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/capture/orientation-math.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/capture/orientation-math.ts lib/capture/orientation-math.test.ts
git commit -m "feat(capture): gravity-projection roll/pitch math for the level gate"
```

---

### Task 5: DeviceOrientation hook — `useCameraLevel`

**Files:**
- Create: `lib/capture/use-camera-level.ts`
- Test: `lib/capture/use-camera-level.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `lib/capture/use-camera-level.test.tsx` (jsdom + @testing-library/react, both already in devDeps):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCameraLevel } from './use-camera-level'

declare global {
  interface Window { DeviceOrientationEvent?: unknown }
}

function fireOrientation(beta: number, gamma: number) {
  const e = new Event('deviceorientation') as Event & { beta: number | null; gamma: number | null }
  Object.assign(e, { beta, gamma })
  window.dispatchEvent(e)
}

describe('useCameraLevel', () => {
  const originalDOE = window.DeviceOrientationEvent

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    window.DeviceOrientationEvent = originalDOE
  })

  it('reports unsupported when DeviceOrientationEvent does not exist', () => {
    delete window.DeviceOrientationEvent
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('unsupported')
    expect(result.current.rollDeg).toBeNull()
  })

  it('listens immediately on non-iOS (no requestPermission) and reports roll', () => {
    window.DeviceOrientationEvent = class {} // no static requestPermission
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('granted')
    act(() => { fireOrientation(80, 90) }) // pure 10° roll right
    expect(result.current.rollDeg).not.toBeNull()
    expect(Math.abs(result.current.rollDeg! - 10)).toBeLessThan(0.01)
    expect(result.current.rollRef.current).not.toBeNull()
  })

  it('downgrades to unsupported when no event arrives within the timeout', () => {
    window.DeviceOrientationEvent = class {}
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('granted')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.permission).toBe('unsupported')
  })

  it('exposes needs-request when iOS-style requestPermission exists, grants on success', async () => {
    window.DeviceOrientationEvent = class {
      static requestPermission = vi.fn().mockResolvedValue('granted')
    }
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('needs-request')
    await act(async () => { await result.current.requestAccess() })
    expect(result.current.permission).toBe('granted')
  })

  it('reports denied when requestPermission rejects or returns denied', async () => {
    window.DeviceOrientationEvent = class {
      static requestPermission = vi.fn().mockResolvedValue('denied')
    }
    const { result } = renderHook(() => useCameraLevel())
    await act(async () => { await result.current.requestAccess() })
    expect(result.current.permission).toBe('denied')
  })
})
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run lib/capture/use-camera-level.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `lib/capture/use-camera-level.ts`:

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rollPitchFromOrientation } from './orientation-math'

export type LevelPermission = 'pending' | 'needs-request' | 'granted' | 'denied' | 'unsupported'

export interface CameraLevel {
  permission: LevelPermission
  /** Throttled camera roll (deg); null when sensors/permission unavailable or not in portrait. */
  rollDeg: number | null
  pitchDeg: number | null
  /** Always-current roll for reading at the capture instant. */
  rollRef: React.MutableRefObject<number | null>
  /** Must be invoked from a user gesture (iOS requirement). */
  requestAccess: () => Promise<void>
}

interface DOEWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const UPDATE_INTERVAL_MS = 100   // ~10 Hz UI updates; raw events fire faster
const NO_EVENT_TIMEOUT_MS = 1500 // desktops expose the API but never fire

function inPortrait(): boolean {
  if (typeof screen === 'undefined' || !screen.orientation) return true
  return screen.orientation.type.startsWith('portrait')
}

export function useCameraLevel(): CameraLevel {
  const [permission, setPermission] = useState<LevelPermission>('pending')
  const [rollDeg, setRollDeg] = useState<number | null>(null)
  const [pitchDeg, setPitchDeg] = useState<number | null>(null)
  const rollRef = useRef<number | null>(null)
  // -Infinity so the FIRST event always passes the throttle (also under fake
  // timers in tests, where Date.now() starts at 0).
  const lastUpdateRef = useRef(-Infinity)
  const listeningRef = useRef(false)

  const handleEvent = useCallback((e: DeviceOrientationEvent) => {
    if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return
    if (!inPortrait()) {
      // Roll/gamma mapping is only validated for portrait — suspend the gate.
      rollRef.current = null
      setRollDeg(null)
      setPitchDeg(null)
      return
    }
    const { rollDeg: r, pitchDeg: p } = rollPitchFromOrientation(e.beta, e.gamma)
    rollRef.current = r
    const now = Date.now()
    if (now - lastUpdateRef.current >= UPDATE_INTERVAL_MS) {
      lastUpdateRef.current = now
      setRollDeg(r)
      setPitchDeg(p)
    }
  }, [])

  const startListening = useCallback(() => {
    if (listeningRef.current) return
    listeningRef.current = true
    window.addEventListener('deviceorientation', handleEvent as EventListener)
  }, [handleEvent])

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      setPermission('unsupported')
      return
    }
    const doe = window.DeviceOrientationEvent as unknown as DOEWithPermission
    if (typeof doe.requestPermission === 'function') {
      setPermission('needs-request') // iOS: wait for an explicit gesture
    } else {
      setPermission('granted')
      startListening()
    }
    const timer = setTimeout(() => {
      // API present but silent (desktop): degrade so the UI doesn't wait forever.
      if (rollRef.current === null) {
        setPermission(p => (p === 'granted' ? 'unsupported' : p))
      }
    }, NO_EVENT_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
      if (listeningRef.current) {
        window.removeEventListener('deviceorientation', handleEvent as EventListener)
        listeningRef.current = false
      }
    }
  }, [handleEvent, startListening])

  const requestAccess = useCallback(async () => {
    const doe = window.DeviceOrientationEvent as unknown as DOEWithPermission
    if (typeof doe.requestPermission !== 'function') return
    try {
      const result = await doe.requestPermission()
      if (result === 'granted') {
        setPermission('granted')
        startListening()
      } else {
        setPermission('denied')
      }
    } catch {
      setPermission('denied')
    }
  }, [startListening])

  return { permission, rollDeg, pitchDeg, rollRef, requestAccess }
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/capture/use-camera-level.test.tsx` → PASS. (The first event always passes the throttle because `lastUpdateRef` starts at `-Infinity` — if the `granted` test's roll assertion fails, check that initializer.)

- [ ] **Step 5: Commit**

```bash
git add lib/capture/use-camera-level.ts lib/capture/use-camera-level.test.tsx
git commit -m "feat(capture): useCameraLevel hook with iOS permission flow and graceful degradation"
```

---

### Task 6: Framing checks in `assessFrameQuality`

**Files:**
- Modify: `lib/pose/quality.ts`
- Test: `lib/pose/quality.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `lib/pose/quality.test.ts`; it already imports `testLandmarksFrames` and has `makeFrame`):

```ts
describe('framing checks', () => {
  // Well-framed full body: eyes ~0.10, ankles ~0.90 (span 0.80), hips centered.
  function framedBody(opts: { headY?: number; ankleY?: number; hipMidX?: number } = {}) {
    const headY = opts.headY ?? 0.10
    const ankleY = opts.ankleY ?? 0.90
    const hipMidX = opts.hipMidX ?? 0.5
    const torsoY = headY + (ankleY - headY) * 0.45
    const kneeY = headY + (ankleY - headY) * 0.75
    const v = 0.9
    return makeFrame('front', {
      nose:           { x: hipMidX, y: headY, visibility: v },
      left_eye:       { x: hipMidX + 0.02, y: headY, visibility: v },
      right_eye:      { x: hipMidX - 0.02, y: headY, visibility: v },
      left_shoulder:  { x: hipMidX + 0.12, y: headY + 0.12, visibility: v },
      right_shoulder: { x: hipMidX - 0.12, y: headY + 0.12, visibility: v },
      left_hip:       { x: hipMidX + 0.08, y: torsoY, visibility: v },
      right_hip:      { x: hipMidX - 0.08, y: torsoY, visibility: v },
      left_knee:      { x: hipMidX + 0.08, y: kneeY, visibility: v },
      right_knee:     { x: hipMidX - 0.08, y: kneeY, visibility: v },
      left_ankle:     { x: hipMidX + 0.08, y: ankleY, visibility: v },
      right_ankle:    { x: hipMidX - 0.08, y: ankleY, visibility: v },
    })
  }

  it('well-framed body produces no framing warnings', () => {
    const r = assessFrameQuality(framedBody(), 'front')
    expect(r.status).toBe('ok')
  })

  it('subject too small in frame (span < 0.65) warns to move closer', () => {
    const r = assessFrameQuality(framedBody({ headY: 0.35, ankleY: 0.75 }), 'front')
    expect(r.status).toBe('warnings')
    expect(r.warnings.some(w => /closer/i.test(w))).toBe(true)
  })

  it('subject nearly filling the frame (span > 0.95) warns to step back', () => {
    const r = assessFrameQuality(framedBody({ headY: 0.01, ankleY: 0.99 }), 'front')
    expect(r.status).toBe('warnings')
    expect(r.warnings.some(w => /step back|space above/i.test(w))).toBe(true)
  })

  it('off-center subject warns to center up', () => {
    const r = assessFrameQuality(framedBody({ hipMidX: 0.78 }), 'front')
    expect(r.status).toBe('warnings')
    expect(r.warnings.some(w => /center/i.test(w))).toBe(true)
  })

  it('visible joint outside the frame bounds warns', () => {
    const frame = framedBody()
    frame.landmarks.left_ankle = { x: 0.08, y: 1.05, visibility: 0.9 }
    const r = assessFrameQuality(frame, 'front')
    expect(r.warnings.some(w => /outside the frame/i.test(w))).toBe(true)
  })

  it('framing also applies to side view', () => {
    const f = framedBody({ headY: 0.35, ankleY: 0.75 })
    const side = { ...f, view: 'side' as const }
    const r = assessFrameQuality(side, 'side')
    expect(r.warnings.some(w => /closer/i.test(w))).toBe(true)
  })

  it('canonical fixture frames still pass with zero framing warnings (regression)', () => {
    expect(assessFrameQuality(frontFrame, 'front').status).toBe('ok')
    expect(assessFrameQuality(sideFrame, 'side').status).toBe('ok')
  })
})
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run lib/pose/quality.test.ts` → the new tests FAIL (no framing logic); all existing tests still PASS.

- [ ] **Step 3: Implement framing checks** in `lib/pose/quality.ts`.

Add constants and helper after the existing `groupOk` helper:

```ts
// ---- Geometric framing checks (spec §4.2) ----
// Span thresholds are calibrated on the measurable eye/ear-to-ankle span
// (MediaPipe has no head-top landmark): 0.65 ≈ the spec's 70% head-to-ankle
// minimum; 0.95 still leaves visible margin, and truly cut-off bodies are
// caught by the out-of-frame check below.
const HEAD_LANDMARKS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear']
const ANKLE_LANDMARKS = ['left_ankle', 'right_ankle']
const BOUNDS_LANDMARKS = [
  'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
]
const FRAME_SPAN_MIN = 0.65
const FRAME_SPAN_MAX = 0.95
const CENTER_TOLERANCE = 0.15

function visiblePoints(frame: PoseFrame, names: string[]) {
  return names
    .map(n => frame.landmarks[n])
    .filter((p): p is NonNullable<typeof p> => !!p && (p.visibility ?? 0) >= RELIABILITY_FLOOR)
}

function framingWarnings(frame: PoseFrame): string[] {
  const warnings: string[] = []

  const headYs = visiblePoints(frame, HEAD_LANDMARKS).map(p => p.y)
  const ankleYs = visiblePoints(frame, ANKLE_LANDMARKS).map(p => p.y)
  if (headYs.length > 0 && ankleYs.length > 0) {
    const span = Math.max(...ankleYs) - Math.min(...headYs)
    if (span < FRAME_SPAN_MIN) {
      warnings.push('Subject is small in the frame — move the camera closer so the body fills most of the height.')
    } else if (span > FRAME_SPAN_MAX) {
      warnings.push('Subject nearly fills the frame — step back to leave space above the head and below the feet.')
    }
  }

  const hips = visiblePoints(frame, ['left_hip', 'right_hip'])
  if (hips.length === 2) {
    const hipMidX = (hips[0].x + hips[1].x) / 2
    if (Math.abs(hipMidX - 0.5) > CENTER_TOLERANCE) {
      warnings.push('Subject is off-center — line up with the middle of the frame.')
    }
  }

  // Schema allows −0.5…1.5, so confidently-detected joints outside [0,1]
  // mean part of the body is outside the photo.
  const outOfFrame = visiblePoints(frame, BOUNDS_LANDMARKS)
    .some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
  if (outOfFrame) {
    warnings.push('Part of the body is outside the frame — adjust the camera so all joints are visible.')
  }

  return warnings
}
```

Then, in `assessFrameQuality`, before the final `if (warnings.length > 0)` return, add:

```ts
  // Geometric framing (all views) — soft warnings, never blocking.
  warnings.push(...framingWarnings(frame))
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/pose/quality.test.ts` → ALL PASS (new + existing). If a pre-existing warning-count assertion fails, it means `framingWarnings` added a warning to that test's fixture; low-visibility landmarks are excluded from framing by `visiblePoints`, so investigate the fixture's geometry before touching anything — do not weaken the new checks.

- [ ] **Step 5: Commit**

```bash
git add lib/pose/quality.ts lib/pose/quality.test.ts
git commit -m "feat(quality): geometric framing checks — distance, centering, in-frame bounds"
```

---

### Task 7: `detectPose` metadata + upload EXIF normalization

**Files:**
- Modify: `lib/pose/detect.ts`
- Create: `lib/pose/normalize-upload.ts`

These are browser-only modules (MediaPipe / canvas); there are no node unit tests. Coverage: e2e `real-detection.spec.ts` exercises `detectPose`, Task 10's e2e covers the result flags, and a manual device pass is listed in Task 11.

- [ ] **Step 1: Attach `aspectRatio` and `source` in `detectPose`**

In `lib/pose/detect.ts`, replace the `detectPose` signature and return:

```ts
export async function detectPose(
  src: string,
  view: ViewLabel,
  source?: 'camera' | 'upload'
): Promise<PoseFrame> {
```

and replace the final `return { view, landmarks }` with:

```ts
  const frame: PoseFrame = { view, landmarks }
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    frame.aspectRatio = img.naturalWidth / img.naturalHeight
  }
  if (source) frame.source = source
  return frame
```

- [ ] **Step 2: Create the upload normalizer**

Create `lib/pose/normalize-upload.ts`:

```ts
'use client'
// Upload pre-processing (spec §4.5): apply EXIF orientation exactly once and
// cap the decode size, returning an upright JPEG data URL. Canvas re-encoding
// strips EXIF, so the orientation cannot be applied twice downstream.

const MAX_DIMENSION_PX = 1600

/**
 * Returns the upright JPEG data URL, or null when normalization is
 * unavailable (old browsers, decode failure) — the caller falls back to the
 * raw file object URL, and detectPose attaches the aspect ratio from the
 * decoded image either way.
 */
export async function normalizeUploadedImage(file: File): Promise<string | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Verify compilation and existing detection e2e is unaffected**

Run: `npm run typecheck`
Expected: clean. (`detectPose` callers pass — the new parameter is optional.)

- [ ] **Step 4: Commit**

```bash
git add lib/pose/detect.ts lib/pose/normalize-upload.ts
git commit -m "feat(pose): attach aspectRatio/source in detectPose; EXIF-normalize uploads"
```

---

### Task 8: Wizard — level gate UI, roll threading, upload path

**Files:**
- Modify: `app/assessments/new/page.tsx`

All edits below are in this one file. Current line anchors: `CaptureSlot` (~line 21), `CameraCaptureProps` (~169), `CameraCapture` (~175), overlay SVG (~333), `runPreflight` (~506), `handleFileUpload` (~538), `handleRetake` (~548), `handleCameraCapture` (~557), `validateAndProceed` fallback (~604), `<CameraCapture …>` usage (~864), `ViewUploadSlot` warnings banner (~143).

- [ ] **Step 1: Extend `CaptureSlot` and its five initializers**

```ts
interface CaptureSlot {
  file: File | null
  preview: string | null
  source: 'upload' | 'camera' | null
  poseFrame: PoseFrame | null
  quality: FrameQuality | null
  slotStatus: SlotStatus
  /** Sensor-measured camera roll for camera captures; null for uploads/no-sensor. */
  captureRollDeg: number | null
}
```

Add `captureRollDeg: null` to every slot object literal: the three entries of the initial `useState<Captures>` value, and the slot objects in `handleFileUpload`, `handleRetake`, `handleCameraCapture` (and keep `...prev[view]` spreads in `runPreflight` as-is — they preserve the field).

- [ ] **Step 2: Rework `CameraCapture` with the level gate**

Add imports at the top of the file:

```ts
import { useCameraLevel } from '@/lib/capture/use-camera-level'
```

Change the props and add state inside `CameraCapture`:

```ts
interface CameraCaptureProps {
  view: ViewKey
  onCapture: (dataUrl: string, captureRollDeg: number | null) => void
  onClose: () => void
}
```

Inside the component, after the existing `useState` declarations:

```ts
  const level = useCameraLevel()
  const [overrideTilt, setOverrideTilt] = useState(false)
  const [rollAtCapture, setRollAtCapture] = useState<number | null>(null)
  const [previewQuality, setPreviewQuality] = useState<FrameQuality | null>(null)

  const roll = level.rollDeg
  // Gate thresholds (spec §4.1): green ≤2°, amber ≤5° (allowed, corrected),
  // red >5° (blocked, manual override available).
  const tiltZone: 'green' | 'amber' | 'red' | null =
    roll === null ? null : Math.abs(roll) <= 2 ? 'green' : Math.abs(roll) <= 5 ? 'amber' : 'red'
  const tiltBlocked = tiltZone === 'red' && !overrideTilt
```

(`FrameQuality` is already imported at the top of the file.)

In `captureFrame`, record the roll at the shutter instant — after `const dataUrl = canvas.toDataURL('image/jpeg', 0.9)` add:

```ts
    setRollAtCapture(level.rollRef.current)
```

and add `level.rollRef` to the `useCallback` dependency array (refs are stable; this satisfies the lint rule).

Add the in-modal preview framing check (spec §4.2 capture-time guidance) as a new `useEffect` after the countdown effect:

```ts
  // Best-effort framing feedback on the captured still, so the user can
  // retake inside the modal. The wizard's preflight remains authoritative.
  useEffect(() => {
    if (phase !== 'preview' || !capturedUrl) { setPreviewQuality(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const { detectPose } = await import('@/lib/pose/detect')
        const { assessFrameQuality } = await import('@/lib/pose/quality')
        const frame = await detectPose(capturedUrl, view, 'camera')
        if (!cancelled) setPreviewQuality(assessFrameQuality(frame, view))
      } catch {
        // non-fatal: the slot preflight still runs after "Use This Photo"
      }
    })()
    return () => { cancelled = true }
  }, [phase, capturedUrl, view])
```

In `handleRetake`, reset the gate state — add at the top of the function:

```ts
    setRollAtCapture(null)
    setPreviewQuality(null)
    setOverrideTilt(false)
```

- [ ] **Step 3: Level indicator + gate UI**

Replace the static plumb-line `<line x1="50" y1="0" …>` color with the live zone color. Above the JSX `return`, add:

```ts
  const plumbColor =
    tiltZone === 'green' ? 'rgba(34,197,94,0.85)'
    : tiltZone === 'amber' ? 'rgba(245,158,11,0.85)'
    : tiltZone === 'red' ? 'rgba(239,68,68,0.9)'
    : 'rgba(99,102,241,0.7)'
```

and use `stroke={plumbColor}` on the plumb line (the four dashed horizontals stay unchanged).

Inside the live/countdown video container `<div style={{ position: 'relative', … }}>`, after the SVG, add the indicator pill and pitch hint:

```tsx
              {roll !== null && (
                <div data-testid="level-indicator" style={{
                  position: 'absolute', top: 8, left: 8, borderRadius: 6, padding: '3px 10px',
                  fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                  background: tiltZone === 'green' ? 'rgba(16,185,129,0.9)' : tiltZone === 'amber' ? 'rgba(245,158,11,0.9)' : 'rgba(239,68,68,0.92)',
                }}>
                  {tiltZone === 'green' ? 'Level' : `Tilted ${roll > 0 ? 'right' : 'left'} ${Math.abs(roll).toFixed(1)}°`}
                </div>
              )}
              {roll !== null && level.pitchDeg !== null && Math.abs(level.pitchDeg) > 15 && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, borderRadius: 6, padding: '3px 10px',
                  fontSize: '0.72rem', fontWeight: 600, color: '#fff', background: 'rgba(245,158,11,0.9)',
                }}>
                  Aim the camera straight ahead
                </div>
              )}
```

Below the existing "Align subject along the plumb-line guide" paragraph, add the permission / availability row:

```tsx
            {level.permission === 'needs-request' && (
              <button onClick={level.requestAccess} style={{
                display: 'block', margin: '0 auto 12px', padding: '8px 14px', borderRadius: 8,
                background: 'rgba(99,102,241,0.15)', color: '#818CF8',
                border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              }}>Enable level meter</button>
            )}
            {(level.permission === 'denied' || level.permission === 'unsupported') && (
              <p style={{ color: '#8A8A93', fontSize: '0.72rem', textAlign: 'center', margin: '0 0 12px' }}>
                Level check unavailable — hold the phone upright and straight.
              </p>
            )}
            {typeof screen !== 'undefined' && screen.orientation && !screen.orientation.type.startsWith('portrait') && (
              <p style={{ color: '#F59E0B', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 12px', fontWeight: 600 }}>
                Hold the phone upright (portrait) to capture.
              </p>
            )}
```

Add the red-gate banner and disable capture while blocked. Replace the `phase === 'live'` button row with:

```tsx
            {phase === 'live' && tiltBlocked && (
              <div data-testid="tilt-blocked" style={{
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 10,
                fontSize: '0.82rem', color: '#EF4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <span>Phone is tilted {Math.abs(roll!).toFixed(1)}° — straighten it to capture.</span>
                <button onClick={() => setOverrideTilt(true)} style={{
                  background: 'none', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6,
                  color: '#EF4444', fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}>Capture anyway</button>
              </div>
            )}
            {phase === 'live' && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={startCountdown} disabled={tiltBlocked} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: tiltBlocked ? 'rgba(79,70,229,0.35)' : '#4F46E5', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: tiltBlocked ? 'not-allowed' : 'pointer' }}>3-2-1 Auto Capture</button>
                <button onClick={captureFrame} disabled={tiltBlocked} style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: tiltBlocked ? '#6B6B73' : '#F5F5F5', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '0.875rem', cursor: tiltBlocked ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>Capture Now</button>
              </div>
            )}
```

- [ ] **Step 4: Preview phase — roll + framing feedback, threaded `onCapture`**

In the `phase === 'preview'` block: under the "Captured" badge add a roll chip, and between the preview text and buttons add framing feedback:

```tsx
              {rollAtCapture !== null && (
                <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.75)', borderRadius: '6px', padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600, color: Math.abs(rollAtCapture) <= 2 ? '#34D399' : '#F59E0B' }}>
                  {Math.abs(rollAtCapture) <= 2 ? 'Level ✓' : `Roll ${rollAtCapture.toFixed(1)}° — will be corrected`}
                </div>
              )}
```

```tsx
            {previewQuality && previewQuality.status === 'ok' && (
              <p style={{ color: '#34D399', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 10px' }}>Framing looks good</p>
            )}
            {previewQuality && previewQuality.status === 'no_person' && (
              <p style={{ color: '#EF4444', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 10px', fontWeight: 600 }}>No person detected — retake</p>
            )}
            {previewQuality && previewQuality.warnings.length > 0 && (
              <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                {previewQuality.warnings.map((w, i) => (
                  <p key={i} style={{ color: '#F59E0B', fontSize: '0.75rem', margin: i > 0 ? '4px 0 0' : 0 }}>• {w}</p>
                ))}
              </div>
            )}
```

Change the accept button to pass the roll:

```tsx
              <button onClick={() => capturedUrl && onCapture(capturedUrl, rollAtCapture)} …>Use This Photo</button>
```

- [ ] **Step 5: Thread metadata through the wizard**

`runPreflight` — new signature and frame assembly:

```ts
  async function runPreflight(view: ViewKey, preview: string, source: 'camera' | 'upload', captureRollDeg: number | null) {
    …
      const detected = await detectPose(preview, view, source)
      const poseFrame: PoseFrame = captureRollDeg !== null ? { ...detected, captureRollDeg } : detected
      const quality = assessFrameQuality(poseFrame, view)
    …
```

(the rest of the function is unchanged — it already stores `poseFrame` on the slot).

`handleFileUpload` — async, EXIF-normalized, falls back to the object URL:

```ts
  async function handleFileUpload(view: ViewKey, file: File) {
    const { normalizeUploadedImage } = await import('@/lib/pose/normalize-upload')
    const preview = (await normalizeUploadedImage(file)) ?? URL.createObjectURL(file)
    setCaptures(prev => ({
      ...prev,
      [view]: { file, preview, source: 'upload', poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null },
    }))
    setUploadError(null)
    if (!testMode) runPreflight(view, preview, 'upload', null)
  }
```

`handleRetake` — revoke only blob URLs (uploads may now be data URLs):

```ts
    if (old.preview && old.preview.startsWith('blob:')) URL.revokeObjectURL(old.preview)
```

`handleCameraCapture` — accept and store the roll:

```ts
  function handleCameraCapture(view: ViewKey, dataUrl: string, captureRollDeg: number | null) {
    setCaptures(prev => ({
      ...prev,
      [view]: { file: null, preview: dataUrl, source: 'camera', poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg },
    }))
    setActiveCameraSlot(null)
    setUploadError(null)
    if (!testMode) runPreflight(view, dataUrl, 'camera', captureRollDeg)
  }
```

`validateAndProceed` fallback branch (when preflight was skipped/failed):

```ts
          } else {
            // Preflight was skipped or failed — detect now
            const { detectPose } = await import('@/lib/pose/detect')
            const detected = await detectPose(cap.preview, v, cap.source ?? 'upload')
            frames.push(cap.captureRollDeg !== null ? { ...detected, captureRollDeg: cap.captureRollDeg } : detected)
          }
```

`<CameraCapture>` usage at the bottom of the wizard:

```tsx
        <CameraCapture view={activeCameraSlot}
          onCapture={(dataUrl, rollDeg) => handleCameraCapture(activeCameraSlot, dataUrl, rollDeg)}
          onClose={() => setActiveCameraSlot(null)}
        />
```

- [ ] **Step 6: Upload slot honesty note** (spec §4.5)

In `ViewUploadSlot`, after the warnings banner block, add:

```tsx
      {capture.preview && capture.source === 'upload' && (
        <p data-testid="upload-level-note" style={{ color: '#8A8A93', fontSize: '0.72rem', margin: '8px 0 0' }}>
          Camera level not verified for uploads — results may be less accurate.
        </p>
      )}
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run lib packages/posture-engine`
Expected: clean. Then a quick smoke in the dev server (`npm run dev`): open `/assessments/new`, camera modal renders, no level indicator appears on desktop (sensors silent → unsupported note after ~1.5 s), capture buttons stay enabled.

- [ ] **Step 8: Commit**

```bash
git add app/assessments/new/page.tsx
git commit -m "feat(wizard): live level gate with override, roll threading, EXIF-normalized uploads"
```

---### Task 9: Persistence — migration + API routes

**Files:**
- Create: `supabase/migrations/20260612050000_capture_level_flags.sql`
- Modify: `app/api/assessments/route.ts`
- Modify: `app/api/assessments/[id]/route.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260612050000_capture_level_flags.sql`:

```sql
-- Capture-correctness flags (spec §4.4/§4.6). Nullable: historical
-- assessments predate tilt correction and stay NULL (= unknown).
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS tilt_corrected BOOLEAN,
  ADD COLUMN IF NOT EXISTS level_verified BOOLEAN;
```

- [ ] **Step 2: Apply and verify the migration**

Apply with `npx supabase db push` (project is linked) — or, if running with the Supabase MCP, `apply_migration` with the file's name/content. Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'assessments' AND column_name IN ('tilt_corrected','level_verified');
```

Expected: both rows returned.

- [ ] **Step 3: Persist flags + real source in the POST route**

In `app/api/assessments/route.ts`:

1. Captures insert — use the frame's own source (fixtures keep `'fixture'`):

```ts
      const capturesToInsert = frames.map((f) => ({
        assessment_id: assessmentId,
        practitioner_id: user.id,
        view: f.view,
        source: useFixture ? 'fixture' : (f.source ?? 'upload'),
        pose_frame: f as unknown as object,
      }))
```

2. Assessment completion update — add the two flags:

```ts
        .update({
          status: 'complete',
          overall_score: result.overallScore,
          overall_grade: result.overallGrade,
          overall_percentile: result.overallPercentile,
          front_rank: result.ranks.front,
          side_rank: result.ranks.side,
          scoring_engine_version: result.engineVersion,
          tilt_corrected: result.tiltCorrected,
          level_verified: result.levelVerified,
        })
```

- [ ] **Step 4: Return flags + per-capture roll in the GET route**

In `app/api/assessments/[id]/route.ts`:

1. Add `tilt_corrected, level_verified` to the assessment `.select(…)` string (after `scoring_engine_version`).
2. Extend the captures query and response mapping:

```ts
  const { data: rawCaptures } = await service
    .from('captures')
    .select('id, view, storage_path, source, pose_frame')
    .eq('assessment_id', id)

  const captures: Array<{ id: string; view: string; signed_url: string | null; source: string; capture_roll_deg: number | null }> = []
  for (const cap of (rawCaptures || [])) {
    let signed_url: string | null = null
    if (cap.storage_path) {
      const { data: urlData } = await service.storage
        .from('posture-captures')
        .createSignedUrl(cap.storage_path, 3600)
      signed_url = urlData?.signedUrl ?? null
    }
    const roll = (cap.pose_frame as { captureRollDeg?: number } | null)?.captureRollDeg
    captures.push({
      id: cap.id, view: cap.view, signed_url, source: cap.source,
      capture_roll_deg: typeof roll === 'number' ? roll : null,
    })
  }
```

- [ ] **Step 5: Verify** — `npm run typecheck` clean; then with the dev server up, run one fixture assessment (`/assessments/new?testMode=1`, requires `POSTURE_TEST_MODE_ENABLED=1` server-side) and confirm via SQL that the new row has `level_verified = false` (fixtures carry no `captureRollDeg`) and `tilt_corrected = false`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260612050000_capture_level_flags.sql app/api/assessments/route.ts 'app/api/assessments/[id]/route.ts'
git commit -m "feat(api): persist tilt_corrected/level_verified and expose per-capture roll"
```

---

### Task 10: Result page badge

**Files:**
- Modify: `app/assessments/[id]/page.tsx`

- [ ] **Step 1: Extend the local interfaces**

`Assessment` gains (after `side_rank`):

```ts
  tilt_corrected: boolean | null
  level_verified: boolean | null
```

`Capture` gains:

```ts
  capture_roll_deg: number | null
```

- [ ] **Step 2: Render the badge** (spec §4.6)

In the main render, directly under the `<p>` with the client name/date (inside the same `<div style={{ marginBottom: 24 }}>`), add:

```tsx
        {assessment.level_verified === true && (
          <span data-testid="level-badge" style={{
            display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 6,
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
            color: '#34D399', fontSize: '0.75rem', fontWeight: 600,
          }}>
            Camera level verified
            {assessment.tilt_corrected && rollNotes.length > 0 && ` — tilt-corrected (${rollNotes.join(', ')})`}
          </span>
        )}
        {assessment.level_verified === false && (
          <span data-testid="level-badge" style={{
            display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 6,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#F59E0B', fontSize: '0.75rem', fontWeight: 600,
          }}>
            Camera level not verified — results may be less accurate
          </span>
        )}
```

(Historical rows have `level_verified === null` → no badge.) Define `rollNotes` next to the existing `frontCapture`/`sideCapture` derivations:

```ts
  const rollNotes = captures
    .filter(c => typeof c.capture_roll_deg === 'number' && Math.abs(c.capture_roll_deg) >= 0.05)
    .map(c => `${c.view} ${c.capture_roll_deg! > 0 ? '+' : '−'}${Math.abs(c.capture_roll_deg!).toFixed(1)}°`)
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; dev-server fixture run shows the amber "Camera level not verified" badge on the results page.

- [ ] **Step 4: Commit**

```bash
git add 'app/assessments/[id]/page.tsx'
git commit -m "feat(results): level-verification / tilt-correction badge"
```

---

### Task 11: E2E + full verification sweep

**Files:**
- Modify: `e2e/assessment-flow.spec.ts`
- Modify: `e2e/capture-errors.spec.ts`

- [ ] **Step 1: Badge assertion on the fixture golden path**

In `e2e/assessment-flow.spec.ts`, inside the existing golden-path test after the disclaimer assertion, add:

```ts
    // Fixture frames carry no sensor roll → honest level-unverified badge.
    await expect(page.locator('[data-testid="level-badge"]')).toContainText(/level not verified/i)
```

- [ ] **Step 2: Camera degrades gracefully without sensors**

In `e2e/capture-errors.spec.ts`, follow the file's existing setup pattern (read it first — it already opens the camera modal with fake media streams) and add a test:

```ts
  test('camera works without orientation sensors: no gate, no indicator', async ({ page }) => {
    // …reuse the file's existing navigation/modal-open helper steps…
    await expect(page.getByRole('button', { name: '3-2-1 Auto Capture' })).toBeEnabled()
    await expect(page.locator('[data-testid="level-indicator"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="tilt-blocked"]')).toHaveCount(0)
  })
```

- [ ] **Step 3: Full sweep**

```bash
npx vitest run
npm run typecheck
npm run lint
npm run test:e2e
```

Expected: all green. Known watch-outs: `fixtures.test.ts` must still report 25/B/75/18/35 (frames without aspect are untouched); `quality.test.ts` fixture frames must stay `ok`.

- [ ] **Step 4: Manual device verification (required before merge — spec §7 sensor-mapping risk)**

On a real phone over HTTPS (e.g. `next dev` + tunnel, or preview deploy):
1. Open the camera; on iOS tap "Enable level meter" and grant.
2. Hold level → indicator shows green "Level". Tilt the phone's top edge to the RIGHT ~10° → indicator must read "Tilted right ~10°" and the shutter must block with the override visible. **If the direction reads inverted, negate the sign in one place: `rollDeg` in `lib/capture/orientation-math.ts` — then re-run its unit tests and update their expected signs.**
3. Capture at ~3–4° amber tilt → preview shows "Roll …° — will be corrected"; submit; result page shows "Camera level verified — tilt-corrected (…)" and findings match a level capture of the same pose within normal landmark noise.
4. Upload a sideways-shot iPhone photo (EXIF orientation 6) → preview renders upright; result badge shows "Camera level not verified".
5. Record outcomes (device, OS, sign-correct y/n) in `docs/plans/2026-06-12-capture-correctness-tilt-framing-design.md` §7 as a short addendum.

- [ ] **Step 5: Commit + PR**

```bash
git add e2e/assessment-flow.spec.ts e2e/capture-errors.spec.ts
git commit -m "test(e2e): level badge on fixture path; sensorless camera degradation"
git push -u origin feat/capture-correctness
```

Open a PR to `main`: diff the full branch (`git diff main...HEAD`), summarize all commits, include the test plan (unit suites, e2e, manual device matrix from Step 4).

---

## Out of scope (tracked in spec §8)

Lighting/blur checks; world-landmark/gravity fusion; metric redefinitions (CVA), normative thresholds, grade/percentile model; exercise citations. Do not touch thresholds.ts values or exercise content in this branch.
