# Training Engine Wave 1B Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze and implement the pure, deterministic Wave 1B contracts, 8-week compiler, strength progression, and two-bout conditioning decision engine without changing legacy corrective workouts, persistence, authorization, UI, or clinical policy.

**Architecture:** Add a new dependency-free domain under `lib/training` and authored definitions under `content/training`. Zod validates every external/input boundary; pure functions return discriminated success/failure or proposal/hold/review results with exhaustive reason codes. Tests use synthetic reviewed-catalog fixtures until the real roster and Wave 1A/1C adapters are available.

**Tech Stack:** TypeScript 5, Zod 4, Vitest 3, Node 22.23.2 via mise, npm/package-lock.

**Spec:** `docs/plans/2026-09-07-strength-conditioning-prd.md` (normative); `docs/plans/2026-09-07-strength-conditioning-plan-review.md` (resolved-blocker record); `docs/plans/2026-09-07-strength-product-gap-audit.md` (current-system integration map).

## Global constraints

- Baseline is `ce18f8a67969a68c065875ad4460b161ac04435b`. Preserve the dirty worktree and use checkpoint-only commits; the integrating lead owns any commit.
- Wave 1B exclusively owns `lib/training/**` and `content/training/**`. It must not edit `lib/program/**`, `lib/workout/**`, `app/**`, `supabase/**`, generated database types, or `scripts/run-critical-contracts.mjs`.
- Legacy corrective sessions remain immutable and playable. No legacy finding/priority selector may enter the new compiler.
- The engine must produce the same valid general plan when screening is absent, normal, unavailable, or contains an unvalidated static observation. Screening cannot ban a lift, set load, infer weakness/tightness, or create asymmetric loading.
- The first implemented cycle is the 8-week structure only: week 1 calibration; weeks 2-3 build; week 4 review/adjust; weeks 5-7 build with stable key lifts; week 8 review. The 4/6/12-week and undulating contracts remain Wave 3 work per the independent review.
- Automatic strength changes are load or reps only. Working-set counts stay fixed until an authorized program revision, and no decision changes load and set count together.
- Automatic conditioning changes duration only. V1 never increases duration, intensity, and frequency together.
- Preserve exact entered load as a decimal string plus unit and load basis. Use integer/fixed-point arithmetic; `1 lb = 0.45359237 kg`. Do not add a decimal dependency without the integrating lead's approval.
- Every decision is deterministic, versioned, explainable, and derived only from completed, acknowledged, non-conflicted evidence. Missing stays unknown.
- Production selection is fail closed: only active, reviewed exercise versions with explicit equipment/load limits and reviewed media/fallback status are selectable. Synthetic fixtures must be visibly test-only.
- Clinical eligibility wording and clearance decisions are inputs from Wave 1A/1C. Wave 1B consumes the five states and blocks when required; it does not author triage copy or grant clearance.

## Root dispositions required before activating production content

These are contract gaps, not permission to invent rules. Pure compiler work can proceed against explicit synthetic fixtures, but a production template must remain staged until D1 and D5 are resolved.

| ID | Missing disposition | Why it matters | Safe interim behavior |
| --- | --- | --- | --- |
| D1 | Exact reviewed launch exercise/conditioning roster, stable IDs/versions, allowed equipment, load bases, per-exercise bounds, and media-review status | The PRD deliberately defers the roster until catalog/media review | Keep production registry empty/staged; use `lib/training/testing/fixtures.ts` only in tests |
| D5 | Frozen Wave 1A `ScreeningContextV1` field enums and Wave 1C eligibility/recovery adapter payload, including affected-movement scope | Wave 1B must consume safety state but cannot define clinical policy | Validate an opaque versioned snapshot plus the five states; reject unknown versions/states |

The full PR-01 matrix still applies to the product, but Wave 1B runs it only for the 8-week configurations. The 4/6/12 rows move with their templates to Wave 3; do not make empty placeholder templates merely to turn PR-01 green.

### Frozen lead dispositions from the external audit

