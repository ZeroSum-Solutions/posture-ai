# QA Loop — Iteration 6 (PASS-06) — CROSS-SURFACE POLISH

**Date:** 2026-07-15

**Scope:** Plan 004 only on `codex/ui-optimization-loop`

**Verdict:** **CLEAN** — scoped implementation and automated acceptance are green.
Physical-device audio, camera, wake-lock, and one-thumb checks remain truthfully blocked
under `CAM-REAL`; the root advisor owns the required independent final verification.

## Implemented

- Replaced hydration-racing descendant mutation with one route-level entrance.
- Added a tested policy that disables WebGL atmosphere on root, auth, onboarding,
  assessment capture, and workout routes; hidden documents suspend frames.
- Removed hidden workout chrome from the accessibility and tab order, revealed it before
  keyboard traversal, prevented focus from entering obscured shell navigation, and
  replaced phase springs with short opacity/translate transitions.
- Raised identified workout, exercise-filter, and assessment-sheet controls to 44 px.
- Removed dashboard/marketing orbit and ring systems, card/list stagger animation, and
  the dashboard pulse loop while preserving state-bearing progress illumination.
- Replaced the marketing workflow's equal three-card row with an asymmetric Capture /
  Review / Coach composition and removed inert preview buttons from the interactive tree.

## Regression evidence

- Fail-first atmosphere policy: focused Vitest initially failed because the policy module
  did not exist; it now passes 12 cases.
- Workout keyboard flow: the first browser run caught native Tab traversal entering
  obscured app navigation. The player now focuses its first revealed control; regression
  coverage passes.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 0 errors and 22 pre-existing warnings.
- `npm test -- --run`: PASS, 91 files / 725 tests.
- `npm run build`: PASS, Next.js 16.2.6 production build.
- Desktop Chromium `a11y` + `workout-player`: PASS, 11/11, including all 7 Axe
  budget tests and all 4 workout flows.

## Responsive and browser evidence

- Anonymous marketing, authenticated dashboard, and exercises: no horizontal overflow at
  320, 375, 414, 768, 1024, or 1440 px.
- Assessment wizard at 1440 px: no overflow and no browser console errors.
- The combined manual sweep reported zero browser console errors.
- Representative visual captures reviewed:
  - `/Users/zero-suminc./Inbox/screenshots/posture-ai-pass-06/marketing-320.png`
  - `/Users/zero-suminc./Inbox/screenshots/posture-ai-pass-06/marketing-1440.png`
  - `/Users/zero-suminc./Inbox/screenshots/posture-ai-pass-06/dashboard-320.png`
  - `/Users/zero-suminc./Inbox/screenshots/posture-ai-pass-06/dashboard-1440.png`

## Hallmark slop disposition

Pre-emit critique on touched compositions: **P5 H5 E4 S5 R5 V5**. The bounded diff
removes equal three-card structure, ambient orbits, stagger-everything motion, phase
overshoot, inert buttons, and wrapping compact actions. This is a **conditional Hallmark
pass**: the governing `DESIGN.md` system deliberately retains Inter, a black canvas,
existing spacing values, and existing token conventions that Hallmark's greenfield gates
would otherwise reject. Plan 004 explicitly forbids reopening those settled decisions.
No new runtime dependency, token system, gradient text, `transition-all`, decorative
animation loop, or unsupported product claim was introduced.

## Remaining honest blockers

- `CAM-REAL`: physical iPhone Safari and Android Chrome camera/player pass.
- Live speech quality, wake-lock behavior, video-overlay contrast, and one-thumb reach.
- The independent verifier verdict required by Plan 004 is outside this executor pass.
