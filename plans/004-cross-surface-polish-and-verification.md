# Plan 004 — Cross-surface polish and verification

## Objective

Remove the remaining high-confidence friction and generated-template tells without reopening the settled brand system, then run an independent final verification.

## Evidence

- `app/workouts/_player/WorkoutPlayer.tsx:295-466` leaves opacity-hidden controls focusable and uses spring overshoot for every phase change.
- `components/AppShell.tsx:12` and `components/AppAtmosphere.tsx:110-112` keep an invisible decorative GPU loop active behind camera/workout overlays.
- Several workout, filter, and sheet controls are 36–40 px despite the 44 px design minimum.
- `components/MotionOrchestrator.tsx:6-51` implicitly reveals broad page sections; prior QA still records its hydration warning as open.
- Dashboard and marketing orbit/ring decorations do not encode product state; the existing real metrics and capture preview can carry those compositions.

## Implementation

1. Remove hidden workout chrome from the focus order and reveal it on keyboard intent before focus enters.
2. Raise all identified touch targets to at least 44 × 44 CSS px without inflating visible glyphs.
3. Disable/suspend `AppAtmosphere` on workout and full-screen capture surfaces; pause on hidden documents.
4. Replace workout phase springs with the project’s short opacity/translate transition and explicit reduced-motion fallback.
5. Narrow `MotionOrchestrator` to one intentional route entrance, resolve the existing hydration warning, and remove `transition-all` from touched controls.
6. Remove dashboard and marketing ambient orbit systems. Preserve the authorized static atmosphere and locked black/smoked-glass system.
7. Fix low-risk copy typography (`…`, curly quotes) only in touched surfaces.
8. Record PASS-06+ evidence and bug dispositions. Run Hallmark’s slop test only after implementation, then a separate verifier must re-read these plans, inspect the final diff, run gates, and issue `PASS`, `CONDITIONAL PASS`, or `FAIL`.

## Acceptance criteria

- Invisible workout controls cannot receive focus.
- Identified interactive controls meet the 44 px minimum.
- Camera/workout overlays do not run an invisible decorative WebGL loop.
- No bouncy phase motion, global section-by-section reveal, or unresolved MotionOrchestrator hydration warning remains.
- Decorative removals do not flatten functional focus/progress illumination.
- All Plan 001–003 acceptance criteria remain green.

## Verification

- Workout keyboard/persistence tests and atmosphere suspension tests.
- Responsive matrix at 320, 375, 414, 768, 1024, and 1440 px.
- Console/network review, axe scan, keyboard-only pass, reduced-motion pass, 200% zoom, no-overflow assertions.
- Typecheck, lint, full Vitest, production build.
- Hallmark slop test and independent verifier report.