The integrating lead accepted these as implementation clarifications in `docs/plans/2026-09-07-grok-contract-dispositions.md`.

| Proposal | Exact contract disposition | Required oracle |
| --- | --- | --- |
| P2: onboarding load history | Store as `source: 'self_reported_history'`; it may seed an explicitly accepted familiarization target, but never a completed exposure, never enters the two-exposure window, and never consumes a load epoch | Self-reported 60 kg × 8 with zero in-app exposures returns familiarization/hold, never 62.5 kg |
| P3: evidence window | A load increase requires both most recent qualifying exposures in the current series/load epoch, each with every prescribed working set at one identical load, ceiling reps, and acceptable effort. Mixed loads return `mixed_working_load_review`. Rep +1 uses the latest qualifying exposure only. Active/aborted sessions and incomplete exercise instances do not progress; explicit terminal completion-with-omissions may preserve completed instances and must store the omissions | 8/8/8 then 8/8/7 at 60 kg proposes 8/8/8 from the latest exposure, not a load increase; a 60/62.5 mixed-load instance reviews; completed primaries plus a terminally omitted accessory may progress only the completed primary series |
| P4: `6_plus` | Preserve it as observed but imprecise and ineligible for autonomous advancement. Ceiling sets at `6_plus` return `effort_too_easy_recalibration`; `unknown` returns `effort_unknown_hold`. Neither creates 62.5 kg | Two all-8 exposures at `6_plus` and two at `unknown` produce the exact distinct codes and no load proposal |
| P5: calibration versus caps | The 5% limit applies only to automatic progression proposals. Every initial/recalibration target requires explicit unit, load-basis, and equipment confirmation and cannot masquerade as a proposal. For voluntarily entered actuals with a positive prior comparable load on the same exact equipment, flag only when `(new - prior) / prior > 0.20`; 60→70 kg is 16.67% and does not trigger it, while 60→75 kg is 25% and does. Zero/unknown prior goes through explicit calibration | 60→70 calibration remains explicit but is not a >20% outlier; 60→75 requires acknowledgement; first-ever 200 kg requires confirmation and catalog bounds; calibration consumes no PR-02 evidence |
| P6: conditioning ceilings/off-days | The initial template caps each bout at 30 minutes and planned weekly conditioning at 60 minutes. Fit the PRD increase within both; no whole minute means hold. Off-day conditioning does not count as a strength session. Reported extra-gym activity is context only and cannot complete a planned bout or enter its evidence window | 10→11, 20→22, 29→30, 30→hold; a two-strength-day plan plus off-day walk is valid; 150 outside minutes do not satisfy planned bouts |
| D2: equipment | Barbell total is configured bar + collars + symmetric plate pairs with counts; plate amounts are per side. Dumbbells and exact-ID machine stacks expose sorted achievable per-hand/stack values. Deduplicate equivalent totals and choose the smallest greater value satisfying the cap. Assistance has a nonnegative supported range and no V1 percentage progression | 0.25 kg plates add 0.50 kg total; a generic increment cannot mean both per-side and total; machine comparisons require the same equipment ID |
| D3: choices | Rank compatible reviewed variants by authored preference then stable exercise-version ID, independent of scans. Rank schedule alternatives by most selected days preserved, then fewest moved sessions, then lexicographic weekday order. Return for explicit acceptance | Multiple valid variants and schedules produce one stable ordering under replay; no automatic acceptance or missed-day doubling |
| D4: starting conditioning | Require explicit acceptance. Offer 10 minutes, bounded downward by an explicitly reported shorter comfortable continuous bout; allow a deliberate 1-20 minute choice. The engine consumes an authored target effort cue/band | Recalled activity cannot complete bouts; 1 and 20 minutes validate, out-of-range duration fails, and posture never changes the suggestion |
| D6: elapsed time | Stale means strictly more than 24 elapsed hours after supplied UTC start. Return review at 14 elapsed days or more since the latest comparable completed exposure. Reject future/inconsistent chronology. Athlete-local date/timezone is for scheduling only. A new comparator series calibrates | Exactly 24h is not stale; 24h plus 1ms is. Exactly 14 days triggers return review; future completion timestamps reject |

