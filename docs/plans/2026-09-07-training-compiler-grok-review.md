# Eight-week compiler checkpoint review — 2026-09-07

External reviewer: Grok 4.6 through SuperGrok OAuth. Document-only review of the frozen source packet; the reviewer did not execute repository commands. Root verified the seven owned source hashes and three dependency hashes, ran 249 training tests, typecheck, and scoped ESLint successfully.

Accepted scope: deterministic eight-week draft compilation using synthetic catalog fixtures. Publication, acceptance persistence, authored media, actual catalog activation, other cycle lengths, and phase-specific progression remain incomplete.

Before persistence/API integration: validate public weekday input, bound generated IDs, lock equipment selection paths, and define non-Monday cycle anchors and unsupported-cycle results. Broaden full-cycle assertions as those paths are integrated. The review below records remaining scheduling refinements.

## Frozen owned source hashes

- `lib/training/catalog/types.ts`: `5dce3acfdfc24babd7a627718f4729018279bec2061f27e3d5de6c615e55d07e`
- `lib/training/engine/duration.ts`: `2f80a8fce7ffb28d5a3a21c0f4163e182fe28a97dd85d899ef6120d888a41421`
- `lib/training/engine/duration.test.ts`: `e3b86d230ae854928817c3470531c0054f4d42ada57f3694384d2fd8db67fb4f`
- `lib/training/engine/schedule.ts`: `25550697f24388108c02587ea1ebf1124af41564bf420a7ac4267bafb9ea4f36`
- `lib/training/engine/schedule.test.ts`: `e79ce20ae8543487f1bf062efb5925def102caaf569e56c389cd8fb95155789c`
- `lib/training/engine/compileProgram.ts`: `c6ece0dacf8978fcb200fb409bd675e6312b523a0ade1da18bf1d6f8400b663e`
- `lib/training/engine/compileProgram.test.ts`: `f4aba191878a68ff69c0059186d8c8bd88041c07dd3248463b8393c5dc5c5094`

## External review

# Eight-week template compiler (first slice) — Grok 4.6 document-only review

**Verdict: ACCEPT** this frozen draft-compiler slice.

No in-scope correctness **BLOCK**. The owned sources plus the three frozen dependencies implement the claimed 8-week 2/3/4-day draft expansion, the PR-16 duration oracle, explicit schedule and time-insufficiency results, stable identities, explicit load/conditioning acceptance, civil-date scheduling, and fail-closed machine-stack selection. Proof in the packet is 28/28 focused tests, empty typecheck, empty ESLint. Production catalog, other cycle lengths, media, publication, eligibility, and UI stay later work and are not treated as missing here.

This review did not re-hash files or re-run commands. Findings use only the embedded sources.

---

## BLOCK

None.

---

## WARN

### WARN-1 — Public `expandLocalDates` does not runtime-check `weekday`

- **File/line:** `lib/training/engine/schedule.ts:115-125` with `dayIndex` at `28-30`
- **Trigger:** `expandLocalDates('2026-03-02', 'not-a-day', 8)` (or any string that is not in `WEEKDAYS`). `weekCount` and the civil date throw; `weekday` does not. `WEEKDAYS.indexOf` returns `-1`, then `firstOffset = (-1 - mondayBasedStart + 7) % 7` still yields a date list.
- **Fix:** Parse `weekday` with `z.enum(WEEKDAYS)` next to the existing date/`weekCount` checks. Keep the compile path as-is; it only passes `Weekday`.
- **Why not BLOCK:** `compileEightWeekProgram` only passes schedule-derived weekdays. This is a public-helper footgun, not a draft-program bug.

### WARN-2 — Compiled IDs can exceed the 128-character input identity bound

- **File/line:** `lib/training/engine/compileProgram.ts:261` (`exerciseInstanceId`), `268` (`setIds`), `338` (`sessionId`), `355` (`boutId`)
- **Trigger:** `programRevisionId` and `exerciseVersionId` at the schema max of 128. Instance IDs become `{programRevisionId}:w{n}:s{k}:{exerciseVersionId}` (about 263 characters). Session and bout IDs can also exceed 128.
- **Fix:** Either bound those compiled strings in this slice, or make the persistence/API identity schema longer than the input `stableIdSchema`. Do not reuse the 128-character input schema for compiled IDs.
- **Why not BLOCK:** This slice does not persist. IDs are deterministic and unique for the tested revision lengths.

### WARN-3 — Barbell fail-closed and dumbbell explicit-list matching are untested

