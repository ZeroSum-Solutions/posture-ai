# Plan 002 — Assessment Review Studio

## Objective

Adapt the AI Dashboard Canvas workspace model to the deterministic assessment review flow: persistent summary and decision state, a navigable evidence canvas, and an always-reachable approval/export/session dock.

## Evidence

- `app/assessments/[id]/page.tsx:962-1204` renders one long client component containing rating, session, methodology, program controls, diagrams, 3D model, findings, the entire exercise library, disclaimers, approval, and exports.
- Live production-mode snapshots place approval/export after hundreds of interactive nodes and the full exercise library.
- The reference Dashboard Canvas separates persistent metrics from editable artifacts; its useful idea is shared workspace state, not its CopilotKit/ADK runtime.
- `DESIGN.md` requires one visible primary action and a practitioner’s next step to be legible quickly.

## Implementation

1. Characterize current action behavior before extraction. Keep all engine/program derivation and API contracts unchanged.
2. Extract bounded presentational components and an assessment-review controller from the monolith without moving deterministic program logic across trust boundaries.
3. Introduce a responsive `ReviewStudio` layout:
   - compact persistent summary rail with client/date, grade/deviation, reliability, approval state, unsaved/saving state, and section navigation;
   - main evidence canvas containing Program, Alignment, Findings, and Library views;
   - sticky action dock with exactly one primary action based on state: `Approve report`, `Launch session`, or the current in-flight action; exports and sharing remain subordinate.
4. Keep program controls addressable and locally editable, but never allow UI layout controls to alter values, findings, grades, axes, or program rules.
5. Collapse the all-matched exercise library by default behind an explicit disclosure and result count. It remains keyboard reachable and fully available.
6. Replace semantic left stripes on finding/program cards with neutral perimeters plus existing labelled severity/rank markers.
7. Stack the workspace at narrow widths. The action dock must respect safe areas and must not obscure content or focus targets.
8. Add tests for unapproved, approved, saving, failed-save, unreliable, empty-program, and generated-report states; preserve current route and test IDs where external tests depend on them.

## Acceptance criteria

- The next required practitioner action is visible without scrolling at 1024 and 1440 px and reachable within one viewport at 320–768 px.
- Only one control has primary visual weight in each approval/session state.
- Program overrides, approval, exports, sharing, and launch retain the truth/safety contract from Plan 001.
- Program, diagrams, 3D summary, findings, and library content remain available with correct semantics.
- No horizontal document scroll at 320, 375, 414, 768, 1024, or 1440 px.
- Sticky UI does not cover the footer, safe area, error messages, or focused controls.

## Verification

- Targeted assessment review component/action tests.
- Existing assessment, approval, report, program, share, and workout tests.
- Typecheck, lint, full Vitest, production build.
- Keyboard-only pass plus screenshots at all six required widths.