## File map and interfaces

| Area | Files | Responsibility / exported boundary |
| --- | --- | --- |
| Shared profile/eligibility contracts (athlete-identity owner) | `lib/training/contracts/{profile,eligibility}.ts` | Capability-free profile schemas plus the five eligibility states/scope/snapshot. Wave 1B imports these exact exports and does not duplicate or infer clinical policy |
| Wave 1B contracts | `lib/training/contracts/{common,screening,catalog,program,session,logs,decisions}.ts`, `lib/training/contracts/index.ts` | Zod schemas and inferred types for screening context, catalog/program/session/log boundaries, `ProgressionDecisionV1`, and `ConditioningDecisionV1` |
| Exact quantity foundation | `lib/training/quantity.ts` | Parse exact decimal input, preserve entered unit/value, convert kg/lb with fixed-point arithmetic, and distinguish per-side/per-hand totals without policy decisions |
| Equipment/load policy | `lib/training/equipment.ts` | Consume exact quantities, derive achievable loads by equipment inventory/load basis, and enforce the automatic proposal cap |
| Compiler | `lib/training/engine/{duration,schedule,compileProgram}.ts` | Validate roster/slot selection, expand the 8-week structure, enforce coverage/rest/time/equipment rules, and return `CompiledProgramV1 | CompilationFailureV1` |
| Strength progression | `lib/training/progression/{types,validation,decision}.ts` | Validate the engine boundary, build comparator/load-epoch keys, select qualifying evidence, apply the ordered PRD decision table, and return auditable proposals/holds/reviews |
| Conditioning | `lib/training/engine/conditioning.ts` | Apply only the two-comparable-bout duration rule and modality comparability |
| Authored content | `content/training/{schema,registry,eight-week-template}.ts`, `content/training/index.ts` | Validate reviewed versioned exercise metadata and the single 8-week template; do not import the corrective `ALL_EXERCISES` registry as strength authority |
| Test fixtures | `lib/training/testing/{fixtures,seededHistories}.ts` | Synthetic catalog, profiles, eligibility/screening states, equipment, logs, and deterministic seeded histories; never exported by production barrels |

The core call signatures are:

```ts
compileProgramV1(input: CompileProgramInputV1): CompilationResultV1
decideStrengthProgression(input: unknown): StrengthProgressionDecisionV1
decideConditioningV1(input: ConditioningDecisionInputV1): ConditioningDecisionV1
```

`CompilationResultV1` is `{ ok: true; program: CompiledProgramV1 } | { ok: false; reasons: CompilationReasonV1[]; alternatives: FeasibleScheduleV1[] }`. Decision results are discriminated by `kind: 'stop' | 'hold' | 'review' | 'recalibrate' | 'rep_proposal' | 'load_proposal'`; each carries `policyVersion`, stable decision/series identity, reason codes, and source revision IDs. Persistence records the full input hash and proposal acceptance in Wave 1C; Wave 1B supplies deterministic keys and freshness inputs.

### Task 1: Freeze boundary contracts and invalid-input behavior

**PRD coverage:** Sections 3, 4 eligibility states, 5 progression state/log domains/numeric contract, and 8; SC-05/06 and the contract portions of PR-04/06/07/08/11/13/14/15.

**Files:** Import the athlete-identity owner's frozen `lib/training/contracts/{profile,eligibility}.ts`; create the remaining `lib/training/contracts/**` files and focused tests without redefining shared eligibility/profile enums.

