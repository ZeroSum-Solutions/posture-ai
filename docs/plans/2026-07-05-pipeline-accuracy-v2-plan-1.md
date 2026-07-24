# Pipeline Accuracy v2 — Plan 1 of 2 (Golden Harness + Engine v2 + Capture Measurement) Implementation Plan

> **Historical implementation record:** The embedded Tier B collection and
> ingest instructions are superseded by
> `docs/qa/tierb-reliability/protocol.md`. Do not run its 3–5-person,
> staged-pose, 144-photo, or direct photo-to-landmark workflow for human data.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the golden accuracy-regression harness (spec §1), ship engine v2.0.0 with the trunk-lean merge, validity-weighted scoring, percentile removal, and uncertainty-aware borderline zones (spec §3), and produce the data-driven capture verdicts (spec §2).

**Architecture:** A synthetic 3D-skeleton→projection generator produces landmark frames whose expected metric values are true by construction; a golden runner turns engine accuracy into a CI-gated number. With that referee in place, the engine's proved defects are fixed: the byte-identical `t1_tilt_backward`/`anterior_pelvic_shift` vector becomes one `trunk_lean` finding (engine + content + DB + copy), the overall score becomes validity-weighted, and findings near a zone edge relative to their own burst uncertainty are flagged `borderline`.

**Tech Stack:** TypeScript, vitest, Playwright, `@posture-ai/engine` workspace package, Supabase migrations (forward-only), Next.js 16 App Router.

**Spec:** `docs/plans/2026-07-05-pipeline-accuracy-v2-design.md` (approved). Plan 2 (spec §4–§5: muscle-link evidence grading + exercise coherence) is written AFTER this plan lands, against the merged `trunk_lean` reality.

## Global Constraints

- **Screening vocabulary:** no user-visible string may match `BANNED_TERM_PATTERNS` (`content/muscles/types.ts:6`) — diagnos*/treat*/cure*/patient*/prescri*. `npm run lint:vocab` must stay green.
- **Photos never enter git.** Only landmark JSON + measured angles + device metadata are committed. `packages/posture-engine/golden/photos-local/` is gitignored.
- **Local Supabase only** for any DB work. Verify `grep NEXT_PUBLIC_SUPABASE_URL .env.local` shows `127.0.0.1` before seeding. Production project `dhrkezfypzutiwtmcmof` is untouchable from this plan.
- **Forward-only migrations**, filename pattern `2026MMDDHHMMSS_slug.sql`, applied locally with `npx supabase db reset`.
- **e2e port gotcha:** run `npm run test:e2e` with **:3100 free** — `playwright.config.ts` reuses an existing server on :3100 and a prod bundle there 403s `create-test-user`, breaking auth setup (PASS-01).
- **Stored v1.3 assessments are immutable.** Old findings render from stored rows; legacy imbalance keys keep working in copy maps and `imbalance_definitions` rows are never deleted.
- **One task = one branch**, conventional commit, verify (typecheck + vitest + golden once it exists), land with `~/bin/zs-land`. Full e2e per phase end, not per task.
- **Engine metric tolerance:** orthographic synthetic fixtures must recover spec angles within **0.15°**; perspective fixtures are measured, not asserted (their error IS a result).
- `ENGINE_VERSION` bumps to `'2.0.0'` exactly once, in Task 5.

## File Structure (new/modified)

```
packages/posture-engine/
  golden/
    synthetic.ts            NEW  parametric 3D skeleton → PoseFrame generator + expectedDeviations
    cases.ts                NEW  the golden fixture matrix (specs + expected values)
    baseline.json           NEW  accepted per-metric MAE snapshot (regenerated only via --accept)
    protocol.md             NEW  Tier B volunteer capture protocol
    tierb/                  NEW  committed landmark JSON + metadata from volunteer photos
    photos-local/           NEW  gitignored — raw photos never committed
    reports/                NEW  generated analysis reports (noise, pitch, model-compare)
  __tests__/
    golden-synthetic.test.ts   NEW  generator recovers spec angles (Tier A correctness)
    golden-properties.test.ts  NEW  invariance + sensitivity property tests
  src/
    metrics.ts              MOD  t1TiltBackward + anteriorPelvicShift → trunkLean
    engine.ts               MOD  findings list, weighted score, version 2.0.0, borderline
    thresholds.ts           MOD  trunk_lean entry, VALIDITY_WEIGHT, toPercentile removed
    types.ts                MOD  Finding.borderline, AssessmentResult.overallPercentile removed
scripts/
  golden-report.mjs         NEW  runner: score cases, MAE, drift-vs-baseline, --accept
  golden-model-compare.mjs  NEW  lite-vs-full over Tier B (Task 13)
app/dev/golden-ingest/page.tsx  NEW  dev-only photo→landmarks ingest page (prod-blocked)
content/muscles/*.ts        MOD  imbalanceKey remaps (10 files)
content/exercises/*.ts      MOD  primaryDeviationKeys remaps (24 files)
content/muscles/types.ts    MOD  IMBALANCE_KEYS: trunk_lean added, legacy keys kept for stored data
content/report/imbalance-copy.ts MOD  trunk_lean entry added; legacy entries kept
supabase/migrations/2026070600000{0,1}_*.sql NEW  trunk_lean defs/links/exercises remap; borderline column
lib/findings/buildFindingRow.ts MOD  borderline passthrough
lib/pdf/report.tsx          MOD  "Top X%" stat removed
app/assessments/[id]/page.tsx MOD  borderline pill + per-finding validity label
.github/workflows/ci.yml    MOD  golden step
package.json                MOD  "golden" script
```

---

## Phase 1 — Golden harness (spec §1)

### Task 1: Synthetic pose generator (Tier A ground truth)

**Files:**
- Create: `packages/posture-engine/golden/synthetic.ts`
- Test: `packages/posture-engine/__tests__/golden-synthetic.test.ts`

**Interfaces:**
- Consumes: `PoseFrame`, `Landmark` from `../src/types` (read `packages/posture-engine/src/types.ts:1-23` first).
- Produces (later tasks rely on these exact signatures):
  ```ts
  export interface PostureSpec {
    trunkLeanDeg?: number         // + = shoulders anterior of hips (side view)
    forwardHeadDeg?: number       // + = ear anterior of shoulder (side view)
    shoulderTiltDeg?: number      // + = subject's LEFT shoulder lower (front)
    pelvicTiltDeg?: number        // + = subject's LEFT hip lower (front)
    kneeValgusLeftDeg?: number    // + = left knee toward midline (front)
    kneeValgusRightDeg?: number
    kneeHyperextensionDeg?: number // + = knee posterior to hip–ankle chord (side)
  }
  export interface CameraSpec {
    distanceM?: number  // default Infinity = orthographic (exact ground truth)
    pitchDeg?: number   // + = camera pitched down; default 0
    rollDeg?: number    // camera roll baked into image; default 0
    heightM?: number    // camera height above subject mid-hip; default 0
  }
  export function generatePose(view: 'front' | 'side', spec?: PostureSpec, cam?: CameraSpec): PoseFrame
  export function generateBurst(view: 'front' | 'side', spec: PostureSpec, cam: CameraSpec, n: number, jitterSigma: number, seed: number): PoseFrame[]
  export function expectedDeviations(spec: PostureSpec): Record<string, number>
  ```

- [ ] **Step 1: Write the failing test**

`packages/posture-engine/__tests__/golden-synthetic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generatePose, expectedDeviations } from '../golden/synthetic'
import {
  forwardHeadPosture, anteriorImbalancedShoulders, pelvicObliquity,
  t1TiltBackward, anteriorPelvicShift, genuVarumValgumLeft, kneeExtensionBackKnee,
} from '../src/metrics'

const TOL = 0.15 // degrees, orthographic

describe('synthetic generator recovers spec angles (orthographic)', () => {
  it('neutral pose yields ~0 on every metric', () => {
    const front = generatePose('front')
    const side = generatePose('side')
    expect(Math.abs(forwardHeadPosture(side).deviation)).toBeLessThan(TOL)
    expect(Math.abs(anteriorImbalancedShoulders(front).deviation)).toBeLessThan(TOL)
    expect(Math.abs(pelvicObliquity(front).deviation)).toBeLessThan(TOL)
    expect(Math.abs(t1TiltBackward(side).deviation)).toBeLessThan(TOL)
    expect(Math.abs(genuVarumValgumLeft(front).deviation)).toBeLessThan(TOL)
    expect(Math.abs(kneeExtensionBackKnee(side).deviation)).toBeLessThan(TOL)
  })

  it('MediaPipe front-view mirror convention holds: subject left at larger image x', () => {
    const front = generatePose('front')
    expect(front.landmarks['left_shoulder'].x).toBeGreaterThan(front.landmarks['right_shoulder'].x)
  })

  it('side view faces image-right (toe.x > heel.x) so anterior labels resolve', () => {
    const side = generatePose('side')
    expect(side.landmarks['left_foot_index'].x).toBeGreaterThan(side.landmarks['left_heel'].x)
  })

  it.each([
    [{ trunkLeanDeg: 8 }, 't1', (f: any) => t1TiltBackward(f).deviation, 8],
    [{ trunkLeanDeg: 8 }, 'shift', (f: any) => anteriorPelvicShift(f).deviation, 8],
    [{ forwardHeadDeg: 12 }, 'fhp', (f: any) => forwardHeadPosture(f).deviation, 12],
    [{ kneeHyperextensionDeg: 7 }, 'knee', (f: any) => kneeExtensionBackKnee(f).deviation, 7],
  ])('side-view spec %j recovers %s = %d°', (spec, _label, metric, want) => {
    const side = generatePose('side', spec as any)
    expect(Math.abs(metric(side) - (want as number))).toBeLessThan(TOL)
  })

  it.each([
    [{ shoulderTiltDeg: 4 }, (f: any) => anteriorImbalancedShoulders(f), 4, 'Left Low'],
    [{ pelvicTiltDeg: 3 }, (f: any) => pelvicObliquity(f), 3, 'Left Low'],
  ])('front-view spec %j recovers deviation + direction', (spec, metric, want, dir) => {
    const f = metric(generatePose('front', spec as any))
    expect(Math.abs(f.deviation - (want as number))).toBeLessThan(TOL)
    expect(f.direction).toBe(dir)
  })

  it('left knee valgus 6° recovers magnitude and Valgum direction', () => {
    const f = genuVarumValgumLeft(generatePose('front', { kneeValgusLeftDeg: 6 }))
    expect(Math.abs(f.deviation - 6)).toBeLessThan(TOL)
    expect(f.direction).toContain('Valgum')
  })

  it('expectedDeviations mirrors the spec', () => {
    expect(expectedDeviations({ trunkLeanDeg: 8, forwardHeadDeg: 12 })).toMatchObject({
      t1_tilt_backward: 8, anterior_pelvic_shift: 8, forward_head_posture: 12,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @posture-ai/engine -- golden-synthetic`