- **File/line:** `lib/training/engine/compileProgram.ts:168-181`
- **Trigger (barbell):** Reviewed barbell-compatible catalog + barbell inventory → `inventoryHasExplicitLoadInBounds` returns `false` at line 175, then `needs_template_adjustment`. That matches the stated partial scope, but no test locks it.
- **Trigger (dumbbell):** The compiler *will* select a dumbbell-compatible reviewed exercise when `perHandLoads` has an in-range value (lines 176-181). The packet says the provisional dumbbell roster is not wired; the selection path is still live and untested.
- **Fix:** One barbell fail-closed fixture. One dumbbell in-range select and one out-of-range reject. Keep barbell closed until a bounded achievable-load enumerator is exported; `findNextEquipmentLoad` in `lib/training/equipment.ts:214-238` is a 5% next-step search, not that enumerator.
- **Why not BLOCK:** Machine-stack empty and out-of-bounds paths are tested. Barbell-closed is the documented partial. No production dumbbell roster is in this catalog.

### WARN-4 — Week index is per-weekday first occurrence; tests only use a Monday start

- **File/line:** `lib/training/engine/schedule.ts:115-125`; `lib/training/engine/compileProgram.ts:239-241`; tests use `cycleStartLocalDate: '2026-03-02'`
- **Trigger:** Start `2026-03-04` (Wednesday) with strength days Monday and Thursday. Week 1 Thursday is `2026-03-05`; week 1 Monday is `2026-03-09`. Sessions that share `week: 1` / `phase: 'calibration'` are not the same ISO week, and Thursday occurs before Monday inside that index. Dates still never fall before the start, and UTC civil arithmetic stays DST-stable.
- **Fix:** Add a non-Monday start fixture and freeze the expected dates. If product intent is calendar weeks from the start date, change `expandLocalDates` / `scheduledDate`; if first-occurrence is intent, document it on the compiler policy version.
- **Why not BLOCK:** The PRD requires local date + timezone metadata and DST stability, not a Monday epoch. The Mar 2 → Sunday DST fixture in `schedule.test.ts:45-52` is correct UTC civil arithmetic.

### WARN-5 — Consecutive requests never produce a fewer-session alternative

- **File/line:** `lib/training/engine/schedule.ts:76-90`; compile wrapper `compileProgram.ts:292-299`
- **Trigger:** `['monday', 'tuesday', 'wednesday']` returns same-length valid 3-day alternatives (for example Monday/Wednesday/Friday with `preservedRequestedDays: 2`). It does not offer a 2-day plan. Time overflow offers a longer 45/60 budget (`compileProgram.ts:320-331`), not fewer strength days.
- **Fix:** If the product wants the PRD’s “fewer sessions or alternative days” on this slice, add a ranked reduced-count alternative with the same explicit-acceptance result kind. If that stays UI/profile work, leave the compiler as-is and state it.
- **Why not BLOCK:** The compiler does not silently move or drop days. Same-length ranked alternatives match the “preserve requested days, then moved sessions, then weekday order” rule. Tested for Monday+Tuesday.

### WARN-6 — Legal 4/6/12 profiles throw instead of returning a result

- **File/line:** `lib/training/engine/compileProgram.ts:287`; profile contract `lib/training/contracts/profile.ts:198`
- **Trigger:** `cycleLengthWeeks: 6` (valid on the profile, supported later) throws `Only the eight-week compiler is supported`. Impossible civil dates after the `YYYY-MM-DD` regex (for example `2026-02-30`) throw `Invalid local date` from `expandLocalDates` (`compileProgram.ts:289-290`), not `Invalid compiler input`.
- **Fix:** Return a discriminated unsupported-cycle / invalid-anchor result, same style as `schedule_adjustment_required` and `time_budget_insufficient`. Keep fail-closed.
- **Why not BLOCK:** This slice claims 8 weeks only. Callers already must catch throws for malformed catalogs.

### WARN-7 — Several required behaviors are only covered at the helper layer or on week 0

- **File/line:** `lib/training/engine/compileProgram.test.ts:70-87` (matrix only asserts `kind === 'draft_program'`), `89-121` (coverage and conditioning on week 0), `134` (128 set IDs only for 2-day); `schedule.test.ts` has Sunday+Monday and DST, not through `compileEightWeekProgram`
- **Trigger:** A later edit could keep the 18-call matrix green while 3-day/4-day identities collide, week 8 dates drift, or Sunday wrap-around is dropped from the compile wrapper.
- **Fix:** Assert `estimatedDurationSeconds <= budget * 60` in the matrix; unique set/session/bout IDs for 3-day and 4-day; all eight weeks’ dates and weekly set counts; one compile-level Sunday+Monday adjustment; one staged/`unreviewed`/wrong-media reject.
- **Why not BLOCK:** Structure reuses one selection map and one `schedule.days` for every week. Helper tests plus the 2-day identity/replay tests still support the claims.

### WARN-8 — Off-day conditioning is first-two unused weekdays, not spread

