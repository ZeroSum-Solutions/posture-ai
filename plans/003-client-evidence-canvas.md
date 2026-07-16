# Plan 003 — Client evidence canvas

## Objective

Turn Progress and Compare into a responsive practitioner canvas with persistent metrics, disciplined charts, addressable evidence cards, and chronologically truthful comparisons.

## Evidence

- `app/clients/[id]/page.tsx:354-537` combines workspace tabs, selectors, grade summary, and comparison table with ad-hoc inline styles.
- `app/clients/[id]/page.tsx:414-450` keeps the compare selector grid at `1fr auto 1fr`; live 390 px screenshots show compressed controls.
- `app/clients/[id]/ProgressCharts.tsx:11-14,24-60` uses ten ungoverned chart hues and proportional numeric styling.
- Recharts is already installed and lazy-loaded; no chart or agent dependency is required.

## Implementation

1. Extract a pure client-comparison model with chronology enforcement and tests. Keep lower-is-better semantics explicit.
2. Extract the visual workspace from `page.tsx` into bounded, tested components and a CSS module aligned with `DESIGN.md` tokens.
3. Add a persistent metric strip for latest grade/deviation, assessment count, elapsed time, and latest reliability/approval context. Metrics are read-only; optional pin/collapse state may affect layout only.
4. Recompose Progress as two addressable chart cards. Keep lazy loading and Recharts. Add accessible chart summaries/fallback tables and tabular numeric styling.
5. Replace the uncontrolled series rainbow with named semantic/base series tokens plus dash/point/label distinctions. Do not distinguish meaning by hue alone.
6. Recompose Compare into Before / transition summary / After cards at desktop and a clear vertical sequence on mobile. At narrow widths, replace the wide table with labelled delta cards or rows that fit without horizontal scrolling.
7. Implement correct tab semantics, 44 px controls, stable input labels, explicit loading/empty/error states, and reduced-motion-safe crossfades.
8. Add a compact deterministic “review note” surface if space permits; it may summarize selected dates and largest deltas from existing data but must not make diagnostic or generated clinical claims.

## Acceptance criteria

- Compare controls stack cleanly at 320–414 px and remain one coherent row when space supports it.
- Every selected comparison is chronological and every improvement/regression label follows lower-is-better semantics.
- All numeric evidence uses tabular figures and remains scannable at 200% zoom.
- Charts have text/table alternatives and do not rely on color alone.
- Progress/Compare preserve lazy chart loading and do not add a new runtime dependency.
- No horizontal document scroll at all required widths.

## Verification

- Pure comparison model tests and component accessibility/responsive tests.
- Existing client/report comparison tests.
- Typecheck, lint, full Vitest, production build.
- Browser screenshots and keyboard/zoom checks at all six required widths.