Expected: FAIL — `Cannot find module '../golden/synthetic'`

- [ ] **Step 3: Write the generator**

`packages/posture-engine/golden/synthetic.ts` — complete implementation:

```ts
import type { PoseFrame, Landmark } from '../src/types'

export interface PostureSpec {
  trunkLeanDeg?: number
  forwardHeadDeg?: number
  shoulderTiltDeg?: number
  pelvicTiltDeg?: number
  kneeValgusLeftDeg?: number
  kneeValgusRightDeg?: number
  kneeHyperextensionDeg?: number
}

export interface CameraSpec {
  distanceM?: number
  pitchDeg?: number
  rollDeg?: number
  heightM?: number
}

type V3 = [number, number, number] // subject space: +x = subject LEFT, +y = up, +z = anterior
const rad = (d: number) => (d * Math.PI) / 180

/** Neutral standing skeleton (~1.7 m), origin at mid-hip. Ears sit exactly
 * above shoulders and knees exactly on the hip–ankle chord so every metric
 * reads 0 at neutral — ground truth by construction. */
function neutralSkeleton(): Record<string, V3> {
  return {
    nose: [0, 0.62, 0.10],
    left_ear: [0.07, 0.65, 0], right_ear: [-0.07, 0.65, 0],
    left_shoulder: [0.18, 0.47, 0], right_shoulder: [-0.18, 0.47, 0],
    left_hip: [0.09, 0, 0], right_hip: [-0.09, 0, 0],
    left_knee: [0.09, -0.42, 0], right_knee: [-0.09, -0.42, 0],
    left_ankle: [0.09, -0.83, 0], right_ankle: [-0.09, -0.83, 0],
    left_heel: [0.09, -0.87, -0.05], right_heel: [-0.09, -0.87, -0.05],
    left_foot_index: [0.09, -0.87, 0.13], right_foot_index: [-0.09, -0.87, 0.13],
  }
}

/** Rotate p about x-axis through pivot by a (radians): +a moves +y toward +z (anterior). */
function rotX(p: V3, pivot: V3, a: number): V3 {
  const y = p[1] - pivot[1], z = p[2] - pivot[2]
  return [p[0], pivot[1] + y * Math.cos(a) - z * Math.sin(a), pivot[2] + y * Math.sin(a) + z * Math.cos(a)]
}

/** Rotate p about z-axis through pivot by a (radians) in the frontal (x-y) plane. */
function rotZ(p: V3, pivot: V3, a: number): V3 {
  const x = p[0] - pivot[0], y = p[1] - pivot[1]
  return [pivot[0] + x * Math.cos(a) - y * Math.sin(a), pivot[1] + x * Math.sin(a) + y * Math.cos(a), p[2]]
}

function applyPosture(P: Record<string, V3>, s: PostureSpec): Record<string, V3> {
  const out: Record<string, V3> = { ...P }
  const midHip: V3 = [0, 0, 0]
  const upper = ['nose', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder']

  if (s.trunkLeanDeg) {
    for (const k of upper) out[k] = rotX(out[k], midHip, rad(s.trunkLeanDeg))
  }
  if (s.forwardHeadDeg) {
    const midShoulder: V3 = [
      (out.left_shoulder[0] + out.right_shoulder[0]) / 2,
      (out.left_shoulder[1] + out.right_shoulder[1]) / 2,
      (out.left_shoulder[2] + out.right_shoulder[2]) / 2,
    ]
    for (const k of ['nose', 'left_ear', 'right_ear']) out[k] = rotX(out[k], midShoulder, rad(s.forwardHeadDeg))
  }
  // + = subject's LEFT lower ⇒ rotate the pair by −deg about the segment midpoint.
  if (s.shoulderTiltDeg) {
    const mid: V3 = [0, 0.47, 0]
    out.left_shoulder = rotZ(out.left_shoulder, mid, -rad(s.shoulderTiltDeg))
    out.right_shoulder = rotZ(out.right_shoulder, mid, -rad(s.shoulderTiltDeg))
  }
  if (s.pelvicTiltDeg) {
    const mid: V3 = [0, 0, 0]
    out.left_hip = rotZ(out.left_hip, mid, -rad(s.pelvicTiltDeg))
    out.right_hip = rotZ(out.right_hip, mid, -rad(s.pelvicTiltDeg))
  }
  // Knee deviation d places the knee off the hip–ankle chord so the interior
  // bend angle is exactly 180−d: lateral offset = halfLen · tan(d/2).
  const halfLen = 0.415
  if (s.kneeValgusLeftDeg) out.left_knee = [0.09 - halfLen * Math.tan(rad(s.kneeValgusLeftDeg) / 2), -0.42, 0]
  if (s.kneeValgusRightDeg) out.right_knee = [-0.09 + halfLen * Math.tan(rad(s.kneeValgusRightDeg) / 2), -0.42, 0]
  if (s.kneeHyperextensionDeg) {
    const off = -halfLen * Math.tan(rad(s.kneeHyperextensionDeg) / 2) // posterior = −z
    out.left_knee = [out.left_knee[0], -0.42, off]
    out.right_knee = [out.right_knee[0], -0.42, off]
  }
  return out
}

/** View transform: front = subject faces camera; side = subject anterior → image-right. */
function toViewSpace(p: V3, view: 'front' | 'side'): V3 {
  if (view === 'front') return p
  // yaw −90° about y: (x, y, z) → (z, y, −x); anterior (+z) → +x (image right)
  return [p[2], p[1], -p[0]]
}

/** Project view-space point to normalized image coords (MediaPipe-style: x right,
 * y DOWN). Front view maps subject-left (+x) to larger image x, matching the
 * MediaPipe convention asserted in metrics.ts:70. */
function project(p: V3, cam: Required<CameraSpec>): Landmark {
  const SCALE = 0.4
  let [x, y, z] = p
  // camera pitch: rotate world about the x-axis at camera height by −pitch
  if (cam.pitchDeg !== 0) {
    const a = -rad(cam.pitchDeg)
    const yy = y - cam.heightM, zz = z
    y = cam.heightM + yy * Math.cos(a) - zz * Math.sin(a)
    z = yy * Math.sin(a) + zz * Math.cos(a)
  }
  let xi: number, yi: number
  if (!Number.isFinite(cam.distanceM)) {
    xi = 0.5 + x * SCALE
    yi = 0.5 - (y - cam.heightM) * SCALE
  } else {
    const depth = cam.distanceM - z
    const f = cam.distanceM // focal chosen so orthographic ≈ perspective at z=0
    xi = 0.5 + (x * f / depth) * SCALE
    yi = 0.5 - ((y - cam.heightM) * f / depth) * SCALE
  }
  if (cam.rollDeg !== 0) {
    const a = rad(cam.rollDeg)
    const rx = xi - 0.5, ry = yi - 0.5
    xi = 0.5 + rx * Math.cos(a) - ry * Math.sin(a)
    yi = 0.5 + rx * Math.sin(a) + ry * Math.cos(a)
  }
  return { x: xi, y: yi, z: 0, visibility: 1 }
}

export function generatePose(view: 'front' | 'side', spec: PostureSpec = {}, cam: CameraSpec = {}): PoseFrame {
  const c: Required<CameraSpec> = {
    distanceM: cam.distanceM ?? Infinity,
    pitchDeg: cam.pitchDeg ?? 0,
    rollDeg: cam.rollDeg ?? 0,
    heightM: cam.heightM ?? 0,
  }
  const pts = applyPosture(neutralSkeleton(), spec)
  const landmarks: Record<string, Landmark> = {}
  for (const [name, p] of Object.entries(pts)) landmarks[name] = project(toViewSpace(p, view), c)
  return { view, landmarks, source: 'camera' }
}

/** Deterministic LCG so bursts are reproducible without Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32)
}

/** Box–Muller gaussian on the LCG. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12), v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function generateBurst(
  view: 'front' | 'side', spec: PostureSpec, cam: CameraSpec, n: number, jitterSigma: number, seed: number,
): PoseFrame[] {
  const rand = lcg(seed)
  return Array.from({ length: n }, () => {
    const frame = generatePose(view, spec, cam)
    const jittered: Record<string, Landmark> = {}
    for (const [name, lm] of Object.entries(frame.landmarks)) {
      jittered[name] = { ...lm, x: lm.x + gaussian(rand) * jitterSigma, y: lm.y + gaussian(rand) * jitterSigma }
    }
    return { ...frame, landmarks: jittered }
  })
}

/** Expected per-metric deviations implied by a spec (orthographic ground truth). */
export function expectedDeviations(spec: PostureSpec): Record<string, number> {
  return {
    forward_head_posture: spec.forwardHeadDeg ?? 0,
    anterior_imbalanced_shoulders: Math.abs(spec.shoulderTiltDeg ?? 0),
    posterior_imbalanced_shoulders: Math.abs(spec.shoulderTiltDeg ?? 0),
    t1_tilt_backward: Math.abs(spec.trunkLeanDeg ?? 0),
    anterior_pelvic_shift: Math.abs(spec.trunkLeanDeg ?? 0),
    pelvic_obliquity: Math.abs(spec.pelvicTiltDeg ?? 0),
    genu_varum_valgum_left: spec.kneeValgusLeftDeg ?? 0,
    genu_varum_valgum_right: spec.kneeValgusRightDeg ?? 0,
    knee_extension_back_knee: spec.kneeHyperextensionDeg ?? 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @posture-ai/engine -- golden-synthetic`
