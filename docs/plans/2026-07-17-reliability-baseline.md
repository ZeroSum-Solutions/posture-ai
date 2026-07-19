# Reliability-Axis Accuracy Phase — Baseline Plan

status: active
date: 2026-07-17
positioning: screening/tracking (Devin, 2026-07-16 — mem0 e4639d8b)
consulted: GPT-5.6 Sol (Codex thread 019f6e82, repo-aware audit); plan below is the agreed
synthesis. Verification lane for implementation: independent Claude Opus 4.8 review.

## Context

The clinical-landmark-correction spike (docs/plans/2026-07-16-clinical-landmark-correction-spike.md)
closed NO-GO, and Devin positioned the product as a **screening/tracking tool**: it measures
change over time in its own consistent units. The quality bar is therefore **test-retest
reliability**, not radiographic validity. Hard constraints inherited from the spike:

- Never train any model against the Moti archive; it supports competitor-comparison claims only.
- No clinical-validity language in product copy.
- Keep scoring default `lite`; no correction layer.

The engine today measures only **within-burst detector jitter** (`stabilityScore` /
`uncertaintyDeg`, packages/posture-engine/src/types.ts:47-56 — explicitly "NOT test-retest
repeatability"). The app has **no repeatability number for its own scores**: nobody knows
whether a 5-point score change between two assessments is signal or noise. Everything in this
phase exists to produce and then use that number.

## Steps

### 1. DONE — close out the spike
- PR #127 squash-merged 2026-07-17 (e525a53), branch deleted.
- Moti "truth" relabeled to competitor reference across scripts/moti-import/ (compare.ts,
  compare-core.ts, tests); report JSON carries `reference: 'moti_software_output'` +
  `clinicalValidity: false`. Spike doc status updated to decided.

### 2. Reliability computation module (implement now)
New `packages/posture-engine/src/reliability.ts` + `reliability.test.ts` (TDD):
- Input: per-metric repeated-measures matrix (subjects × repeats of the SAME true posture,
  re-positioned between captures per the Tier B protocol).
- Output: ICC(2,1) generalized to k repeats, SEM (σ√(1−ICC)), MDC95 (SEM × 1.96 × √2),
  per-metric n/mean/spread. Guard: return null below minimum sample (n<3 subjects or k<2).
- Pure functions, no I/O, mirrors compare-core.ts style. Does NOT touch metrics.ts,
  thresholds.ts, quality.ts, quality-score.ts, or lib/capture/.

New `scripts/golden-repeatability.mjs` (or .ts under vite-node, matching moti-import style):
- Consumes `packages/posture-engine/golden/tierb/<subject>/*.landmarks.json` (repeats per
  pose/view/device), runs the real engine per capture, feeds reliability.ts, prints a
  per-metric table (ICC/SEM/MDC95) and writes `golden/reports/reliability-profile.json`
  versioned with the engine version.
- **Data reality: golden/tierb/ is currently EMPTY.** The harness ships with synthetic
  fixture tests so it is proven correct, but real numbers are BLOCKED on step 3.

### 3. BLOCKED ON DEVIN — Tier B data collection
Run the existing protocol (packages/posture-engine/golden/protocol.md): 3–5 volunteers ×
4 poses × front/side × 3 re-positioned repeats × 2 devices, measured staging, consent line,
photos never in git. This is a physical-world task only Devin can do. Until then no universal
"±X°" claim is published — a 3–5 subject pilot yields a pilot-labeled profile with explicit
uncertainty, per Codex's caveat (agreed).

### 4. Capture control (after 2, parallel with 3)
Pixel-quality preflight (blur/exposure) as a NEW helper in lib/capture/, wired into the
assessment preflight as override-able warnings — not hard blocks — until step-3 data
justifies cutoffs. Kept separate from lib/pose/quality.ts (landmark-space) by design.

### 5. Honest uncertainty in reports (after 3 produces a profile)
Replace the flat `SEVERITY_DEADBAND = 5` in lib/reports/clientComparison.ts:35 with
per-metric severity-percentage-point MDC deltas from an eligible, versioned reliability
profile; preserve the existing engine-version `not_comparable` guard. Only claim
improving/attention when |Δ severity_pct| exceeds the profile's percentage-point MDC95.
The degree MDC95 remains for measurement reporting and must never be compared directly
with `severity_pct`. An absent, ineligible, stale, or incomplete profile retains the flat
5-point fallback byte-for-byte.

## Flagged decisions for Devin (score-affecting — NOT in this phase's diffs)
1. **VALIDITY_WEIGHT** (engine.ts:113, thresholds.ts:159): literature-cited metrics get 2×
   the scoring weight of screening proxies — a validity hierarchy arguably inconsistent with
   reliability-only positioning. Retiring it changes every overallScore + golden locks.
2. **Pelvic threshold label**: 3°/6° stays (frozen engineering default), but its `lit()`
   label cites iliac-crest/ASIS literature while metrics.ts measures MediaPipe hip centers.
   Downgrading the label to `eng()` is honest but interacts with (1) via scoring weight.
3. **Competitor-claim wording**: "approximates a €30k scanner" needs narrow wording (model,
   metric, n, pairing method, comparison-only) given documented pairing limitations.

## Non-goals
Landmark correction (closed NO-GO) · training against the Moti archive (forbidden) ·
lite→full default switch (re-confirmed NO) · FHP construct rework as a validity claim (the
ear-shoulder proxy stays, honestly labeled; re-examine only with reliability data).