- [ ] Define strict Zod schemas (`.strict()`) and inferred types for all interfaces in the file map. Use ISO datetime strings, stable string IDs, explicit schema/policy versions, and discriminated unions for strength versus conditioning items.
- [ ] Represent load input as `{ value: string; unit: 'kg' | 'lb'; basis: 'barbell_total' | 'dumbbell_per_hand' | 'external_bodyweight' | 'machine_stack' | 'assistance' }`; reject exponent syntax, negative values, more than three entered decimals, non-finite equivalents, and canonical values above 1000 kg.
- [ ] Encode work-set reps as integers 0-100; completed dynamic sets require 1-100. Encode RIR as integer 0-5, `6_plus`, or `unknown`; conditioning duration as integer 1-14400 seconds, effort as integer 0-10 or `unknown`, and distance as a nonnegative decimal string with an allowed unit.
- [ ] Encode all five eligibility states and preserve clearance provenance as data. Do not implement clearance authority in this task.
- [ ] Encode immutable `programMode: 'self_directed' | 'coach_assigned'`, stable exercise-instance/set IDs, local scheduled date plus athlete timezone, actual timestamps, revision IDs, completion/sync/conflict/symptom states, and screening source/version references.
- [ ] Make reason-code enums exhaustive for every row in the total strength decision table plus equipment/time/schedule insufficiency and conditioning hold/recalibration outcomes. Test that an unknown kind, reason, unit, modality, load basis, or policy version fails closed.

Run:

```bash
mise exec node@22.23.2 -- npm test -- --run lib/training/contracts
mise exec node@22.23.2 -- npm run typecheck
```

Expected: contract tests pass and TypeScript reports no errors; existing source files remain unchanged.

### Task 2: Add the staged training catalog and 8-week template oracle

**PRD coverage:** Section 5 through “Cycle menu,” Section 6 starting dose shape, Section 7 release gate, Section 8 content contract; PR-01 (8-week rows), CO-01, ME-01/02 contract status only.

**Files:** Create `content/training/{schema,registry,eight-week-template,index}.ts`; create `content/training/content.test.ts`; create `lib/training/testing/fixtures.ts`.

- [ ] Define `TrainingExerciseV1` with stable ID/version, movement pattern, primary/accessory role, equipment and load basis, bilateral/unilateral convention, supported ROM/tempo tags, per-exercise load/assistance bounds, substitution group, active/staged state, content review, and exact-variant media/fallback review status.
- [ ] Define `ProgramTemplateV1` with goal, experience tier, allowed cycle lengths `[8]`, weekly schedule kind, session movement slots, compatible exercise IDs, two working sets, rep/RIR bands, rest, warm-up/cool-down/preparation allowance, two conditioning bouts, progression policy version, and feasibility reasons.
- [ ] Encode the PRD goal oracle: `strength` primary 6-10 and accessory 8-15; `general_fitness` primary 8-12 and accessory 8-15; both target 2-3 RIR, two initial working sets, adequate rest, and two conditioning bouts. Keep lower-rep maximal-strength and undulating templates absent.
- [ ] Encode the 8-week phase labels exactly and require stable key lifts across weeks 5-7. Do not interpret review weeks as maximal testing or automatic deloads.
- [ ] Keep `registry.ts` production entries staged until D1-D4 are resolved. Put the complete representative catalog used by compiler tests in `lib/training/testing/fixtures.ts`, marked `synthetic_fixture` and inaccessible through `content/training/index.ts`.
- [ ] Assert every selectable entry has explicit limits, reviewed content, reviewed exact-variant media or reviewed static fallback, and appears in at least one compatible template slot. Assert free-text exercise IDs and corrective-only `content/index.ts` entries cannot fill slots.

Run:

```bash
mise exec node@22.23.2 -- npm exec --no -- vitest run content/training
mise exec node@22.23.2 -- npm run lint:vocab
```

Expected: schema/oracle tests pass; the production registry exposes no unreviewed selectable entry.

### Task 3: Implement the pure 8-week compiler and feasibility oracle

**PRD coverage:** Section 5 `ProgramTemplateV1` and 8-week cycle; PR-01 (8-week × 2/3/4 days × 30/45/60 × supported equipment), PR-16, SC-05/06.

**Files:** Create `lib/training/engine/{duration,schedule,compileProgram}.ts`; create matching `.test.ts` files.