Expected: PASS. If a direction assertion fails (e.g. `Right Low` instead of `Left Low`), the rotation sign in `applyPosture` is inverted for that transform — flip the sign there, NOT in the test: the test encodes MediaPipe/world conventions verified against `metrics.ts:70-73`.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck && npm test -w @posture-ai/engine
git checkout -b feat/golden-synthetic-generator
git add packages/posture-engine/golden/synthetic.ts packages/posture-engine/__tests__/golden-synthetic.test.ts
git commit -m "feat(golden): synthetic 3D pose generator with analytic ground truth"
~/bin/zs-land
```

### Task 2: Invariance + sensitivity property tests

**Files:**
- Create: `packages/posture-engine/__tests__/golden-properties.test.ts`
- Create: `packages/posture-engine/golden/reports/.gitkeep`

**Interfaces:**
- Consumes: `generatePose`, `generateBurst`, `expectedDeviations` (Task 1), `assessPosture` from `../src/engine`.
- Produces: `golden/reports/noise-sensitivity.json` and `golden/reports/pitch-sensitivity.json` (written by the tests; committed — they are results, not caches). Task 12 reads `pitch-sensitivity.json`.

- [ ] **Step 1: Write the tests (they both assert and measure)**

`packages/posture-engine/__tests__/golden-properties.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generatePose, generateBurst, expectedDeviations, type PostureSpec } from '../golden/synthetic'
import { assessPosture } from '../src/engine'
import type { PoseFrame } from '../src/types'

const TOL = 0.15
const SPEC: PostureSpec = { trunkLeanDeg: 6, forwardHeadDeg: 10, shoulderTiltDeg: 3, pelvicTiltDeg: 2, kneeValgusLeftDeg: 5 }
const REPORTS = join(__dirname, '..', 'golden', 'reports')

function findingMap(frames: PoseFrame[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of assessPosture(frames).findings) out[f.key] = f.deviation
  return out
}

function scaleFrame(f: PoseFrame, s: number, dx: number, dy: number): PoseFrame {
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [k, lm] of Object.entries(f.landmarks)) {
    landmarks[k] = { ...lm, x: 0.5 + (lm.x - 0.5) * s + dx, y: 0.5 + (lm.y - 0.5) * s + dy }
  }
  return { ...f, landmarks }
}

describe('engine invariance properties (spec §1 Tier A)', () => {
  const base = [generatePose('front', SPEC), generatePose('side', SPEC)]

  it('scale + translation invariance: subject distance must not change any angle', () => {
    const scaled = base.map(f => scaleFrame(f, 0.6, 0.08, -0.05))
    const a = findingMap(base), b = findingMap(scaled)
    for (const key of Object.keys(a)) {
      if (key === 'pelvic_axial_rotation') continue // never scored, z-based
      expect(Math.abs(a[key] - b[key]), key).toBeLessThan(TOL)
    }
  })

  it('roll round-trip: baked-in camera roll + captureRollDeg metadata ≡ level capture', () => {
    const rolled = [
      { ...generatePose('front', SPEC, { rollDeg: 7 }), captureRollDeg: 7 },
      { ...generatePose('side', SPEC, { rollDeg: 7 }), captureRollDeg: 7 },
    ]
    const a = findingMap(base), b = findingMap(rolled)
    for (const key of Object.keys(a)) {
      if (key === 'pelvic_axial_rotation') continue
      expect(Math.abs(a[key] - b[key]), key).toBeLessThan(0.3) // de-rotation is about image center; small residual allowed
    }
  })

  it('noise sensitivity: writes the per-metric σ table and bounds it', () => {
    const RUNS = 60
    const sums: Record<string, number[]> = {}
    for (let i = 0; i < RUNS; i++) {
      const frames = [
        ...generateBurst('front', SPEC, {}, 1, 0.005, 1000 + i),
        ...generateBurst('side', SPEC, {}, 1, 0.005, 5000 + i),
      ]
      for (const [k, v] of Object.entries(findingMap(frames))) (sums[k] ??= []).push(v)
    }
    const table: Record<string, number> = {}
    for (const [k, xs] of Object.entries(sums)) {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length
      table[k] = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1))
    }
    mkdirSync(REPORTS, { recursive: true })
    writeFileSync(join(REPORTS, 'noise-sensitivity.json'), JSON.stringify({ jitterSigma: 0.005, runs: RUNS, sigmaDegByMetric: table }, null, 2))
    for (const [k, sigma] of Object.entries(table)) {
      if (k === 'pelvic_axial_rotation') continue
      expect(sigma, `metric ${k} explodes under landmark noise`).toBeLessThan(3)
    }
  })

  it('pitch sweep: writes the per-metric error curve (measurement, loose bound)', () => {
    const clean = findingMap(base)
    const curve: Array<{ pitchDeg: number; errorByMetric: Record<string, number> }> = []
    for (const pitch of [0, 5, 10, 15, 20]) {
      const frames = [generatePose('front', SPEC, { pitchDeg: pitch, distanceM: 3 }), generatePose('side', SPEC, { pitchDeg: pitch, distanceM: 3 })]
      const m = findingMap(frames)
      const errorByMetric: Record<string, number> = {}
      for (const key of Object.keys(clean)) {
        if (key === 'pelvic_axial_rotation') continue
        errorByMetric[key] = Math.abs(m[key] - clean[key])
      }
      curve.push({ pitchDeg: pitch, errorByMetric })
    }
    mkdirSync(REPORTS, { recursive: true })
    writeFileSync(join(REPORTS, 'pitch-sensitivity.json'), JSON.stringify({ cameraDistanceM: 3, curve }, null, 2))
    expect(curve.length).toBe(5) // the curve itself is the deliverable; Task 12 applies the spec §2.2 decision rule
  })
})
```

- [ ] **Step 2: Run to verify current truth**

Run: `npm test -w @posture-ai/engine -- golden-properties`
Expected: PASS, and two JSON reports appear under `packages/posture-engine/golden/reports/`. If scale-invariance FAILS, that is a REAL ENGINE BUG — stop, report it, do not loosen `TOL`.

- [ ] **Step 3: Commit (reports included)**

```bash
git checkout -b feat/golden-property-tests
git add packages/posture-engine/__tests__/golden-properties.test.ts packages/posture-engine/golden/reports/
git commit -m "test(golden): engine invariance properties + noise/pitch sensitivity reports"
~/bin/zs-land
```

### Task 3: Golden case matrix, runner, baseline, CI gate

**Files:**
- Create: `packages/posture-engine/golden/cases.ts`
- Create: `scripts/golden-report.mjs`
- Create: `packages/posture-engine/golden/baseline.json` (generated by `--accept`)
- Modify: `package.json:20` (scripts block — add `"golden"`)
- Modify: `.github/workflows/ci.yml:27` (after the engine test step)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `GOLDEN_CASES: Array<{ name: string; spec: PostureSpec; cam?: CameraSpec }>`; CLI contract `npm run golden` (exit 1 on drift) / `npm run golden -- --accept` (rewrite baseline).

- [ ] **Step 1: Write the case matrix**

`packages/posture-engine/golden/cases.ts`:

```ts
import type { PostureSpec, CameraSpec } from './synthetic'

export interface GoldenCase { name: string; spec: PostureSpec; cam?: CameraSpec }

/** Orthographic cases assert exact recovery; the two perspective cases measure
 * real-camera error (reported, tolerated more loosely — their drift matters,
 * not their absolute error). */
