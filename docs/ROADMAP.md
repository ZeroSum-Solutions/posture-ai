# posture-ai Roadmap — reliability-axis accuracy phase

Positioning: screening/tracking (Devin, 2026-07-16 — mem0 e4639d8b). Parent plan:
docs/plans/2026-07-17-reliability-baseline.md. Constraints inherited from the
2026-07-16 spike: no clinical-validity claims, never train against the Moti
archive, no landmark-correction layer, scoring default stays lite.

## Phase 1 — Capture-quality preflight (plan §4) — DONE (2026-07-17)
Pixel-quality checks (blur/exposure) as a new helper in lib/capture/, surfaced
in the assessment preflight as override-able warnings — not hard blocks — until
Tier B data justifies cutoffs. Separate from lib/pose/quality.ts (landmark-space).
Shipped via docs/plans/2026-07-17-posture-ai-phase-1.md (PRD v4): scorer +
sampler + browser-lane calibration (scale 320, 0-FP on all committed normals),
both preflight surfaces + a11y, chromium/webkit e2e, CI drift gate. Known
limitations (documented in code): dark-exposure channel 0-FP-inert until Tier B
real captures; upload path shows badge/aria only (warning text is camera-review
only); dark photos also warn blur (contrast-dependent Laplacian).

## Phase 2 — Reliability-profile plumbing (plan §5, fallback form) — UNFINISHED
Versioned per-metric reliability profile (golden/reports/reliability-profile.json)
consumed by report comparison: |Δ| > MDC95 gates improving/attention claims.
The pre-data contract emits separate degree and severity-percentage-point
statistics; the comparison consumer must use the percentage-point MDC95 and
must reject any profile with `consumerEligible: false`. Never compare degree
MDC95 directly with `severity_pct`.
HARD CONSTRAINT: with no committed profile (golden/tierb/ still empty), behavior
must be byte-identical to today's flat SEVERITY_DEADBAND = 5 fallback; the
engine-version not_comparable guard is preserved.

## Phase 3 — Tier B data collection — BLOCKED (human)
Devin runs golden/protocol.md (3–5 volunteers × poses × 3 re-positioned repeats
× 2 devices). Not automatable; out of scope for the phase loop.

## Parked (Devin's call, not phases)
VALIDITY_WEIGHT retirement · pelvic threshold label downgrade · competitor-claim
wording · the five 2026-07-16 USER-DECISION housekeeping items.