- [ ] Write failing oracle tests for full-body 2/3-day coverage, 4-day upper/lower distribution, nonconsecutive full-body days, an intervening day before repeated upper/lower slots, unavailable equipment, missing slot selection, and absent/normal/unavailable/unvalidated screening producing the same base plan.
- [ ] Implement the duration estimate exactly: dynamic sets use rep ceiling × 4 seconds unless a coached tempo override exists; actual hold/interval seconds; `(sets - 1) × rest` per exercise; 60 seconds between exercises; 5-minute warm-up and 2-minute cool-down; explicit preparation and separate conditioning time.
- [ ] Assert the two PR-16 oracles: 4 exercises × 2 sets × 10 reps, 120-second rest = 1400 seconds and fits 30 minutes; the 3-set/180-second case = 2520 seconds, fails 30, and fits 45.
- [ ] Enforce time fitting in order: remove optional accessory/conditioning from that session and reschedule required conditioning; otherwise offer a compatible reviewed template. Never shrink rest, required movement coverage, warm-up, or preparation. Return `time_budget_insufficient` if none fits.
- [ ] Expand exactly eight weeks without random exercise rotation, catch-up doubling, retroactive edits, or scan-dependent dose. Validate selected days as local dates while storing the IANA timezone separately; cover DST and timezone-travel fixtures without rewriting prior scheduled local dates.
- [ ] Rank compatible reviewed variants by authored preference then stable exercise-version ID. Rank schedule alternatives by most selected days preserved, fewest moved sessions, then lexicographic weekday order. Return structured candidates for explicit acceptance; never silently accept one.

Run:

```bash
mise exec node@22.23.2 -- npm exec --no -- vitest run lib/training/engine/duration.test.ts lib/training/engine/schedule.test.ts lib/training/engine/compileProgram.test.ts
```

Expected: all 8-week feasibility combinations return either a valid nonempty program or a specific insufficiency result, and both exact duration fixtures pass.

### Task 4A: Implement the independently settled exact-quantity foundation

**PRD coverage:** Section 5 numeric contract; PR-02/04/05/06/15.

**Files:** Create `lib/training/quantity.ts` and `lib/training/quantity.test.ts`.

- [ ] Parse nonnegative entered decimals with at most three places, preserve the original string/unit, and produce a canonical kg decimal string using exact integer/fixed-point multiplication by `0.45359237`. Reject signs, exponent notation, empty/nondecimal values, and excess precision.
- [ ] Provide an explicit paired-total derivation so a 0.25 kg per-side value yields 0.50 kg total while the original quantity remains unchanged; the same opt-in operation may report a dumbbell pair total without changing its preserved per-hand entry.
- [ ] Assert 100 lb canonicalizes to exactly 45.359237 kg and table-driven boundary values retain exact results without float drift. Do not implement display rounding or reverse-conversion policy in this foundation.

Run:

```bash
mise exec node@22.23.2 -- npm test -- --run lib/training/quantity.test.ts
```

Expected: exact PR-04 quantity fixtures pass and preserved input objects remain immutable.

### Task 4B: Implement exact equipment inventory arithmetic

**Files:** Create `lib/training/equipment.ts` and `lib/training/equipment.test.ts`.

- [ ] Consume `lib/training/quantity.ts`; do not duplicate decimal parsing or conversion.
- [ ] Model bar weight/collars, symmetric plate-pair counts, fixed per-hand dumbbells, and exact-ID machine stack values, then enumerate and deterministically deduplicate achievable next loads. Reject bodyweight/assistance because their V1 progression policy is outside this arithmetic boundary.
- [ ] Choose the smallest greater achievable value within the 5% automatic proposal cap. Never force a larger jump; 20 kg with only +2.5 kg available holds because 12.5% exceeds the cap.
- [ ] Assert 60 kg with 1.25 kg plates per side yields 62.5 kg (4.166…%, presented as 4.17%).
- [ ] Enforce only the automatic 5% proposal cap here. A generic exact-ratio helper in `quantity.ts` lets progression compute voluntary-actual outliers from preserved entries; 60→70 kg is 16.67% and not a >20% outlier, while 60→75 kg is 25% and is excluded until a separately authorized acknowledgement matches the exact source revisions.