- **File/line:** `lib/training/engine/compileProgram.ts:243-246`
- **Trigger:** Monday/Thursday strength → conditioning Tuesday and Wednesday (adjacent to Monday strength and to each other). Bouts are off-day, 600s, `requires_explicit_acceptance`, and never land on a strength weekday.
- **Fix:** If “prefer separation when practical” is in this slice, rank unused days by gap from strength/lower-body days. If it is later scheduling polish, leave it.
- **Why not BLOCK:** The PRD allows off-day conditioning and does not forbid adjacent easy/moderate walks. Same-day strength+conditioning collision is avoided.

---

## What this slice does prove

**Duration / PR-16.** `duration.ts:26-42` is `sets * repCeiling * (secondsPerRep ?? 4) + (sets-1) * rest + (n-1)*60 + warmup + cooldown + preparation`. Tests lock 1400s fits 30 and 2520s does not, and 2520s fits 45. The compiler calls that helper with the V1 two-set / 120s-rest template (`compileProgram.ts:219-237`), so a zero-prep four-pattern session is 1400s (strength 6-10) or 1464s (general fitness 8-12). Both fit 30. Extra authored preparation of 160s/exercise yields 2040s and `time_budget_insufficient` with `feasibleBudgetMinutes: 45`. Rest, required patterns, and preparation are not shrunk.

**2/3/4-day schedule and weekly coverage.** Full-body 2/3-day requires cyclic gaps `> 1`, including Sunday-Monday (`schedule.ts:36-40, 49-57`). Four-day assigns sorted days as upper/lower/upper/lower and applies the same gap rule per slot type, so Mon/Tue/Thu/Fri is accepted as upper/lower/upper/lower. Consecutive requested days return `schedule_adjustment_required` with alternatives ranked by preserved days, then moved sessions, then weekday order; Monday+Tuesday’s top alternative is Monday+Wednesday. Draft weeks: 2-day → 4 exercises/session and 4 sets/pattern/week; 3-day → 4 and 6; 4-day → 2 and 4. That is the PRD weekly minimum (each required slot in at least two sessions, two working sets each). Conditioning is two bouts on unused weekdays every week.

**Identities and replay.** Same input compiles equal output. Instance/set IDs include `programRevisionId`, week, session ordinal, and `exerciseVersionId`. The 2-day path has 128 distinct set IDs (8×2×4×2). Weeks 5-7 keep the same `exerciseVersionId`s because selection runs once. Output is deep-frozen.

**Explicit acceptance.** Draft `status`, every `loadSelection.status`, and every conditioning bout are `requires_explicit_acceptance`. Recalled `60` kg history sets `familiarizationHistoryAvailable: true` and does not enter the prescription JSON. No starting load is invented. Conditioning offer is 600s with allowed 60-1200s.

**Local dates / timezone / DST.** Scheduling uses `Date.UTC` plus `setUTCDate` and emits `YYYY-MM-DD` only (`schedule.ts:101-125`). Athlete timezone is copied onto sessions and bouts and is not used to convert instants. Changing `America/Los_Angeles` to `America/New_York` keeps dates. `2026-02-30` is rejected. Sunday list from Monday `2026-03-02` is `2026-03-08/15/22` (US spring DST week included, civil date unmoved).

**Equipment.** Synthetic fixtures must be `active` + `reviewed_fixture` + `reviewed_static_fixture`. Production path requires `reviewed` + `reviewed_exact_variant`. Selection is preference rank, then `exerciseVersionId`, then `equipmentId`. Kind and load basis must match. Machine stacks must contain an exact in-range load. Empty or below-minimum stacks return `needs_template_adjustment`. Missing hinge or missing conditioning modality fail closed. Unreviewed rank-0 variants are skipped. Barbell is unconditionally refused until a real enumerator exists.

**Malformed input.** Strict compile schema rejects extra keys and forged catalogs. Catalog min>max fails parse. Duplicate strength days fail the profile schema. Duration rejects an empty exercise list. Schedule rejects duplicates at runtime. Unsupported 6-week cycles throw.

**Dependencies used as specified.** Profile is read-only input. Quantity bounds use exact decimal comparison, not binary floats. Equipment’s next-load search is not used to mint loads.

---

## Out of scope (not defects)

Synthetic machine-stack fixtures only; no production catalog. No 4/6/12-week compile. No accessories/trunk/carry, no rest lengthening on a 60-minute budget, no phase-specific dose (labels only: calibration / build / review_adjust / review). No publication, acceptance persistence, eligibility, UI, or media rights. No clinical or content-review demand on these labeled fixtures.

---

**Scoped decision:** Accept the first eight-week draft compiler slice. Treat WARN-1, WARN-2, and WARN-3 as the follow-ups that should land before this compiler is called from persistence or a broader catalog. Do not block this slice on production catalog, other cycle lengths, or clinical/media approval.
