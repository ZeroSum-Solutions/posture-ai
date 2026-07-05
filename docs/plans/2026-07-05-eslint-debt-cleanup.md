# ESLint Debt Cleanup Implementation Plan (backlog item 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run lint` reports 0 errors (currently 9, all pre-existing — verified older than Plan 2 base `38b3b7a` via git merge-base).

**Architecture:** Three mechanical, behavior-preserving fixes in three files: type the synthetic-golden test callbacks properly (7 errors), split a destructure so the never-reassigned binding is `const` (1 error), and replace a reset-on-prop-change `useEffect` with React's documented render-time state adjustment (1 error). No logic changes anywhere.

**Tech Stack:** TypeScript, ESLint 9 (`@typescript-eslint/no-explicit-any`, `prefer-const`, `react-hooks/set-state-in-effect`), Vitest.

## Global Constraints

- **Errors only.** The 22 warnings (unused vars, `<img>`, anonymous default export) are explicitly OUT of scope — surgical changes, separate decision.
- Behavior-preserving: 540-test suite must stay green with zero snapshot changes.
- One feature branch → `~/bin/zs-land` (only when Devin switches to build mode). Never commit to main.

---

### Task 1: Type the golden-synthetic test callbacks (7× `no-explicit-any`)

**Files:**
- Modify: `packages/posture-engine/__tests__/golden-synthetic.test.ts:33-45`

**Interfaces:**
- Consumes: `PoseFrame` (the type `generatePose` already returns) and `PostureSpec` from `packages/posture-engine/golden/synthetic.ts:3,130`. `PostureSpec` is exported from `synthetic.ts` directly; import `PoseFrame` from wherever `synthetic.ts` itself imports it (check its import line — likely `../src/types`).

- [ ] **Step 1: Extend the imports**

Line 2 currently: `import { generatePose, expectedDeviations } from '../golden/synthetic'`. Change to:

```ts
import { generatePose, expectedDeviations, type PostureSpec } from '../golden/synthetic'
import type { PoseFrame } from '../src/types'   // ← match synthetic.ts's own PoseFrame import path
```

- [ ] **Step 2: Replace the five `(f: any)` callbacks and two `spec as any` casts**

Lines 32–48 become (only the types change — table data and assertions identical):

```ts
  it.each([
    [{ trunkLeanDeg: 8 }, 'trunk_lean', (f: PoseFrame) => trunkLean(f).deviation, 8],
    [{ forwardHeadDeg: 12 }, 'fhp', (f: PoseFrame) => forwardHeadPosture(f).deviation, 12],
    [{ kneeHyperextensionDeg: 7 }, 'knee', (f: PoseFrame) => kneeExtensionBackKnee(f).deviation, 7],
  ])('side-view spec %j recovers %s = %d°', (spec, _label, metric, want) => {
    const side = generatePose('side', spec as PostureSpec)
    expect(Math.abs(metric(side) - (want as number))).toBeLessThan(TOL)
  })

  it.each([
    [{ shoulderTiltDeg: 4 }, (f: PoseFrame) => anteriorImbalancedShoulders(f), 4, 'Left Low'],
    [{ pelvicTiltDeg: 3 }, (f: PoseFrame) => pelvicObliquity(f), 3, 'Left Low'],
  ])('front-view spec %j recovers deviation + direction', (spec, metric, want, dir) => {
    const f = metric(generatePose('front', spec as PostureSpec))
    expect(Math.abs(f.deviation - (want as number))).toBeLessThan(TOL)
    expect(f.direction).toBe(dir)
  })
```

(If the tuple inference lets `spec` pass to `generatePose` without any cast, drop `as PostureSpec` entirely — try that first; keep the typed cast only if tsc complains about the widened tuple union.)

- [ ] **Step 3: Verify**

Run: `npx vitest run packages/posture-engine/__tests__/golden-synthetic.test.ts && npx tsc --noEmit -p packages/posture-engine`
Expected: tests PASS, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/posture-engine/__tests__/golden-synthetic.test.ts
git commit -m "chore(lint): type golden-synthetic callbacks, drop any casts (7 errors)"
```

---

### Task 2: `prefer-const` in the synthetic projector

**Files:**
- Modify: `packages/posture-engine/golden/synthetic.ts:103`

Line 103 is `let [x, y, z] = p` inside `project()`. `y` and `z` are reassigned in the pitch branch (`:105-110`); `x` never is (read-only at `:113` and `:118`) — that's what fires the rule.

- [ ] **Step 1: Split the destructure**

```ts
  const [x, y0, z0] = p
  let y = y0, z = z0
```

(Reference check: the only `y`/`z` writes are inside `if (cam.pitchDeg !== 0)`; `x` reads at `:113`/`:118` are untouched.)

- [ ] **Step 2: Verify**

Run: `npx vitest run packages/posture-engine && npm run lint 2>&1 | grep -c prefer-const`
Expected: engine tests PASS (golden fixtures unchanged — pure rename); grep count 0.

- [ ] **Step 3: Commit**

```bash
git add packages/posture-engine/golden/synthetic.ts
git commit -m "chore(lint): const-split projector destructure (prefer-const)"
```

---

### Task 3: `set-state-in-effect` in DemoCanvas

**Files:**
- Modify: `app/workouts/_player/WorkoutPlayer.tsx:424-428` (inside the `DemoCanvas` memo component)

Current code — a reset-on-prop-change effect:

```ts
  useEffect(() => {
    setVideoFailed(false)
    setPosterFailed(false)
  }, [item?.slug])
```

- [ ] **Step 1: Replace with render-time state adjustment** (React's documented pattern for resetting state when a prop changes; no extra render-commit cycle, lint-clean):

```ts
  // Reset media-fallback flags when the exercise changes — adjusted during
  // render (not an effect) so the stale-poster frame never commits.
  const [prevSlug, setPrevSlug] = useState(item?.slug)
  if (item?.slug !== prevSlug) {
    setPrevSlug(item?.slug)
    setVideoFailed(false)
    setPosterFailed(false)
  }
```

Delete the `useEffect` block. Do NOT switch to a `key={item?.slug}` remount — `DemoCanvas` is memoized and remounting would restart the loop video on every item change, a visible behavior change.

- [ ] **Step 2: Verify behavior in the player**

Run: `npx vitest run && npm run lint`
Expected: suite PASS; lint reports **0 errors** (22 warnings remain, out of scope).
Manual spot-check (dev server): play a session past one item boundary; a broken poster on item N must not leave item N+1 showing the fallback.

- [ ] **Step 3: Commit + land**

```bash
git add app/workouts/_player/WorkoutPlayer.tsx
git commit -m "chore(lint): reset DemoCanvas media flags during render, not in effect"
~/bin/zs-land
```

---

## Success Criteria

- [ ] `npm run lint` exit code reflects 0 errors (warnings unchanged at 22)
- [ ] `npx vitest run` — all tests pass, no snapshot updates needed
- [ ] `npx tsc --noEmit` clean (root + `packages/posture-engine`)
- [ ] Diff touches exactly 3 files; every changed line traces to one of the 9 errors

## Coordination note

Task 3 edits `WorkoutPlayer.tsx`, which the red-flag integrity plan (`docs/plans/2026-07-05-red-flag-integrity.md`) also touches. Land this cleanup **before** starting that plan (or rebase it) — both are small, but the red-flag branch restructures the render block and easy conflicts live there.
