# Strength track alongside correctives — design

**Status:** Proposed — approved in-session by Devin 2026-07-10, not implemented.
**Scope:** `content/muscles/types.ts`, `lib/program/*`, `lib/workout/*`, `app/workouts/_player/*`, six new `content/exercises/*.ts`.
**Decisions locked in-session:** parallel track (not a second product surface); 4-week mesocycle with deload; first content slice bounded to bodyweight + band.

## Problem

The app prescribes corrective exercise off a posture assessment. It cannot prescribe general
strength work. A practitioner who wants to give a client both must do the strength half outside
the app, which breaks the coach-approval gate, the frozen `program_snapshot`, and the share link.

Goal: a client's approved plan contains correctives *and* general strength, in one session, under
one approval, playable in the existing player.

## Why this is not a small change

Three seams in the current pipeline resist a strength track. All three are safety features
behaving correctly, so none should be bypassed.

**1. Selection is finding-driven.** `candidatesFor(keys, zone, screenedKeys)` filters exercises by
`primaryDeviationKeys` and gates them by `minZone` against the finding's severity. A general
strength movement has no deviation key, and its appropriateness does not scale with posture
severity. Under today's selector it can never be chosen. Strength needs its own selector.

**2. The contraindication gate is a ratchet.** `lib/program/contraindication.test.ts` derives
every pair shaped *"exercise stretches muscle M for finding K, but concurrent finding K2 marks M
weak"* and fails the build unless each is encoded in `contraindicatedDeviationKeys` or explicitly
adjudicated with a reason. Every strength exercise with muscle links generates new derived pairs.
The adjudication, not the authoring, is the cost. This is why the first slice is six movements.

**3. Dosage is a fixed 3-week ramp where severity never scales dosage.** `computeDose(ex, week)`
takes `Week = 1 | 2 | 3` and `ProgramStep.weeks` is a 3-tuple. Progressive overload wants a longer
horizon with a deload. The two models cannot share a week type.

## Data model

`track: 'corrective' | 'strength'` was the obvious move and is **rejected**. Eleven movements that
belong in a strength block already exist as correctives — `push-up-plus`, `wall-push-up-plus`,
`seated-band-row`, `band-rear-delt-row`, `single-leg-rdl`, `glute-bridge`, `wall-sit`,
`split-squat`, `front-plank`, `side-plank`, `pallof-press`. A one-of-two enum would force
near-duplicate authoring of content we already own.

Instead, **`pattern` is the strength-eligibility marker**, and eligibility is additive:

```ts
// content/muscles/types.ts — exerciseContentSchema
/** Movement pattern. Presence marks this exercise strength-eligible. */
pattern: z.enum(['push', 'pull', 'hinge', 'squat', 'lunge', 'core']).optional(),

primaryDeviationKeys: z.array(z.enum(IMBALANCE_KEYS)),  // was .min(1)
minZone: z.enum(['maintain', 'warning', 'danger']).optional(),  // was required
```

Extend the existing `.superRefine`:

- An exercise must be eligible for something: `primaryDeviationKeys.length > 0 || pattern != null`.
- If `primaryDeviationKeys.length > 0`, `minZone` is required. (Preserves today's semantics.)
- If `primaryDeviationKeys.length === 0`, `minZone` must be absent. A pure strength item has no
  severity gate, and a stray `minZone` on one would read as if it did.

`contraindicatedDeviationKeys` stays and is load-bearing for strength: a movement with no primary
deviation key can still be unsafe for a finding the client presents.

`carry` is deliberately not a pattern. A carry without external load is not a carry, and external
load is out of scope for this slice.

## Selection — `lib/program/buildStrengthBlock.ts`

Pure function, mirroring `buildProgram`'s shape and testability.

```ts
export function buildStrengthBlock(
  result: AssessmentResult,
  capability: Capability,
  usedSlugs: ReadonlySet<string>,
): StrengthBlock | null
```

- Candidates: `ALL_EXERCISES.filter(ex => ex.pattern != null)`.
- Exclude any `isContraindicated(ex, screenedKeys)` — the same exclusion pass correctives use.
- Exclude `usedSlugs` (see Dedupe below).
- Cover each of the six patterns with at most one movement, choosing by `progressionLevel` against
  `Capability` via the existing `CAP_LEVEL` map.
- A pattern with no safe candidate is **omitted, not substituted**. A block of four patterns is a
  correct answer when a client's findings contraindicate the other two.
- Returns `null` when fewer than two patterns survive — the empty-block floor, mirroring
  `generateWorkoutSession`'s empty-session floor.

**Dedupe.** `generateWorkoutSession` already dedupes by slug (`seen.has(step.slug)`) and iterates
priorities before anything else, so a corrective always wins a slug it shares with strength.
`buildStrengthBlock` therefore receives the corrective slugs as `usedSlugs` and picks the next
candidate for that pattern. Without this, `split-squat` selected as a corrective would silently
delete the lunge pattern from the strength block.

## Dosage — `lib/program/strengthDosage.ts`

`computeDose` is not touched. It stays byte-identical, and the corrective 3-week ramp is unchanged.

```ts
export type CycleWeek = 1 | 2 | 3 | 4
export function computeStrengthDose(ex: ExerciseContent, week: CycleWeek, capability: Capability): Dose | null
```

Weeks 1–3 accumulate, week 4 deloads:

| Week | Dynamic | Hold |
|------|---------|------|
| 1 | 2 × 8 | 2 × 20s |
| 2 | 3 × 8 | 3 × 20s |
| 3 | 3 × 12 | 3 × 30s |
| 4 (deload) | 2 × 8 | 2 × 20s |

`capability` applies a flat rep offset to the table above: `regression` −2, `standard` 0,
`progression` +2. So week 3 dynamic is 3 × 10 / 3 × 12 / 3 × 14 respectively. Holds are unaffected
by capability; `progressionLevel` already carries hold difficulty. All reps stay inside
`repRangeSchema`'s 1–30 bound. No external load, no RPE, no autoregulation — bodyweight and band
progression runs on reps, sets, and `progressionLevel`.

## The cycle — how the two tracks coexist

One `CycleWeek = 1 | 2 | 3 | 4` drives both tracks.

- **Correctives:** weeks 1–3 call `computeDose(ex, week)` unchanged. Week 4 calls
  `computeDose(ex, 1)` — the lightest authored dosing, which *is* the deload. No new dosage logic.
- **Strength:** `computeStrengthDose(ex, week, capability)` for all four weeks.
- **Week 4** additionally surfaces the re-assessment CTA. The next cycle is gated on a new
  assessment and a fresh coach approval, so the mesocycle never runs open-loop.

`ProgramReport` gains `strength: StrengthBlock | null`. `ProgramStep.weeks` stays a 3-tuple;
`StrengthStep.weeks` is its own 4-tuple. No existing type widens, so no existing test moves.

## Session snapshot — v2

`generateWorkoutSession` currently writes `version: 1` and `week: Week`. That version is **written
but never read** anywhere in the codebase. The 4-week cycle changes the snapshot's meaning, and
snapshots are frozen in `workout_sessions.program_snapshot` (jsonb, anti-drift), so rows written
today must keep playing.

- Bump to `version: 2`. Replace `week: Week` with `cycleWeek: CycleWeek`.
- Add a reader in `lib/workout/snapshotVersion.ts`: a `version: 1` snapshot maps `week → cycleWeek`
  and yields an empty strength block. v1 rows keep playing, unmodified.
- The mint route writes v2 only. There is no in-place migration of existing rows.
- This closes the "snapshot version guard" item the 2026-07-05 audit left open (`docs/qa/AUDIT.md`).

**`tokenProjection.ts` is a trap.** `redactSessionForPublic` does an explicit field pick:

```ts
const { version, week, capability, priorities, items, estimatedDurationSec, disclaimer } = r.program_snapshot
```

A field not named here is silently dropped from the public share payload. Renaming `week` to
`cycleWeek` without editing this line compiles clean under `SessionSnapshot` and ships a share link
whose week context has vanished. The projection must be updated in the same commit, and
`tokenProjection.test.ts` must assert `cycleWeek` survives the projection.

## Session assembly

`BAND` gains one entry after the corrective arc:

```ts
const BAND = { mobility: 0, stretch: 1, activation: 2, strengthen: 3, build: 4 }
```

Loosen → Lengthen → Wake up → Strengthen → **Build**. The integrative "Connect" item stays pinned
last, after Build, since it remains the week-3 capstone.

`SessionItem` gains `band: 'corrective' | 'build'` so the player can label the transition. Strength
items reuse `SessionTiming` unchanged; `REST_SECONDS` gains `build: 45` — strength work needs real
recovery, and 20s (today's `strengthen` rest) is a corrective-dose number.

`estimatedDurationSec` will roughly double. The results-page duration estimate and the player's
progress segmentation both read it, so neither needs changing — but the "~12 min" copy on the
results page is authored, not computed, and must be re-derived.

## Player UI

The player already has everything a bodyweight/band strength block needs: countdown ring, rep chip,
segmented progress, skip/back/pause, voice cueing. Additions, minimal:

- A **band divider** in the segmented progress bar where Build begins, with a spoken
  "Now the strength block" cue at the transition.
- A **rest timer** between strength sets. The corrective bands pass through their 10–20s rest with
  no UI; 45s wants a visible countdown.
- Week-4 sessions render a **deload badge** and, on completion, the re-assessment CTA.

Explicitly **not** building: set-level logging, load entry, RPE capture. All three are
autoregulation infrastructure, and this design is a fixed mesocycle. `workout_ratings` already
captures per-session difficulty, which is the signal the coach needs to pick next cycle's
`Capability`.

## Content — six new movements

Eleven existing correctives become strength-eligible with a one-line `pattern` addition and no
other change:

| Pattern | Existing | New |
|---------|----------|-----|
| push | `push-up-plus`, `wall-push-up-plus` | `push-up` |
| pull | `seated-band-row`, `band-rear-delt-row` | `band-single-arm-row` |
| hinge | `single-leg-rdl`, `glute-bridge` | `bodyweight-good-morning` |
| squat | `wall-sit` | `bodyweight-squat` |
| lunge | `split-squat` | `reverse-lunge` |
| core | `front-plank`, `side-plank`, `pallof-press` | `hollow-hold` |

Six new files. Every one is **originally authored**. `data/exercises-dataset/` remains a reference
index and is never copied — its license is unresolved (ExerciseDB v1 → Kaggle re-host, no OSS
license; see `ZS-INTEGRATION.md`), and `content/muscles/types.ts` already carries the rule:
*"third-party dataset text is reference only, never copied."*

## Test gates every new exercise must clear

Adding a `pattern` to an existing corrective changes its eligibility, so the ratchets re-derive for
all seventeen movements (eleven existing + six new), not just the six new ones.

- `content/content.test.ts`, `exercise-coverage.test.ts`, `exercise-steps-schema.test.ts` — schema.
- `lib/program/coherence.test.ts` — each (exercise × finding) pair in isolation.
- `lib/program/contraindication.test.ts` — the cross-finding ratchet. **New derived pairs must be
  adjudicated, not silenced.** Expect this to be the bulk of the work.
- `lib/ui-vocabulary.test.ts` — the clinical-vocabulary gate on all new copy.
- New: `buildStrengthBlock.test.ts`, `strengthDosage.test.ts`, `snapshotVersion.test.ts`.

## Fable 5 partition

Per mem0 `posture-ai-fable5-hot-and-safe-zones`, this work spans both classifier axes.

- **Hot (delegate to Sonnet subagents):** the six new `content/exercises/*.ts`, the `pattern`
  additions to the nine existing ones, every contraindication adjudication, `contraindication.test.ts`.
- **Safe (Fable 5 shell):** `buildStrengthBlock.ts`, `strengthDosage.ts`, `snapshotVersion.ts`,
  `generateWorkoutSession.ts` band ordering, `CountdownRing`, the rest timer, the progress divider.
- **Prerequisite:** extract the red-flag and consent copy out of `WorkoutPlayer.tsx` into its own
  module first. It is the only biology-hot content in the player, the file is 815 lines against an
  800-line hard max, and the extraction is needed anyway.
- The orchestrator prompt must be framed in slugs, schema fields, and patterns — never anatomy.

## Out of scope

External load (dumbbell, kettlebell, barbell). RPE and autoregulation. Set-level logging. Cardio
and conditioning. Cycle-over-cycle progression history. Demo media for the new movements — the
`media` block is optional and **0 of 73** exercises populate it today; the player falls back to
poster/text, and asset acquisition is a separate, unresolved decision.