Run:

```bash
mise exec node@22.23.2 -- npm test -- --run lib/training/equipment.test.ts
```

Expected: PR-02/04/05 and the frozen P5 fixtures pass without floating-point arithmetic.

### Task 5: Implement comparator keys and ordered strength decisions

**PRD coverage:** Section 5 “Next-exposure decision policy V1” through numeric examples; PR-02/03/05/06/07/08/09/10/11/13/14/15.

**Files:** Create `lib/training/progression/{types,validation,decision}.ts` and `lib/training/progression/decision.test.ts`.

- [ ] Build a progression-series key from athlete, exercise/content version, equipment, load basis, side/ROM/tempo, prescribed set count, rep range, effort band, and exposure type. Add a load epoch and require the two latest completed, acknowledged, non-conflicted exposures at the same performed load after the last applied change.
- [ ] Exclude warm-ups, unscheduled extra sets, substitutions, changed machines/ROM/basis, unresolved sync, missing required actuals, unknown/`6_plus` RIR, unconfirmed outliers, and symptom-affected evidence. Evaluate completion per exercise series: active/aborted sessions and incomplete instances do not progress, while explicit terminal completion-with-omissions may preserve completed instances and stores omissions. Preserve distinct reason codes.
- [ ] Apply the frozen PRD table in order: global eligibility/acute stop; affected-series symptom hold; stale unfinished session (>24h); active/aborted session hold; incomplete/conflicted/invalid/outlier hold; unknown-effort hold; `6_plus` recalibration; mixed-load review; return review (>=14d since latest comparable completion); comparator calibration; difficult/performance branches; exact equipment increment. The first matching branch wins and increase is never the fallback.
- [ ] Assert two 60 kg 3×8 successes at 2-3 RIR propose 62.5 kg and reset the next target to the low end; a second call with the same ordered log revisions produces the same key/proposal, and an applied decision cannot consume those logs again.
- [ ] Assert 60 kg 8/7/6 in the latest qualifying exposure proposes 8/8/6; 8/8/8 then 8/8/7 proposes 8/8/8 rather than load. Add `mixed_working_load_review` and terminal-omission fixtures. Ceiling reps at 0-1 RIR hold; one below-range exposure holds; two propose review without decrement; missing RIR/set, stale/active/aborted session, conflict, symptom, ≥14-day gap, changed comparator, or only one exposure at a new load cannot earn a load increase.
- [ ] Distinguish ceiling `6_plus` as `effort_too_easy_recalibration` from unknown RIR as `effort_unknown_hold`; neither may propose a load.
- [ ] Self-reported onboarding history can seed familiarization only and cannot qualify as evidence. Calibration never applies a progression proposal or consumes evidence; 5% caps automatic proposals, while confirmed voluntary actuals use the separate >20% outlier branch.
- [ ] Use supplied UTC timestamps: strictly >24h since start is stale, and ≥14 elapsed days since the latest comparable completion triggers return review. Reject future/inconsistent chronology.
- [ ] Add stale-proposal checks for corrected source revisions, eligibility changes, assignment revocation, or program revision changes. A new scan never rewrites completed prescriptions/history.
- [ ] Keep bodyweight and assistance in hold/review paths because V1 has no autonomous percentage policy for them. Keep heavy and volume exposure tracks separate even though undulating plan generation is deferred.

Run:

```bash
mise exec node@22.23.2 -- npm test -- --run lib/training/progression/decision.test.ts
```

Expected: every total-decision-table row has at least one exact input/output fixture; no invalid or ambiguous state produces a load/rep increase.

### Task 6: Implement `ConditioningDecisionV1`

**PRD coverage:** Section 6; CO-01/02/03 and conditioning fields from PR-07.

**Files:** Create `lib/training/engine/conditioning.ts` and `lib/training/engine/conditioning.test.ts`.

