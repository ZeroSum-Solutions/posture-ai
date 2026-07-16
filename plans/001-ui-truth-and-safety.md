# Plan 001 — UI truth and safety

## Objective

Make practitioner actions and dashboard/comparison signals truthful before changing their visual hierarchy. Establish automated gates for the races and responsive states the later redesign will touch.

## Evidence

- `app/assessments/[id]/page.tsx:722-817` serializes override PATCHes but approval, PDF export, sharing, and workout launch do not await the queue.
- `app/assessments/[id]/page.tsx:1152-1198` says export is approval-gated while both export buttons remain enabled before approval.
- `app/clients/[id]/page.tsx:230-250` computes `target - base`, but `app/clients/[id]/page.tsx:421-450` permits a newer baseline and older comparison.
- `app/dashboard/DashboardExperience.tsx:42-49` counts missing scores as zero in the average and as 58 in the pulse.
- `app/dashboard/page.tsx:24-55` discards query errors and renders failed reads as legitimate zero/empty metrics.
- `components/NavBar.tsx:36-65` and `app/clients/[id]/page.tsx:152-162,354-450` do not expose current route/tab/selector relationships programmatically.

## Implementation

1. Add an observable override-save state (`idle | saving | failed`) around the existing serialized queue. Every approval, export, share, and workout action must await the queue; failure leaves dependent actions disabled with a visible retry instruction.
2. Disable both export controls until approval and while override persistence is pending/failed. Keep the API approval gate unchanged.
3. Sort comparisons chronologically. Only allow an `After` assessment later than `Before`; repair the opposite selection when one side changes and show a bounded empty state when no later assessment exists.
4. Derive one scored-only dashboard collection for both average and pulse. Preserve the unavailable state when no scored records exist.
5. Preserve each dashboard query result, detect its error, and render a retryable error boundary/state rather than coercing failures to zero.
6. Add `aria-current="page"` to navigation. Implement the client workspace selector as a real `tablist`/`tab`/`tabpanel` contract with arrow-key behavior, or an equivalent pressed-button contract if it is demonstrably simpler. Associate compare labels and selects with stable IDs.
7. Add targeted unit/component/e2e tests that delay and fail override PATCHes, assert export/launch gating, prove comparison chronology, and verify route/tab semantics.

## Acceptance criteria

- A practitioner cannot approve, export, share, or launch a stale optimistic program.
- Failed override persistence is visible and recoverable; no dependent action silently proceeds.
- The comparison UI cannot label an older assessment as the `After` state.
- Missing scores never enter dashboard averages or receive synthetic chart values.
- Failed dashboard reads never render as valid zero-client/zero-assessment data.
- Current route, selected workspace section, and compare inputs have programmatic names/states.
- Existing approval, report, workout, and deterministic-program tests still pass.

## Verification

- Targeted new tests for delayed/failed overrides and chronology.
- `npm run typecheck`
- `npm run lint`
- `npx vitest run`
- `npm run build`
- Production-mode browser check against local synthetic data at 390 and 1440 px.