export const GOLDEN_CASES: GoldenCase[] = [
  { name: 'neutral', spec: {} },
  { name: 'fhp-warn', spec: { forwardHeadDeg: 6 } },
  { name: 'fhp-danger', spec: { forwardHeadDeg: 16 } },
  { name: 'shoulder-tilt-warn', spec: { shoulderTiltDeg: 3 } },
  { name: 'trunk-lean-warn', spec: { trunkLeanDeg: 4 } },
  { name: 'trunk-lean-danger', spec: { trunkLeanDeg: 9 } },
  { name: 'pelvic-obliquity-warn', spec: { pelvicTiltDeg: 3 } },
  { name: 'valgus-left-danger', spec: { kneeValgusLeftDeg: 16 } },
  { name: 'recurvatum-lit-warn', spec: { kneeHyperextensionDeg: 6 } },
  { name: 'combined-moderate', spec: { forwardHeadDeg: 8, trunkLeanDeg: 5, shoulderTiltDeg: 2.5, kneeValgusRightDeg: 6 } },
  { name: 'perspective-3m', spec: { forwardHeadDeg: 8, trunkLeanDeg: 5 }, cam: { distanceM: 3 } },
  { name: 'perspective-2m-pitch5', spec: { forwardHeadDeg: 8, trunkLeanDeg: 5 }, cam: { distanceM: 2, pitchDeg: 5 } },
]
```

- [ ] **Step 2: Write the runner**

`scripts/golden-report.mjs`:

```js
// Golden accuracy runner: scores every golden case with the CURRENT engine,
// reports per-metric mean absolute error vs analytic ground truth, and fails
// (exit 1) when any metric drifts from the accepted baseline by more than
// DRIFT_TOL. `--accept` rewrites the baseline (review like a snapshot).
// Usage: npm run golden [-- --accept]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const goldenDir = join(root, 'packages/posture-engine/golden')
const baselinePath = join(goldenDir, 'baseline.json')
const accept = process.argv.includes('--accept')
const DRIFT_TOL = 0.05 // degrees of MAE movement allowed without re-accept

// vite-node evaluates the TS engine + cases in one child (same tool qa:seed uses)
const evalTs = `
  import { GOLDEN_CASES } from './packages/posture-engine/golden/cases'
  import { generatePose, expectedDeviations } from './packages/posture-engine/golden/synthetic'
  import { assessPosture } from './packages/posture-engine/src/engine'
  const rows = []
  for (const c of GOLDEN_CASES) {
    const frames = [generatePose('front', c.spec, c.cam), generatePose('side', c.spec, c.cam)]
    const expected = expectedDeviations(c.spec)
    for (const f of assessPosture(frames).findings) {
      if (!(f.key in expected)) continue
      rows.push({ case: c.name, key: f.key, err: Math.abs(f.deviation - expected[f.key]) })
    }
  }
  console.log(JSON.stringify(rows))
`
writeFileSync(join(root, '.golden-eval.ts'), evalTs)
let rows
try {
  rows = JSON.parse(execSync('npx vite-node .golden-eval.ts', { cwd: root, encoding: 'utf8' }).trim().split('\n').pop())
} finally {
  execSync('rm -f .golden-eval.ts', { cwd: root })
}

const byMetric = {}
for (const r of rows) (byMetric[r.key] ??= []).push(r.err)
const mae = Object.fromEntries(
  Object.entries(byMetric).map(([k, xs]) => [k, Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4))]),
)

console.log('Golden per-metric MAE (deg):')
for (const [k, v] of Object.entries(mae)) console.log(`  ${k.padEnd(32)} ${v}`)

if (accept || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify({ acceptedAt: new Date().toISOString(), maeByMetric: mae }, null, 2))
  console.log(`\nBaseline ${accept ? 're-' : ''}accepted → ${baselinePath}`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).maeByMetric
let failed = false
for (const [k, v] of Object.entries(mae)) {
  const prev = baseline[k]
  if (prev === undefined || Math.abs(v - prev) > DRIFT_TOL) {
    console.error(`DRIFT: ${k} MAE ${prev ?? 'n/a'} → ${v} (tol ${DRIFT_TOL})`)
    failed = true
  }
}
for (const k of Object.keys(baseline)) {
  if (!(k in mae)) { console.error(`DRIFT: metric ${k} disappeared from output`); failed = true }
}
if (failed) {
  console.error('\nGolden drift detected. If intentional, re-accept: npm run golden -- --accept')
  process.exit(1)
}
console.log('\nGolden: no drift vs baseline ✓')
```

- [ ] **Step 3: Wire scripts + CI**

In `package.json` scripts block add: `"golden": "node scripts/golden-report.mjs",`
In `.github/workflows/ci.yml` after line 27 (`npm test -w @posture-ai/engine`) add: `      - run: npm run golden`

- [ ] **Step 4: Generate the initial baseline, verify the gate**

```bash
npm run golden -- --accept    # writes baseline.json, prints MAE table
npm run golden                # expected: "no drift vs baseline ✓", exit 0
```

Record the printed MAE table in the commit message body — it is the engine 1.3.0 accuracy statement of record.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/golden-runner-ci
git add packages/posture-engine/golden/cases.ts packages/posture-engine/golden/baseline.json scripts/golden-report.mjs package.json .github/workflows/ci.yml
git commit -m "feat(golden): case matrix + drift-gated accuracy runner in CI"
~/bin/zs-land
```

### Task 4: Tier B protocol + dev-only photo→landmarks ingest page

**Files:**
- Create: `packages/posture-engine/golden/protocol.md`
- Create: `app/dev/golden-ingest/page.tsx`
- Create: `packages/posture-engine/golden/tierb/.gitkeep`
- Modify: `.gitignore` (add `packages/posture-engine/golden/photos-local/`)
- Test: `e2e/golden-ingest.spec.ts`

**Interfaces:**
- Consumes: `detectPose` from `lib/pose/detect.ts` (browser-only — this is WHY ingestion is a page, not a Node script).
- Produces: committed Tier B artifacts `golden/tierb/<subject>/<pose>-<view>-<device>.json` with shape `{ frames: PoseFrame[], groundTruth: Record<string, number>, device: string, capturedAt: string }` — consumed by Task 13.

- [ ] **Step 1: Write the protocol doc**

`packages/posture-engine/golden/protocol.md` — complete content:

```markdown
# Tier B capture protocol — real phones, measured ground truth

Volunteers: 3–5 adults. Each gives a written OK ("I agree my posture photos are
used to test measurement accuracy; photos stay on Devin's machines and are
never published or committed"). Photos NEVER enter git — only extracted
landmark JSON + the measured angles below.

## Setup
- Plain wall, plumb line (string + weight) taped from ~2 m height.
- Phone on tripod/stack at subject mid-hip height, 3.0 m back (tape-measure).
- Inclinometer app open (e.g. iOS Measure > Level): phone roll/pitch within ±1°.
- Marker tape on floor for subject feet (repeatable stance, shoulder width).

## Poses per subject (front AND side for each)
1. neutral — stand comfortably tall
2. staged-trunk-lean — lean whole trunk forward until a second phone held
   against the sternum-to-hip line reads ~8° from vertical; record the number
3. staged-shoulder-drop — small folded towel under one foot (~3 cm) → measured
   shoulder/pelvic tilt; record the towel height and which side
4. staged-forward-head — jut chin forward to a comfortable maximum; a helper
   holds a protractor/phone along ear-to-shoulder and records the angle

## Repeats and devices
- Every pose × 3 REPEATS. Between repeats: lower the phone, step away, re-frame
  from the floor tape. (This measures re-positioning repeatability — the number
  the burst's stabilityScore cannot see.)
- Repeat the full set on BOTH: iPhone Safari and Android Chrome.

## Recording ground truth
For each photo write one line in `golden/photos-local/manifest.csv`:
`subject,pose,view,repeat,device,measured_angle_deg,notes`

## Ingestion
1. `npm run dev`, open http://localhost:3000/dev/golden-ingest
2. Drop each photo; the page runs the real detectPose and downloads
   `<name>.landmarks.json`
3. Move the JSON to `golden/tierb/<subject>/`, fill `groundTruth` from the
   manifest, commit. Photos stay in `golden/photos-local/` (gitignored).
```

- [ ] **Step 2: Write the ingest page**

`app/dev/golden-ingest/page.tsx`:

```tsx
'use client'

/**
 * Dev-only golden Tier B ingest: drop a posture photo, run the REAL detectPose
 * (MediaPipe WASM, same code path as capture), download the landmark JSON for
 * committing under packages/posture-engine/golden/tierb/. Never available in
 * production builds.
 */
import { useState } from 'react'
import { notFound } from 'next/navigation'
import { detectPose } from '@/lib/pose/detect'

export default function GoldenIngestPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [status, setStatus] = useState('Drop a photo (front or side).')
  const [view, setView] = useState<'front' | 'side'>('front')

  async function onFile(file: File) {
    setStatus(`Detecting ${file.name}…`)
    try {
      const bitmap = await createImageBitmap(file)
      const result = await detectPose(bitmap, view)
      const payload = {
        frames: [result],
        groundTruth: {}, // fill from photos-local/manifest.csv before committing
        device: navigator.userAgent,
        capturedAt: new Date().toISOString(),
        sourceFile: file.name,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${file.name.replace(/\.[^.]+$/, '')}.landmarks.json`
      a.click()
      setStatus(`Done: ${a.download} downloaded. Next photo?`)
    } catch (e) {
      setStatus(`Detection failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'monospace' }}>
      <h1>Golden Tier B ingest (dev only)</h1>
      <label>
        View:{' '}
        <select id="golden-view" name="golden-view" value={view} onChange={e => setView(e.target.value as 'front' | 'side')}>
          <option value="front">front</option>
          <option value="side">side</option>
        </select>
      </label>
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f) }}
        style={{ border: '2px dashed #888', padding: 48, marginTop: 16, textAlign: 'center' }}
      >
        {status}
      </div>
      <input id="golden-file" name="golden-file" type="file" accept="image/*" style={{ marginTop: 12 }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
    </main>
  )
}
```

NOTE: before wiring, read `lib/pose/detect.ts` for `detectPose`'s exact signature (it may take an `HTMLImageElement`/`ImageBitmap` + view or config). Adapt the two call-site lines to the real signature — the page structure and JSON contract above are fixed; only the `detectPose(...)` invocation line may change to match reality.

- [ ] **Step 3: e2e smoke (proves the page detects the fixture photo)**

`e2e/golden-ingest.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import path from 'node:path'

// Dev-only page; e2e's webServer runs next dev, so it is reachable here and
// notFound() in production builds keeps it out of prod.
test.describe('golden ingest page', () => {
  test('detects landmarks from a fixture photo and offers the JSON download', async ({ page }) => {
    test.setTimeout(240_000)
    await page.goto('/dev/golden-ingest')
    const download = page.waitForEvent('download', { timeout: 200_000 })
    await page.locator('#golden-file').setInputFiles(
      path.join(__dirname, 'fixtures', 'photos', 'front_standing.jpg'),
    )
    const dl = await download
    expect(dl.suggestedFilename()).toBe('front_standing.landmarks.json')
  })
})
```

- [ ] **Step 4: Gitignore + verify**

Append to `.gitignore`: `packages/posture-engine/golden/photos-local/`

```bash
npm run typecheck
npm run test:e2e -- golden-ingest   # :3100 must be FREE (global constraint)
```
Expected: 1 passed (chromium project; if the config's mobile-webkit project also runs it and WASM is slow there, scope the spec with `test.skip(({ browserName }) => browserName !== 'chromium')` — the page is a dev tool, chromium-only is fine).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/golden-tierb-protocol-ingest
git add packages/posture-engine/golden/protocol.md packages/posture-engine/golden/tierb/.gitkeep app/dev/golden-ingest/page.tsx e2e/golden-ingest.spec.ts .gitignore
git commit -m "feat(golden): Tier B capture protocol + dev-only photo ingest page"
~/bin/zs-land
```

---

## Phase 2 — Engine v2.0.0 (spec §3)

### Task 5: trunk_lean merge — engine

**Files:**
- Modify: `packages/posture-engine/src/metrics.ts:92-159` (both duplicate metrics)
- Modify: `packages/posture-engine/src/thresholds.ts:57-71`
- Modify: `packages/posture-engine/src/engine.ts:4-16,75-86`
- Modify: `packages/posture-engine/golden/synthetic.ts` (`expectedDeviations`)
- Test: `packages/posture-engine/__tests__/engine.test.ts` + golden tests (update expectations)

**Interfaces:**
- Produces: `trunkLean(side: PoseFrame): Finding` with `key: 'trunk_lean'`, `label: 'Trunk Lean'`, `region: 'spine'`, direction `'Forward' | 'Backward' | 'Neutral'`. Old exports `t1TiltBackward`, `anteriorPelvicShift` are DELETED (grep confirms zero remaining importers after this task).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

In `packages/posture-engine/__tests__/engine.test.ts` add (and update the existing 10-findings-count assertions to 9):

```ts
it('emits exactly one trunk_lean finding and no legacy t1/shift keys', () => {
  const result = assessPosture([generatePose('front', {}), generatePose('side', { trunkLeanDeg: 6 })])
  const keys = result.findings.map(f => f.key)
  expect(keys).toContain('trunk_lean')
  expect(keys).not.toContain('t1_tilt_backward')
  expect(keys).not.toContain('anterior_pelvic_shift')
  const tl = result.findings.find(f => f.key === 'trunk_lean')!
  expect(Math.abs(tl.deviation - 6)).toBeLessThan(0.15)
  expect(tl.direction).toBe('Forward')
})
```

Update `expectedDeviations` in `golden/synthetic.ts`: replace the two lines
`t1_tilt_backward: …` and `anterior_pelvic_shift: …` with
`trunk_lean: Math.abs(spec.trunkLeanDeg ?? 0),` and update the Task 1 test's
`expectedDeviations` assertion accordingly.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @posture-ai/engine`
Expected: FAIL (no `trunk_lean` key emitted yet).

- [ ] **Step 3: Implement**

In `metrics.ts`, DELETE `t1TiltBackward` (lines 92-118) and `anteriorPelvicShift` (lines 133-159) and add in their place:

```ts
/** 4. Trunk lean — side view. ONE finding for the shoulder→hip lean from
 * vertical. Replaces the former t1_tilt_backward + anterior_pelvic_shift,
 * which computed this identical vector twice and double-counted it in the
 * overall score (engine 2.0.0 merge; see docs/plans/2026-07-05-pipeline-accuracy-v2-design.md §3.1). */
export function trunkLean(side: PoseFrame): Finding {
  const key = 'trunk_lean'
  const ls = getLm(side, 'left_shoulder')
  const rs = getLm(side, 'right_shoulder')
  const lh = getLm(side, 'left_hip')
  const rh = getLm(side, 'right_hip')

  const useRight = (rs?.visibility ?? 0) > (ls?.visibility ?? 0)
  const shoulder = useRight ? rs : ls
  const hip = useRight ? rh : lh

  if (!shoulder || !hip) return makeFinding(key, 'Trunk Lean', 'spine', 0, 'Neutral', 'side', 0, [])

  const conf = minVis(shoulder, hip)
  const dx = hip.x - shoulder.x
  const dy = hip.y - shoulder.y
  const deviation = Math.abs(angleFromVertical(dx, dy))
  // Facing-aware label: Forward = shoulders anterior of hips (toward where the
  // subject faces); unverifiable facing keeps the magnitude, asserts no label.
  const face = sagittalFacing(side, useRight)
  const shoulderAnterior = Math.sign(shoulder.x - hip.x) * face
  const direction = deviation < 1 || face === 0 ? 'Neutral' : shoulderAnterior > 0 ? 'Forward' : 'Backward'
  return makeFinding(key, 'Trunk Lean', 'spine', deviation, direction, 'side', conf,
    useRight ? ['right_shoulder', 'right_hip'] : ['left_shoulder', 'left_hip'])
}
```

In `thresholds.ts:61-63`, replace the two entries with one:

```ts
  trunk_lean:                     { warn: eng(3),  danger: eng(8),  note: PROXY_NOTE },
```

In `engine.ts`: update the import list (drop `t1TiltBackward`, `anteriorPelvicShift`; add `trunkLean`); in the findings array replace the two `aggregate(side, …)` lines (79 and 81) with the single `aggregate(side, trunkLean),`; set `ENGINE_VERSION = '2.0.0'` with a changelog comment line: `// 2.0.0: trunk_lean merge — t1_tilt_backward + anterior_pelvic_shift were the identical shoulder→hip vector scored twice; now one finding.`

- [ ] **Step 4: Run all engine tests, fix every assertion that counted 10 findings or referenced legacy keys**

```bash
npm test -w @posture-ai/engine
grep -rn "t1_tilt_backward\|anterior_pelvic_shift\|t1TiltBackward\|anteriorPelvicShift" packages/posture-engine/src packages/posture-engine/__tests__
```
Expected: tests PASS; grep returns ZERO hits in `src/` (fixtures/tests may keep legacy-key references only where explicitly asserting absence).

- [ ] **Step 5: Re-accept golden baseline (the drift is the point)**

```bash
npm run golden            # expected: DRIFT errors (metric disappeared / new key) — exit 1
npm run golden -- --accept
npm run golden            # expected: clean
```

- [ ] **Step 6: Commit**

App-layer tests (vitest at repo root) WILL fail at this point — content still references legacy keys. That is expected mid-phase; Tasks 6–8 restore green. Run only engine tests + golden here, commit to the branch, do NOT land yet:

```bash
git checkout -b feat/engine-v2-trunk-lean
git add packages/posture-engine
git commit -m "feat(engine)!: merge duplicate trunk metrics into trunk_lean, engine 2.0.0"
```

(This branch stays open through Task 8; Tasks 6–8 commit onto it and it lands once root vitest is green — one coherent breaking change, one PR.)

### Task 6: Validity-weighted overall score + percentile removal (engine + PDF)

**Files:**
- Modify: `packages/posture-engine/src/thresholds.ts` (add `VALIDITY_WEIGHT`, delete `toPercentile` lines 109-112, recalibrate `GRADE_BANDS` 74-81)
- Modify: `packages/posture-engine/src/engine.ts:88-95,121-134`
- Modify: `packages/posture-engine/src/types.ts:54-59` (drop `overallPercentile`)
- Modify: `lib/pdf/report.tsx:293,436-437`
- Modify: `app/api/assessments/route.ts` + `app/assessments/[id]/page.tsx:80` + `app/api/reports/route.ts` (stop writing/reading `overall_percentile`; keep the DB column, write NULL)
- Test: `packages/posture-engine/__tests__/thresholds.test.ts`, `engine.test.ts`

**Interfaces:**
- Produces: `export const VALIDITY_WEIGHT: Record<MetricValidity, number> = { VALIDATED: 1, LITERATURE_CITED: 1, SCREENING_ONLY: 0.5 }`. `AssessmentResult` no longer has `overallPercentile`; `toPercentile` no longer exists.

- [ ] **Step 1: Write the failing tests**

```ts
// engine.test.ts
it('weights the overall score by metric validity × landmark confidence', () => {
  // One literature-cited metric (knee_extension) at danger and one proxy
  // (trunk_lean) at maintain must NOT average to the midpoint: the cited
  // metric carries double the proxy weight.
  const frames = [generatePose('front', {}), generatePose('side', { kneeHyperextensionDeg: 12, trunkLeanDeg: 1 })]
  const r = assessPosture(frames)
  const knee = r.findings.find(f => f.key === 'knee_extension_back_knee')!
  const trunk = r.findings.find(f => f.key === 'trunk_lean')!
  const reliable = r.findings.filter(f => f.reliable)
  const unweighted = Math.round(reliable.reduce((a, f) => a + f.severityPct, 0) / reliable.length)
  expect(r.overallScore).not.toBe(unweighted)
  expect(knee.severityPct).toBeGreaterThan(trunk.severityPct) // sanity of the setup
})

it('no longer emits overallPercentile', () => {
  const r = assessPosture([generatePose('front', {}), generatePose('side', {})])
  expect('overallPercentile' in r).toBe(false)
})
```

- [ ] **Step 2: Verify failure** — `npm test -w @posture-ai/engine` → FAIL.

- [ ] **Step 3: Implement**

`thresholds.ts` — delete `toPercentile` (109-112); add below `metricValidity`:

```ts
/** Overall-score weights by honesty frame (spec §3.2): a literature-cited
 * metric carries full weight; a screening proxy carries half. VALIDATED is
 * reserved for post-study promotion. */
export const VALIDITY_WEIGHT: Record<MetricValidity, number> = {
  VALIDATED: 1,
  LITERATURE_CITED: 1,
  SCREENING_ONLY: 0.5,
}
```

`engine.ts` — replace lines 88-95 with:

```ts
  // Overall score (spec §3.2): validity- and confidence-weighted mean of
  // severityPct over reliable findings. weight = VALIDITY_WEIGHT[validity] ×
  // landmarkConfidence (the finding's 0–1 visibility-derived confidence).
  const reliable = findings.filter(f => f.reliable)
  const weightOf = (f: Finding) => VALIDITY_WEIGHT[metricValidity(f.key)] * f.confidence
  const totalWeight = reliable.reduce((a, f) => a + weightOf(f), 0)
  const overallScore = totalWeight > 0
    ? Math.round(reliable.reduce((a, f) => a + f.severityPct * weightOf(f), 0) / totalWeight)
    : 0

  const overallGrade = toGrade(overallScore)
```

Update imports (`toGrade, metricValidity, VALIDITY_WEIGHT` from `./thresholds`; drop `toPercentile`), delete `overallPercentile` from the return object and from `types.ts`.

**Grade-band recalibration by invariant** (not judgment): add to `thresholds.test.ts`:

```ts
import { GRADE_BANDS, toGrade } from '../src/thresholds'
import { GOLDEN_CASES } from '../golden/cases'
import { generatePose } from '../golden/synthetic'
import { assessPosture } from '../src/engine'

const gradeOf = (name: string) => {
  const c = GOLDEN_CASES.find(x => x.name === name)!
  return assessPosture([generatePose('front', c.spec, c.cam), generatePose('side', c.spec, c.cam)]).overallGrade
}

it('grade bands discriminate the golden anchor cases', () => {
  expect(gradeOf('neutral')).toBe('S')
  expect(['A', 'B']).toContain(gradeOf('trunk-lean-warn'))
  expect(['B', 'C']).toContain(gradeOf('trunk-lean-danger'))
  expect(['C', 'D', 'E']).toContain(gradeOf('combined-moderate'))
})
```

Run it; if any anchor fails, adjust `GRADE_BANDS` cutpoints (the `max` values only) until all four anchors hold, and document each changed cutpoint with a `// recalibrated 2026-07: <old>→<new>, anchor: <case>` comment. This is the spec's "recalibrated once against the golden distribution", executed as a test-driven invariant.

`lib/pdf/report.tsx`: delete lines 436-437 (the Percentile stat block — remove the whole `<View>` wrapping those two `<Text>`s) and change line 293 to `overall_percentile: number | null`.
API routes: in `app/api/assessments/route.ts` write `overall_percentile: null` (grep `overall_percentile` there for the insert site); reads in `page.tsx:80` / `reports/route.ts` type it `number | null` and never render it (UI already suppresses per O2 — `page.tsx:904`).

- [ ] **Step 4: Verify** — `npm test -w @posture-ai/engine && npm run golden -- --accept && npm run golden && npm run typecheck` → engine green; root vitest still red only on legacy-key content (Tasks 7–8).

- [ ] **Step 5: Commit onto the open branch**

```bash
git add -A && git commit -m "feat(engine)!: validity-weighted overall score, grade-band anchors, percentile removed"
```

### Task 7: trunk_lean merge — content + copy

**Files:**
- Modify: `content/muscles/types.ts` (IMBALANCE_KEYS)
- Modify: the 10 muscle files + 24 exercise files listed by the grep in Step 1
- Modify: `content/report/imbalance-copy.ts`
- Test: `content/content.test.ts` + root vitest suites currently red

- [ ] **Step 1: Enumerate, then remap mechanically**

```bash
grep -rln "t1_tilt_backward\|anterior_pelvic_shift" content/ | tee /tmp/remap-files.txt
perl -pi -e "s/'t1_tilt_backward'/'trunk_lean'/g; s/'anterior_pelvic_shift'/'trunk_lean'/g" $(cat /tmp/remap-files.txt)
```

- [ ] **Step 2: Dedupe collisions the rename created**

```bash
# exercises: a primaryDeviationKeys array may now contain 'trunk_lean' twice
grep -rn "trunk_lean'.*trunk_lean'" content/exercises/ || echo "no exercise dupes"
# muscles: a file may now define the same (imbalanceKey:'trunk_lean', role) twice
grep -rln "trunk_lean" content/muscles/*.ts
```
For every duplicate exercise key: delete the second occurrence in the array.
For every muscle now holding two `trunk_lean` links with the SAME role (expected in `deep-abdominals` [weak+weak], possibly others): merge into ONE link — keep the higher `confidence` if graded, and rewrite `rationale` as one paragraph covering the merged trunk-lean story (screening vocabulary; run `npm run lint:vocab`). Two links with DIFFERENT roles (tight + weak) are legitimate and both stay.

- [ ] **Step 3: Types + copy**

`content/muscles/types.ts` — in `IMBALANCE_KEYS`, replace `'t1_tilt_backward'` and `'anterior_pelvic_shift'` with a single `'trunk_lean'`, and add below the array:

```ts
/** Keys retired by the engine-2.0 trunk_lean merge. Stored v1.3 findings still
 * carry them, so display maps must keep entries for them forever. */
export const LEGACY_IMBALANCE_KEYS = ['t1_tilt_backward', 'anterior_pelvic_shift'] as const
export type LegacyImbalanceKey = (typeof LEGACY_IMBALANCE_KEYS)[number]
```

`content/report/imbalance-copy.ts` — retype the map `Record<ImbalanceKey | LegacyImbalanceKey, ImbalanceCopy>`, KEEP the two legacy entries verbatim, and add:

```ts
  trunk_lean: {
    plainLabel: 'Trunk Lean',
    whatItMeans:
      'Your upper body tends to lean forward or backward of your hips instead of stacking straight over them.',
    whatItCanFeel: 'Lower-back or mid-back fatigue after standing, and a sense of working to stay upright.',
    whatBetterLooksLike: 'Your shoulders stack more easily over your hips, so standing tall takes less effort.',
    reassurance: 'Trunk lean is very common and tends to respond well to a mix of core wake-up work and hip mobility.',
  },
```

- [ ] **Step 4: Fix every remaining red test**

```bash
npx vitest run 2>&1 | tail -30
```
Update test fixtures/assertions in `content/content.test.ts`, `lib/program/*.test.ts`, `lib/workout/*.test.ts`, `lib/pdf/clientReport.test.tsx`, `lib/reports/clientProgram.test.ts`, `app/assessments/[id]/muscleMap.test.ts` — the pattern is always the same: legacy key → `trunk_lean`, 10 findings → 9. Never delete a test; retarget it.

- [ ] **Step 5: Full verify + commit**

```bash
npm run lint:vocab && npx vitest run && npm run typecheck && npm run golden
git add -A && git commit -m "feat(content)!: remap t1_tilt_backward + anterior_pelvic_shift content to trunk_lean"
```

### Task 8: trunk_lean merge — database migration + land

**Files:**
- Create: `supabase/migrations/20260706000000_trunk_lean_merge.sql`
- Test: local `npx supabase db reset` + `npm run qa:seed` + e2e

- [ ] **Step 1: Write the migration**

First inspect the existing definition rows to copy their column shape:
`grep -n "INSERT INTO imbalance_definitions" supabase/migrations/20260101000001_seed_data.sql | head -3` and read one full row.

`supabase/migrations/20260706000000_trunk_lean_merge.sql`:

```sql
-- Engine 2.0.0 trunk_lean merge (spec §3.1). t1_tilt_backward and
-- anterior_pelvic_shift computed the identical shoulder→hip vector; new
-- assessments emit one trunk_lean finding. LEGACY ROWS ARE KEPT: stored v1.3
-- findings reference the old keys forever.

-- 1. New definition (copy the column list from the legacy t1 row; label/copy
--    text below is the canonical trunk_lean wording — screening vocabulary).
INSERT INTO imbalance_definitions (key, label, region, description)
VALUES ('trunk_lean', 'Trunk Lean', 'spine',
  'The upper body leans forward or backward of the hips instead of stacking straight over them.')
ON CONFLICT (key) DO NOTHING;
-- NOTE: if imbalance_definitions has more NOT NULL columns than these four
-- (check \d imbalance_definitions), extend this INSERT with the legacy t1
-- row's values for those columns — never leave defaults to chance.

-- 2. Remap muscle links. UNIQUE (muscle_slug, imbalance_key, role) means a
--    muscle linked to BOTH legacy keys with the same role would collide:
--    delete the anterior_pelvic_shift twin first (deterministic loser), then
--    remap the survivors.
DELETE FROM muscle_imbalance_links a
USING muscle_imbalance_links b
WHERE a.imbalance_key = 'anterior_pelvic_shift'
  AND b.imbalance_key = 't1_tilt_backward'
  AND a.muscle_slug = b.muscle_slug
  AND a.role = b.role;

UPDATE muscle_imbalance_links
SET imbalance_key = 'trunk_lean'
WHERE imbalance_key IN ('t1_tilt_backward', 'anterior_pelvic_shift');

-- 3. Remap exercise deviation keys and dedupe the arrays.
UPDATE exercises
SET primary_deviation_keys = (
  SELECT array_agg(DISTINCT CASE WHEN k IN ('t1_tilt_backward', 'anterior_pelvic_shift') THEN 'trunk_lean' ELSE k END)
  FROM unnest(primary_deviation_keys) AS k
)
WHERE primary_deviation_keys && ARRAY['t1_tilt_backward', 'anterior_pelvic_shift'];
```

- [ ] **Step 2: Verify locally**

```bash
grep NEXT_PUBLIC_SUPABASE_URL .env.local        # MUST print 127.0.0.1 — stop otherwise
npx supabase db reset                            # all migrations incl. the new one
npm run qa:seed
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "SELECT imbalance_key, count(*) FROM muscle_imbalance_links WHERE imbalance_key LIKE '%trunk%' OR imbalance_key IN ('t1_tilt_backward','anterior_pelvic_shift') GROUP BY 1;"
```
Expected: `trunk_lean` rows > 0; ZERO rows for either legacy key; reset exits 0.

- [ ] **Step 3: Full gate + land the whole engine-v2 branch**

```bash
npm run typecheck && npm run lint:vocab && npx vitest run && npm test -w @posture-ai/engine && npm run golden
# :3100 must be free:
npm run test:e2e
git add supabase/migrations/20260706000000_trunk_lean_merge.sql
git commit -m "feat(db): trunk_lean merge migration — remap links and exercise keys, keep legacy rows"
~/bin/zs-land
```

This lands Tasks 5–8 as one squashed PR: "engine v2.0.0 — trunk_lean merge + validity-weighted score".

### Task 9: Uncertainty-aware borderline zones

**Files:**
- Modify: `packages/posture-engine/src/types.ts:28-52` (Finding), `packages/posture-engine/src/engine.ts` (withStability), `packages/posture-engine/src/thresholds.ts` (export helper)
- Modify: `lib/findings/buildFindingRow.ts`
- Create: `supabase/migrations/20260706010000_findings_borderline.sql`
- Modify: `app/assessments/[id]/page.tsx` (finding card zone pill area — locate with `grep -n "finding-card-" "app/assessments/[id]/page.tsx"`)
- Test: engine tests + `lib/findings/storedFindingToEngine.test.ts`

**Interfaces:**
- Produces: `Finding.borderline?: boolean`; `FindingRow.borderline: boolean | null`; DB column `assessment_findings.borderline BOOLEAN`.

- [ ] **Step 1: Failing engine test**

```ts
it('flags borderline when the deviation sits within its own σ of a zone edge', () => {
  // trunk_lean warn edge = 3°; burst engineered so median ≈ 2.8° with σ ≈ 0.5°
  const burst = generateBurst('side', { trunkLeanDeg: 2.8 }, {}, 5, 0.004, 42)
  const r = assessPosture([generatePose('front', {}), ...burst])
  const tl = r.findings.find(f => f.key === 'trunk_lean')!
  expect(tl.uncertaintyDeg).toBeGreaterThan(0)
  if (Math.abs(Math.abs(tl.deviation) - 3) < tl.uncertaintyDeg!) expect(tl.borderline).toBe(true)
})

it('never flags borderline for a comfortably mid-zone finding', () => {
  const burst = generateBurst('side', { trunkLeanDeg: 5.5 }, {}, 5, 0.001, 7)
  const r = assessPosture([generatePose('front', {}), ...burst])
  expect(r.findings.find(f => f.key === 'trunk_lean')!.borderline).toBeFalsy()
})
```

- [ ] **Step 2: Verify failure, then implement**

`thresholds.ts` add:

```ts
/** Distance (deg) from |deviation| to the nearest zone boundary of key. */
export function distanceToZoneEdge(deviation: number, key: string): number {
  const t = THRESHOLDS[key]
  if (!t) return Infinity
  const abs = Math.abs(deviation)
  return Math.min(Math.abs(abs - t.warn.deg), Math.abs(abs - t.danger.deg))
}
```

`engine.ts` — add `distanceToZoneEdge` to the existing `./thresholds` import, then extend `withStability` (spec §3.4: display softens, program logic unchanged):

```ts
function withStability(
  rep: Finding | null,
  burst: PoseFrame[],
  deviationOf: (f: PoseFrame) => number,
): Finding | null {
  if (!rep || burst.length < 2) return rep
  const sigma = deviationSpread(burst.map(deviationOf))
  const borderline = rep.reliable && sigma > 0 && distanceToZoneEdge(rep.deviation, rep.key) < sigma
  return {
    ...rep,
    uncertaintyDeg: round2(sigma),
    stabilityScore: round2(stabilityFromSigma(sigma)),
    ...(borderline ? { borderline: true } : {}),
  }
}
```

`types.ts` add to Finding: `/** True when |deviation| sits within its own burst σ of a zone boundary — the zone claim is soft (spec §3.4). Display-only; program logic ignores it. */ borderline?: boolean`.
`buildFindingRow.ts`: add `borderline: boolean | null` to `FindingRow` and `borderline: f.borderline ?? null,` to the mapper.
Migration `20260706010000_findings_borderline.sql`: `ALTER TABLE assessment_findings ADD COLUMN IF NOT EXISTS borderline BOOLEAN;`
UI: in the finding card where the zone pill renders (grep anchor above), add after the zone pill:

```tsx
{finding.borderline ? (
  <span title="This reading sits within its own capture variability of a zone boundary — treat the zone as approximate."
    style={{ fontSize: 11, opacity: 0.8, marginLeft: 6 }}>
    ± borderline
  </span>
) : null}
```
(match the card's existing styling idiom — if the card uses Tailwind classes, translate the inline style to the neighboring classes' pattern).

- [ ] **Step 3: Verify + land**

```bash
npm test -w @posture-ai/engine && npx vitest run && npm run typecheck && npm run golden
npx supabase db reset && npm run qa:seed
git checkout -b feat/borderline-zones
git add -A && git commit -m "feat(engine): uncertainty-aware borderline flag on zone-edge findings"
~/bin/zs-land
```

### Task 10: Per-finding validity labels in the results UI

**Files:**
- Modify: `app/assessments/[id]/page.tsx` (finding card; `metric_validity` is ALREADY stored per finding — `lib/findings/buildFindingRow.ts:19,50`)
- Test: extend `e2e/error-states.spec.ts`-style assertion in the existing results e2e OR a vitest DOM test if the card is unit-tested; minimum: `muscleMap.test.ts`-adjacent snapshot not required — assert text presence in the results e2e (`e2e/assessment-flow.spec.ts`).

- [ ] **Step 1: Implement the label**

In the finding card (same grep anchor as Task 9), render from the stored row:

```tsx
<span style={{ fontSize: 11, opacity: 0.7 }}>
  {finding.metric_validity === 'LITERATURE_CITED' ? 'Literature-referenced thresholds' : 'Screening estimate'}
</span>
```
Screening vocabulary check: both strings pass the banned-term patterns (verify with `npm run lint:vocab` — copy lives in code, so also eyeball against `BANNED_TERM_PATTERNS`).

- [ ] **Step 2: e2e assertion**

In `e2e/assessment-flow.spec.ts`, after the findings-count assertion, add:

```ts
await expect(page.getByText('Screening estimate').first()).toBeVisible()
```

- [ ] **Step 3: Verify + land**

```bash
npm run typecheck && npx vitest run && npm run test:e2e   # :3100 free
git checkout -b feat/finding-validity-labels
git add -A && git commit -m "feat(results): per-finding validity labels from stored metric_validity"
~/bin/zs-land
```

---

## Phase 3 — Literature threshold sweep (spec §3.3)

### Task 11: Per-metric literature review → threshold updates

**Files:**
- Create: `docs/plans/2026-07-05-threshold-literature-review.md`
- Modify: `packages/posture-engine/src/thresholds.ts:57-71` (only where citable evidence found)
- Test: `packages/posture-engine/__tests__/thresholds.test.ts`

This task is research-driven: dispatch the **research-literature agent** (PubMed + Consensus) once per metric family, with this exact brief per metric:

> "Find peer-reviewed photogrammetric or 2D-photo posture-screening studies giving normative values or cut-points for <metric description — e.g. 'sagittal trunk inclination angle from vertical, shoulder-to-hip, standing photos'>. I need: the measured construct, the population, the reported normal range / cut-point in degrees, and full citation. Only report values measured on 2D photographs or directly transferable goniometry — reject radiographic-only constructs."

Metric families to sweep (7): forward_head_posture (ear-shoulder-vertical sagittal offset), anterior/posterior_imbalanced_shoulders (photographic shoulder-line obliquity norms), trunk_lean (sagittal trunk inclination norms), pelvic_obliquity (photographic pelvic obliquity / iliac-crest line), genu_varum_valgum (2D frontal knee alignment — expect NOTHING per GENU_NOTE `thresholds.ts:36-38`; a confirmed nothing is the deliverable).

- [ ] **Step 1: Run the sweeps, write the review doc** — one section per metric: search summary, candidate values with citations, verdict (`ADOPT deg=X` / `NO CITABLE VALUE`), and the exact `lit(X, '<citation>')` line to apply.
- [ ] **Step 2: Apply every ADOPT** to `THRESHOLDS`, formatted exactly like the existing `knee_extension_back_knee` entry (`thresholds.ts:66-70`): `lit(deg, 'Author Year (Journal vol:page) — one-line finding (method; transferability note).')`. Update the metric's `note` if it graduates from PROXY_NOTE.
- [ ] **Step 3: Test invariant** — add to `thresholds.test.ts`:

```ts
it('every literature boundary carries a citation; every engineering boundary carries none', () => {
  for (const [key, t] of Object.entries(THRESHOLDS)) {
    for (const b of [t.warn, t.danger]) {
      if (b.source === 'literature') expect(b.citation, key).toBeTruthy()
      else expect(b.citation, key).toBeNull()
    }
  }
})
```

- [ ] **Step 4: Verify + land** — threshold changes move zone boundaries ⇒ golden severity/zone outputs may shift:

```bash
npm test -w @posture-ai/engine && npm run golden        # drift expected iff thresholds changed
npm run golden -- --accept && npm run golden && npx vitest run && npm run typecheck
git checkout -b feat/threshold-literature-sweep
git add -A && git commit -m "feat(engine): literature-cited thresholds where citable; review doc for the rest"
~/bin/zs-land
```

If ZERO metrics gained citations: still land the review doc + test — "every number labeled, honestly engineering" IS the spec's acceptance.

---

## Phase 4 — Capture verdicts (spec §2)

### Task 12: Pitch verdict → gate or documented no-action

**Files:**
- Read: `packages/posture-engine/golden/reports/pitch-sensitivity.json` (Task 2 output)
- Modify (only if rule fires): `app/assessments/new/FullScreenCapture.tsx` (pitch warning at line ~567; roll-gate pattern at lines 280-323)
- Modify: `docs/plans/2026-07-05-pipeline-accuracy-v2-design.md` (append a `## Changelog` entry with the verdict + numbers)

**Decision rule (spec §2.2, verbatim):** if simulated **10° pitch** corrupts ANY scored metric by **>2°**, the soft 15° warning becomes a hard gate at a data-derived angle (the largest pitch whose worst-metric error ≤2°, rounded down to an integer).

- [ ] **Step 1: Apply the rule** — read the JSON, find the `pitchDeg: 10` entry's max `errorByMetric` value. Record verdict + the full table in the design-doc changelog.
- [ ] **Step 2 (only if it fires): implement the gate** — mirror the roll gate exactly: add `const PITCH_GATE_DEG = <derived integer> // from golden/reports/pitch-sensitivity.json, spec §2.2 rule` beside the existing tilt constants; block the shutter and abort mid-burst on `|pitch| > PITCH_GATE_DEG` using the same `tiltBlocked`/countdown-recheck/burst-abort pattern (`FullScreenCapture.tsx:280-323`), with caption copy `Tilt your phone upright — top of the phone too far forward/back.` Add an e2e assertion alongside the existing tilt-gate coverage in `e2e/capture-errors.spec.ts` if the gate ships.
- [ ] **Step 3: Verify + land**

```bash
npm run typecheck && npx vitest run && npm run test:e2e
git checkout -b feat/pitch-verdict
git add -A && git commit -m "feat(capture): pitch sensitivity verdict — <gate at N°|no gate, documented>"
~/bin/zs-land
```

### Task 13: Lite-vs-full model + visibility-floor verdicts — **GATED on Tier B photos**

**Files:**
- Create: `scripts/golden-model-compare.mjs`
- Modify: `docs/plans/2026-07-05-pipeline-accuracy-v2-design.md` (changelog verdicts)
- Modify (only if rule fires): `.env.local` + Vercel env `NEXT_PUBLIC_POSE_MODEL=full`; `packages/posture-engine/src/thresholds.ts:1` (`RELIABILITY_FLOOR`) only if the §2.3 correlation says move it.

**BLOCKED until** `golden/tierb/` holds ≥1 subject × neutral+staged poses per the protocol (Devin's physical task). Do NOT fake this with fixture photos — the e2e fixtures have no measured ground truth.

- [ ] **Step 1: Write the comparison script** (works as soon as data exists):

```js
// scripts/golden-model-compare.mjs — lite vs full over Tier B landmarks.
// Tier B JSONs are produced per model by running the ingest page twice with
// NEXT_PUBLIC_POSE_MODEL=lite then =full (files suffixed -lite / -full).
// Reports per-metric |deviation_lite − deviation_full| and each model's error
// vs measured groundTruth. Decision rule (spec §2.1): any scored metric with
// median |Δ| > 1° across Tier B ⇒ full becomes the default.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const dir = 'packages/posture-engine/golden/tierb'
const subjects = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
if (subjects.length === 0) {
  console.error('No Tier B data yet — capture per golden/protocol.md first.')
  process.exit(2)
}
// Pair *-lite.json / *-full.json, score each through assessPosture via vite-node
// (same pattern as scripts/golden-report.mjs), print the per-metric delta table
// and the verdict line: "VERDICT: full-default = true|false".
// [Implementation mirrors golden-report.mjs's vite-node eval block with the
//  pairing logic above — keep both scripts' eval blocks structurally identical.]
```
Complete the eval block by copying `scripts/golden-report.mjs`'s vite-node pattern (Task 3) and swapping the case loop for the pair loop described in the comment — the two scripts must stay structurally identical so future edits touch both.

- [ ] **Step 2 (post-photos): run + apply the two §2 rules** — model default flip if the 1°-median rule fires (env change + `detect.ts:26-30` default note); `RELIABILITY_FLOOR` move only if the visibility-vs-error correlation on Tier B says 0.5 misclassifies (document the correlation numbers either way).
- [ ] **Step 3: Repeatability numbers** — from the 3-repeat sets, compute per-metric between-recapture spread; append to the design-doc changelog as the honest "±X° when you re-shoot" figure (feeds future Accuracy-card copy; no UI change in this plan).
- [ ] **Step 4: Verify + land** — `npm run typecheck && npx vitest run`, commit `feat(capture): lite-vs-full + visibility-floor verdicts from Tier B`, `~/bin/zs-land`.

---

## Completion checklist (plan-level acceptance, from spec §6)

- [ ] `npm run golden` in CI, Tier A property tests green, protocol written, ≥1 subject ingested end-to-end (Tasks 1–4)
- [ ] Engine 2.0.0: trunk_lean merged through engine+content+DB, weighted score with anchored bands, percentile gone from engine+PDF, borderline shipped, validity labels shipped (Tasks 5–10)
- [ ] Every threshold labeled `literature` (with citation) or `engineering`, review doc committed (Task 11)
- [ ] Pitch / model / floor verdicts recorded with numbers in the design-doc changelog; only rule-fired changes shipped (Tasks 12–13)
- [ ] Full gates green at the end: `npm run typecheck && npm run lint:vocab && npx vitest run && npm test -w @posture-ai/engine && npm run golden && npm run test:e2e`
- [ ] Plan 2 (spec §4–§5) is written AFTER this plan lands — do not start muscle-link grading against pre-merge keys.
