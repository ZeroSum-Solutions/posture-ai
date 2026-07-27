# QA Loop — Iteration 6 (PASS-06) — COMPLETED SCREENING RESULTS

**Date:** 2026-07-25
**Scope:** completed screening results flow at 390 × 844 and 1440 × 1000, with
375 × 812, 844 × 390 landscape, 125% text, keyboard, and reduced-motion checks
**Verdict:** **UI SUCCESS / LANDING BLOCKED BY REQUIRED CLINICAL APPROVAL**

## One checklist

Each category is scored from 0–5 against the same checklist on every visual pass.

| Category | Baseline | Final |
|---|---:|---:|
| Grade and status glanceability | 2 | 5 |
| Findings discoverability | 2 | 5 |
| Information architecture and scroll containment | 1 | 5 |
| Action hierarchy | 2 | 4 |
| Responsive and accessible navigation | 1 | 5 |
| Visual coherence and density | 1 | 4 |
| **Total** | **9 / 30** | **28 / 30** |

Success target was at least 26/30 with these non-negotiable gates: real tabs, grade
above the fold, one mounted panel, Findings available from the initial viewport, no
horizontal overflow, keyboard tab operation, and green focused regressions. All UI
gates passed.

## Changes retained

- Replaced five stacked result sections with Summary, Findings, Program, Exercises,
  and Evidence tabs using the WAI-ARIA tab pattern and URL hashes.
- Made Summary grade-first, with Review / Maintain / Unavailable finding counts and
  a direct Findings action.
- Rendered finding rows as compact practitioner-scan disclosures; deeper measurement,
  cause, and muscle context opens on demand.
- Closed the 50-exercise collection by default and kept program, exercise, and evidence
  surfaces out of the document until their tab is selected.
- Removed the anchor-based section navigation from the action dock.
- Put the review canvas before actions on mobile; retained a sticky practitioner dock
  beside the canvas on desktop.
- Applied the same hierarchy to the assessment-only fallback.

Kimi K3 independently reviewed the original route and recommended the grade-first,
five-tab information architecture plus closed-by-default disclosures. The retained
implementation follows that hierarchy while preserving existing controls and test IDs.

## Browser evidence

- Baseline mobile clinical route:
  `docs/qa/evidence/UI-RESULTS-pass-01-mobile-clinical-before.png`
  — 14,874 px / 17.62 viewports.
- Final mobile Summary:
  `docs/qa/evidence/UI-RESULTS-final-mobile-summary.png`
  — 2,715 px / 3.22 viewports.
- Final mobile Findings:
  `docs/qa/evidence/UI-RESULTS-final-mobile-findings.png`
  — 3,245 px / 3.85 viewports; nine rows closed by default.
- Final desktop Summary:
  `docs/qa/evidence/UI-RESULTS-final-desktop-summary.png`
  — 1,555 px / 1.56 viewports.
- Final 375 px and landscape checks:
  `docs/qa/evidence/UI-RESULTS-final-mobile-375.png` and
  `docs/qa/evidence/UI-RESULTS-final-landscape.png`.

Fresh browser state was used for every full visual pass. Final browser assertions:
one tabpanel mounted, 375 px horizontal width 375/375, all tabs visible, all tab targets
44 px high, ArrowRight moved focus and selection from Summary to Findings, reduced-motion
transition duration effectively zero, 125% text produced no horizontal overflow, and
the browser console reported zero errors or warnings.

## Automated verification

- Production build with explicit local preview fixture flags: PASS.
- Focused result-component unit tests: PASS, 4 files / 17 tests.
- TypeScript: PASS.
- ESLint quiet: PASS.
- Vocabulary/content tests after inventory generation: PASS, 11 files / 143 tests.
- UI-focused desktop Chromium E2E: PASS, 11 / 11.
- Broader desktop Chromium set before reseed: 13 / 14; the only failure was the
  governed cross-version report after the source inventory hash changed.
- Full unit suite: 1,992 / 2,000 PASS. The eight failures are all the intentional
  clinical-provenance stop gate: seed SQL, SQL tests, and governance documentation
  still contain the previously human-reviewed hashes.

## Stop reason

The UI completion criterion passed at 28/30. Landing is stopped at the required-approval
condition: `ClinicalAssessmentResults.tsx` is part of the governed recommendation-engine
source inventory. The generated inventory now truthfully reflects the UI change, while
the approved release/activation literals remain untouched. A new clinical review and
activation cycle is required before this branch can be landed without failing closed.
