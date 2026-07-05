# Pipeline Accuracy v2 — Design

**Date:** 2026-07-05 · **Status:** approved design, pre-implementation
**Decides for:** capture → landmarks → distortion scoring → muscle mapping → exercise selection
**Supersedes nothing** — companions: `2026-06-27-wave3-layer1-validation-protocol.md` (clinical study, still gated), `docs/qa/AUDIT.md` (evidence for the defects fixed here), `docs/qa/passes/PASS-01.md` (parallel QA track).

## Goal

The product promise is *point → shoot → follow along* — a posture scan that
feels like magic and hands any given person the stretches, strengthening,
mobility, and soft-tissue work most likely to help them. Magic that is wrong
is a trick. This design makes each pipeline stage measurably accurate and
honest about its uncertainty, because each stage's error feeds the next:
capture error becomes metric error becomes wrong muscles becomes wrong
exercises.

## Decisions locked in (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Ground truth this cycle | Literature + expert sources, plus Devin + a few volunteers on real phones | Devin's answer 2026-07-04; no clinician cohort available yet |
| Score continuity | **Correctness wins.** Engine bumps to 2.0.0; same photos may grade differently; stored assessments keep their as-scored v1.3 results | Pre-revenue, few users; tuning to match a known-biased baseline is bad science |
| Clinical study (n=50) | Stays **gated** on clinician + biostatistician sign-off per wave3 protocol §11 | Protocol's own hard gate; out of reach for this cycle's ground truth |
| Approach | B — fix proved defects now, build measurement harness alongside | Audit already proved the defects with file:line evidence; measuring them first adds delay, not knowledge |
| Screening vocabulary | Unchanged hard constraint on every new string (no diagnos*/treat*/cure*/patient*/prescri*) | Regulatory posture (Exer FDA letter) |
| STATE muscle recoding, true CVA/FSA metrics | Deferred to the clinical cycle | Need validation data this cycle cannot produce |

## Evidence baseline (what is wrong today, as coded)

From `docs/qa/AUDIT.md` and the pipeline exploration (engine 1.3.0, main @ `fbf392d`):

1. `t1_tilt_backward` and `anterior_pelvic_shift` compute the **byte-identical**
   `angleFromVertical(shoulder→hip)` vector (`packages/posture-engine/src/metrics.ts:107-109`
   vs `:149-151`) and are scored as two findings with different thresholds
   (3/8° vs 4/12°). The overall grade double-counts one physical trunk lean.
2. Only 1 of 9 scored metrics (`knee_extension_back_knee`, Loudon 1998 / Kawahara 2012)
   has literature-cited thresholds; the other 8 are `source:'engineering'`
   defaults (`thresholds.ts:57-71`). `PROXY_NOTE` (`:27-30`) admits the metrics
   measure lean/tilt proxies, not the named clinical constructs (CVA/FSA/kyphosis/APT).
3. The overall score is an unweighted mean of severityPct across reliable
   findings (`engine.ts:89-92`) — one cited metric averaged raw with eight
   proxies plus the double-counted vector — bucketed through arbitrary grade
   bands, plus a "Top X%" percentile (`thresholds.ts:110-112`) with no
   normative basis.
4. 88 muscle-imbalance links; 27 carry an evidence grade (8 high / 14 medium /
   5 low), 61 ungraded, and **nothing consumes the grade**
   (`content/muscles/types.ts:76` — "nothing consumes it yet").
5. Exercise selection (authored `primaryDeviationKeys`, `lib/program/buildProgram.ts:91-98`)
   and the muscle-link system are never cross-checked; dosage is severity-blind
   by design (`lib/program/dosage.ts:18`); no red-flag/safety screen exists.
6. Capture: 5-frame burst (~280 ms) medianed per landmark; `stabilityScore`
   measures detector jitter, not repositioning repeatability. `lite` model is
   default with no measured accuracy delta vs `full` (`lib/pose/detect.ts:26-30`).
   Visibility floor 0.5 is MediaPipe self-report, never checked against real error.

## §1 The spine — golden dataset + accuracy regression harness

New: `packages/posture-engine/golden/`.

**Tier A — synthetic, analytic ground truth.** A parametric landmark generator:
given a posture spec (`{trunkLeanDeg: 10, pelvicObliquityDeg: 3, …}`), emit
front/side landmark frames whose expected metric values are true by
construction. On it, property tests the engine has never had:

- Scale + translation invariance: uniform scaling / offset of all landmarks
  changes no scored angle (subject distance must not matter).
- Mirror invariance: `x → 1−x` flips left/right findings symmetrically.
- Roll round-trip: synthetic roll ε applied, `captureRollDeg = ε` passed →
  metrics match the unrolled case within tolerance.
