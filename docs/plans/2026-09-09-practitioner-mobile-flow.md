# Practitioner mobile flow checkpoint

The existing application is the product being demonstrated. This change refines its established scan, client, exercise, and workout routes; it does not create another demo application.

## Current implementation scope

- Assessment entry: compact client search with tolerant local ranking, an expandable owned-client list, a prominent New client action, and separate camera/upload choices. Preserve consent, image validation, private storage, and assessment ownership.
- Exercise library: one searchable catalogue and consistently padded responsive cards; visible instructions and honest source/review status. Reference exercises retain the existing Add to routine path.
- Client overview: current deviation reading, the three highest reliable findings, and an early lightweight anatomy entry. Keep historical detail below. Never render null as a number or infer unchanged status from absent comparison data.
- Comparison: display percentage-point changes only for compatible, reliable readings. A lower recorded score is not proof of a clinically meaningful improvement.
- Anatomy host: selectable linked-region buttons using the existing trusted viewer message contract. Replace the decorative alignment point cloud with a clearly labelled generic region guide.
- Today and Workouts: prominent quick actions and client creation directly within Workouts. Creating from scan returns with the new client selected.

## Explicit remaining work

Every exercise addable to one routine requires a backend contract extension. The current routine snapshot accepts only immutable Wger references. The 73 authored content exercises cannot safely be assigned a matching Wger ID by name. Add a versioned authored-content source with a frozen content hash, source and review metadata, corresponding database validation and routine execution support. Preserve existing snapshots and prove mixed-source save/load/execution before enabling those Add buttons.

The separate anatomy implementation is specified in `2026-09-09-claude-anatomy-viewer-prompt.md`: better model assets, upright camera constraints, verified left/right mapping, anatomical layers and filtering. No tight/weak muscle claim should be inferred solely from a posture score.

## Verification

Focused component tests cover client creation/selection, capture entry and lifecycle, reliable comparison/null handling, linked-region filtering and the unified library. Browser checks use synthetic local data for responsive layout and end-to-end scan navigation. Physical iPhone camera proof remains distinct from browser emulation. Record exact results and release commit in the checkpoint handoff after integration; do not treat this document as a passing test receipt.

### Checkpoint evidence

- 278 focused tests passed across 18 files, including readiness inventory checks. The final full unit suite passed 3,728 tests across 409 files (one skipped); the production build passed.
- WebKit scan/exercise journeys passed, including responsive widths 320–1440, card insets, file-input selection, and a no-hydration-error anatomy deep-link regression.
- Seven client browser cases passed. The separate privacy lifecycle case stopped at `clinical_content_disabled` during share setup, before the changed UI. The installed isolated database still references an older inventory hash. The generated inventory and fresh-seed fixtures are reconciled, without changing the installed database or clinical approval ledger. This is not recorded as a privacy pass.
- The previous main commit's engineering CI job passed, but its broad browser run had 30 failures and its performance run failed. These are pre-existing baseline results, not a pass or failure attribution for this change.
- The new chart uses real compact SVG coordinates and deterministic UTC dates; no CSS-distorted chart text or Safari `Sept`/`Sep` hydration mismatch remains in the checked path.