- [ ] Key comparable bouts by athlete, modality/content version, prescription kind, target effort, and relevant equipment. Changed modality returns recalibration; rower and running distance never compare.
- [ ] Require both planned bouts completed, acknowledged, non-conflicted, at or below authored target effort, with no adverse symptom. Missing completion or effort holds both bouts.
- [ ] Implement per-bout minutes as `min(2, floor(min(4, 0.10 × priorCompletedWeeklyMinutes) / 2))`, then fit against the authored 30-minute per-bout and 60-minute weekly ceilings. If no whole minute fits, hold. Keep intensity and frequency unchanged.
- [ ] Assert 10→11, 20→22, 29→30, and 30→hold; one incomplete bout holds both. Add unknown effort, adverse symptom, modality change, and external-activity context fixtures; outside activity never completes a planned bout.
- [ ] Allow planned off-day conditioning without treating it as a strength session or violating the nonconsecutive-strength rule.
- [ ] Treat scheduling collisions as a structured reschedule/review outcome and rank alternatives with the frozen D3 ordering. Never invent an exact interference threshold or all-out interval prescription.

Run:

```bash
mise exec node@22.23.2 -- npm exec --no -- vitest run lib/training/engine/conditioning.test.ts
```

Expected: CO-03 exact outputs pass; every missing/comparability/symptom branch holds or recalibrates with a distinct reason.

### Task 7: Add deterministic simulation and compatibility gates

**PRD coverage:** Section 10 simulation suite and scoped Wave 1B portions of SC-05/06, PR-01-16, CO-01-03; legacy boundary from Sections 2/3/8.

**Files:** Create `lib/training/testing/seededHistories.ts`; create `lib/training/simulation.test.ts`.

- [ ] Implement a small deterministic seeded generator that emits at least 1,000 histories across success, plateau, gaps, fatigue/recovery review, unit/load-basis changes, equipment jumps, symptoms, missing/conflicted data, outliers, bodyweight/assistance, and conditioning completion/modality changes.
- [ ] Assert zero hard-constraint violations: deterministic replay; bounded increases; no advancement from incomplete/conflicted/unknown/symptomatic evidence; complete reason codes; no compounding; no set-count mutation; no conditioning intensity/frequency mutation; completed prescriptions unchanged.
- [ ] Keep a fixed holdout seed range that policy tuning tests do not use. Record seed, policy version, input hash, and result for any failure so it is exactly replayable.
- [ ] Run legacy program/workout tests as regression evidence without modifying their implementation. Confirm no import from `lib/training` was added to legacy generation and no import from `lib/program`/`lib/workout` exists in the new compiler.

Run:

```bash
mise exec node@22.23.2 -- npm exec --no -- vitest run lib/training content/training lib/program lib/workout
mise exec node@22.23.2 -- npm exec --no -- eslint lib/training content/training
mise exec node@22.23.2 -- npm run typecheck
git diff --check
```

Expected: at least 1,000 seeded histories pass all invariants; focused new and legacy suites, lint, typecheck, and diff check pass.

## Integration handoff and completion gate

Wave 1B is complete when Tasks 1-7 pass, D1 and D5 are either resolved in frozen contracts or their fail-closed staged behavior remains explicit, and an independent reviewer checks the changed `lib/training/**` and `content/training/**` trust boundary. It is not an athlete-facing release: Wave 1A supplies the approved screening/eligibility adapter, Wave 1C supplies identity/persistence/idempotent acceptance, media review activates catalog entries, and integration owns API/UI/database changes.

The integrating lead then runs the unchanged repository gates on the exact merge candidate:

```bash
mise exec node@22.23.2 -- npm run lint
mise exec node@22.23.2 -- npm run typecheck
mise exec node@22.23.2 -- npm run lint:vocab
mise exec node@22.23.2 -- npm exec --no -- vitest run
mise exec node@22.23.2 -- npm test -w @posture-ai/engine -- --run
mise exec node@22.23.2 -- npm run golden
mise exec node@22.23.2 -- npm run build
```

Expected: every command passes. Browser, authenticated ownership, persistence, clinical wording, physical-device, deployment, and production verification remain gates for their owning waves and cannot be inferred from this pure-engine result.