- Noise sensitivity: Gaussian jitter σ=0.005 (normalized units) on landmarks →
  per-metric output σ is computed and asserted bounded; the resulting table
  documents which metrics are fragile and feeds §3.4's uncertainty display.
- Pitch sensitivity: simulated camera pitch sweep (0–20°) → per-metric error
  curve; feeds the §2 pitch-gate decision.

**Tier B — real phone photos, measured ground truth.**
`golden/protocol.md` — a written capture protocol for Devin + volunteers:
wall + plumb line + phone inclinometer app; deliberately staged postures at
measured angles (neutral, staged trunk lean ~5°/~10°, staged shoulder drop,
staged lateral pelvic tilt); front + side; 3 repeats with full lower-phone,
re-frame, re-capture between repeats; on both iPhone Safari and Android
Chrome. Target 3–5 subjects. Enough to expose systematic bias and measure
repeatability; NOT claimed to establish clinical norms.

**Privacy rule (hard):** volunteer photos never enter git. Committed artifacts
are extracted landmark JSON + measured ground-truth angles + device metadata
only; photos live in a gitignored `golden/photos-local/`. Volunteers give a
simple written OK recorded in the protocol doc. Landmarks are non-biometric
by the app's own BIPA posture (pose-only model, no face mesh) — the same
fail-closed rule applies here (`lib/pose/detect.ts:41-45`).

**Runner:** `npm run golden` scores every Tier A + Tier B fixture with the
current engine and reports per-metric mean absolute error + max error + drift
vs `golden/baseline.json` (the last accepted result). CI runs it; drift beyond
per-metric tolerance fails the build unless the baseline is explicitly
re-accepted in the same PR (reviewed like a snapshot update). Accuracy becomes
a number in CI, permanently.

## §2 Stage 1 — capture accuracy (measure, then tune; no guessed changes)

1. **Lite vs full, decided by data.** Run both `.task` models over Tier B
   photos (+ the 3 e2e photos). Report per-landmark position delta and
   downstream per-metric delta. Decision rule: if full shifts any scored
   metric by >1° median across Tier B, `full` becomes the default
   (`NEXT_PUBLIC_POSE_MODEL` flip — both models already ship self-hosted;
   9 MB vs 5.5 MB, downloaded once and cached). Record the decision + numbers
   in this doc's changelog.
2. **Pitch gate from the Tier A pitch sweep.** If simulated 10° pitch corrupts
   any pelvic/shoulder metric by >2°, the current soft warning at 15°
   (`FullScreenCapture.tsx:567`) becomes a hard gate at a data-derived angle
   (same UX pattern as the roll gate). If not, leave it — no UX friction
   without evidence.
3. **Visibility floor checked.** From Tier B, correlate MediaPipe per-landmark
   `visibility` against actual landmark error (known staged geometry). Keep
   `RELIABILITY_FLOOR = 0.5` if it separates good from bad landmarks; move it
   if the data says otherwise. Also record whether an explicit
   `minPoseDetectionConfidence` (currently unset, `detect.ts:55-68`) helps.
4. **Repeatability measured, not shipped.** Tier B's 3 repeats give an honest
   between-recapture spread per metric ("±X° when you re-shoot"). That number
   feeds the Accuracy card copy (§3.4). The product keeps its single-burst
   flow — point-shoot stays frictionless; rigor lives in the harness.

Product-flow changes in this stage are limited to: possible model default
flip, possible pitch hard gate, possible floor adjustment — each only if its
measurement says so.

## §3 Stage 2 — engine v2.0 (the correctness release)

1. **Merge the double-count.** `t1_tilt_backward` + `anterior_pelvic_shift`
   become one finding: key `trunk_lean`, display name "Trunk Lean". One
   threshold set (start from the tighter 3/8°, subject to the §3.3 literature
   sweep). Muscle links: union of both old keys' links, deduped by
   (muscle, role), keeping the higher evidence grade on collision.
   Forward-only migration renames the `imbalance_definitions` key and remaps
   `muscle_imbalance_links`; content files updated to match. Engine emits one
   finding where it emitted two; UI copy explains trunk lean once, honestly.
   Stored v1.3 assessments are untouched (they render from stored findings).
2. **Validity-weighted overall score.** Per-finding weight =
   `validityWeight × landmarkConfidence` where landmarkConfidence is the
   finding's existing 0–1 visibility-derived confidence (distinct from the
   §4 muscle-link *evidence* grades) and validityWeight is 1.0 for
   `LITERATURE_CITED` and 0.5 for `SCREENING_ONLY` (`metricValidity`,
   `thresholds.ts:126-133`, becomes load-bearing). Overall score = weighted
   mean of severityPct over reliable findings. Grade bands S–E recalibrated
   once against the Tier A + QA-seed score distribution so the letters keep
   discriminating; band cutpoints documented with their derivation. The
   **"Top X%" percentile is removed** (`toPercentile`, `thresholds.ts:110-112`)
   — it has no normative basis and honesty beats decoration.
