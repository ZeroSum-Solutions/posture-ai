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

## Phase 2 — Reliability protocol/tooling — PREPARED; product consumption pending
Tier B v2 freezes the study design, schemas, trust boundary, reference
statistics, participant-cluster bootstrap, and a preparation-only packet.
Agreement SEM and MDC95 are primary; ICC(A,1) is secondary because neutral
standing can have restricted between-person range. Collection and consumer use
both remain fail-closed.

PR-11 may consume a versioned per-metric reliability profile only after HG-05
produces an adjudicated, `consumerEligible:true` profile that exactly matches
the engine/configuration and units. Until then behavior remains byte-identical
to the flat `SEVERITY_DEADBAND = 5` fallback.

## Phase 3 — Tier B data collection — LOCKED pending HG-05 authorization
After a valid collection-authorization packet and governed consent exist, the
same 12 participants minimum (15 target) complete neutral standing on exactly
2 devices × 3 full re-stances × 4 slots. The minimum is 288 unique photos;
target is 360. Photos and the restricted identity/consent envelope remain
outside the repository. Physical collection and adjudication are human gates.

## Parked (Devin's call, not phases)
VALIDITY_WEIGHT retirement · pelvic threshold label downgrade · competitor-claim
wording · the five 2026-07-16 USER-DECISION housekeeping items.