3. **Literature threshold sweep.** For each scored metric, the
   research-literature agent (PubMed + Consensus) searches for citable
   photogrammetric/posture-screening norms (sagittal trunk inclination,
   shoulder-line obliquity, photographic pelvic obliquity, ear-shoulder
   sagittal offset norms, frontal-plane knee alignment photogrammetry).
   Found → threshold replaced, `source: 'literature'` + full citation in
   `thresholds.ts`. Not found → stays `'engineering'`, and the per-metric
   validity label in the UI says "screening estimate" vs
   "literature-referenced". Every threshold ends this cycle labeled and
   traceable, even where the label is honest ignorance.
4. **Uncertainty-aware zones.** A finding whose |deviation − nearest zone
   boundary| < its burst `uncertaintyDeg` is flagged `borderline: true`.
   Display: zone shown with a borderline marker and the ± figure (plus the §2.4
   recapture spread in the Accuracy card copy). Program logic keeps using the
   deterministic point-estimate zone — selection stays reproducible; only the
   *claim* softens. Metric display names and the Accuracy card adopt the
   honest proxy framing already admitted in `PROXY_NOTE`.
5. `pelvic_axial_rotation` stays measure-but-never-scored (unchanged).
   `ENGINE_VERSION = '2.0.0'`; golden baseline re-accepted at that version.

## §4 Stage 3 — the muscle map earns its confidence

1. **Grade all 88 links.** Research-literature pass over the 61 ungraded
   links (and spot-check of the existing 27) against a fixed rubric:
   **high** = consistent EMG/RCT/systematic-review support for the
   muscle-imbalance association; **medium** = plausible mechanism + partial
   or indirect evidence; **low** = textbook inference (Kendall/Janda
   reasoning) without corroborating studies. Each grade written to the
   content file (`confidence` field) with a one-line rationale naming its
   citation; mirrored to the existing DB `link_evidence` column
   (`20260628010000` migration) via reseed. Every grade reviewable:
   link → rationale → citation.
2. **Consume the grades** (closes `types.ts:76`):
   - Body-map highlight intensity = severityPct × confidence weight
     (high 1.0 / medium 0.7 / low 0.4; ungraded impossible after 4.1).
   - **Low-confidence muscles render as "possible involvement"** — visually
     distinct treatment + its own legend entry. The map asserts what evidence
     supports and only suggests what it whispers.
   - `findingsToMuscleStates` carries `confidence` through to all consumers
     (map, detail sheets, program ranking §5.2).
3. Binary tight/weak coding stays this cycle; the STATE remodel remains
   deferred to the clinical cycle (roadmap "Deferred" list).

## §5 Stage 4 — exercises that provably target what the finding implicates

1. **Coherence gate (CI test, not runtime).** For every exercise ×
   `primaryDeviationKey` pair across all 73 exercises: a `stretch`-category
   exercise must target (via `exercise_muscles` role `stretch`) ≥1 muscle the
   imbalance marks `tight` in its scored link set; `strengthen`/`activation`
   → ≥1 `weak` muscle; `mobility` → ≥1 muscle in either set. Failing pairs
   are authoring bugs — fixed in content as part of this work, then locked
   forever. This machine-verifies the prescription chain
   finding → muscle → exercise end to end and is the direct answer to "do
   the given exercises actually help this finding."
2. **Evidence-aware ranking.** Within a category, candidates whose target
   muscles carry high/medium-confidence links for the active finding rank
   above candidates riding low-confidence links (tie-break inserted into the
   existing deterministic order in `selectPriorities.ts` / `buildProgram.ts`;
   zone gate, category caps, capability dial all unchanged).
3. **Dosage stays evidence-bound, deliberately severity-blind.** Literature
   supports the 30 s stretch floor and 2–3 set ranges already encoded; it
   does not support "worse angle → more sets". Severity keeps doing what it
   validly does — ordering priorities. (Documented so nobody "fixes" it.)
4. **Red-flag screen.** One screening-safe question before a session starts
   (sharp pain during movement → stop and check with a professional; decline
   path ends the session politely). Recorded on the session run. Vocabulary
   lint applies.
5. **"Why this" transparency.** Each program exercise gets a one-tap
   rationale: finding → implicated muscle(s) with evidence grade → what the
   exercise does for it. Trust-building and the magic-UX ingredient: magic
   users can interrogate reads as intelligence, magic they can't reads as a
   trick.

## §6 Testing, acceptance, sequencing

Everything lands TDD under existing gates (vitest, e2e, vocabulary lint) plus
the new golden runner. Acceptance per stage:

| Stage | Done when |
|---|---|
| §1 Harness | `npm run golden` wired into CI; Tier A property tests green; `golden/protocol.md` written; ≥1 subject captured end-to-end through Tier B |
| §2 Capture | lite-vs-full decision recorded with numbers; pitch and visibility verdicts recorded with numbers; only data-justified flow changes shipped |
| §3 Engine v2 | trunk_lean merge migrated + content updated; weighted score + recalibrated bands; percentile removed; every threshold labeled `literature` or `engineering` with citation where cited; `ENGINE_VERSION 2.0.0`; golden baseline accepted |
| §4 Muscles | 88/88 links graded with rationale + citation; map + states consume confidence; "possible involvement" treatment shipped |
| §5 Exercises | coherence gate green over all pairs (content fixed); evidence-aware ranking; red-flag screen; rationale UI |

**Sequencing:** §1 first (it referees everything) → §3 (biggest defect) →
§4 → §5 (each consumes the previous stage's output). §2's measurements run
whenever volunteer time exists — Tier A parts immediately, Tier B when photos
arrive; the §2 decisions land as their data arrives.

**Parallel track, not this spec:** the PASS-01 handoff clusters
(consent-token hashing S2 first, unbounded queries, WorkoutPlayer lint/wake-lock,
assessment-page split, QA-002/003) proceed independently as ranked.

**Environment notes for implementers** (from PASS-01, keep sacred):
run e2e with **:3100 free** (Playwright reuses an existing server on that port
and the prod bundle 403s `create-test-user`, breaking auth.setup); local
Supabase + `npm run qa:seed` gives the seeded QA dataset; muscle `reviewed_at`
is currently null everywhere so QA-002 stays reproducible.

## Out of scope (explicit)

n=50 clinical study (gated on clinician + biostatistician sign-off, wave3
protocol §11); true CVA/FSA/kyphosis metrics; binary→STATE muscle recoding;
native app; billing; any UI redesign beyond the accuracy-facing elements
named here (borderline markers, possible-involvement legend, rationale sheet,
red-flag screen). The "next-generation UI" ambition is a separate design
cycle.

## Risks

- **Literature sweep finds little.** Likely for some metrics — that is a
  *result*, not a failure: the threshold stays engineering-labeled and the UI
  says so. No metric may silently keep an unlabeled magic number.
- **Volunteer photos delayed.** §2/Tier B is the only externally-dependent
  piece; everything else proceeds. Tier A alone already catches invariance
  and sensitivity regressions.
- **Grade-band recalibration is judgment.** Bands are screening buckets, not
  clinical claims; derivation is documented and revisited after the clinical
  cycle.
- **trunk_lean merge touches content + DB + engine + UI.** Mitigated by the
  golden harness landing first and the forward-only migration pattern already
  proven in this repo.

## Changelog

### 2026-07-04 — §2.2 Pitch-gate verdict: NO GATE (documented no-action)

**Task:** SDD Task 12 — apply the spec §2.2 decision rule to the Task 2
pitch-sensitivity sweep.

**Decision rule (spec §2.2):** if simulated 10° pitch corrupts ANY scored
metric by >2°, the soft 15° tilt warning becomes a hard gate at a
data-derived angle (largest pitch whose worst-metric error ≤2°, rounded down).
Otherwise: documented no-action.

**Data source:** `packages/posture-engine/golden/reports/pitch-sensitivity.json`
(`cameraDistanceM: 3`, generated by Task 2).

**Full pitch-sensitivity table (worst metric = `forward_head_posture` at every row):**

| pitchDeg | forward_head_posture error (°) |
|---|---|
| 0  | 0.702 ¹ |
| 5  | 1.172 |
| 10 | 1.532 |
| 15 | 1.796 |
| 20 | 1.974 |

¹ The 0° baseline already carries a ~0.702° perspective artifact: the sweep
uses `distanceM=3` (finite camera distance) while the engine's orthographic
baseline uses `distanceM=Infinity`. This artifact is NOT caused by pitch; it
is a fixed offset across the entire curve. The true pitch-induced component at
10° is the 0°→10° delta = 1.532° − 0.702° = **0.830°**.

**Verdict: NO GATE.**

Both the absolute error at 10° (**1.532°**) and the true pitch-induced delta
(**0.830°** = 1.532° − 0.702° baseline) are below the spec §2.2 trigger of
2°. The rule does not fire. No change to `FullScreenCapture.tsx`.

**Ceiling note:** The 20° data point (1.974°) is only 0.026° below the 2°
trigger — the tolerance ceiling is being approached. Extrapolating beyond the
tested range, the worst-metric error would cross 2° just above ~20°
(∼0.026° of headroom remaining at the last tested point). The existing soft
15° tilt warning (`FullScreenCapture.tsx:567`) remains the sensible safeguard:
at 15° the worst-metric error is already 1.796°, well into the zone where
alerting the user is appropriate even without a hard gate.

**No code changes.** The soft 15° warning stands unchanged.
