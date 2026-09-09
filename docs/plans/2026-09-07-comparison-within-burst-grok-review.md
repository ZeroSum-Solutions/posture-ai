# Comparison and within-burst presentation review — 2026-09-07

Grok 4.6 reviewed the frozen comparison source packet, then reviewed root fixes for the two remaining scale-copy warnings and the label-wrapping change. Both reviews used SuperGrok OAuth and embedded sources; no repository commands or browser checks were run by the reviewer.

Root verified source and integration hashes before copying, preserved recorded values and stored comparison enums, and ran 155 focused tests, 158 content/fixture tests, typecheck, and scoped ESLint. Two warning regression assertions failed before the copy fix and passed after it. Worker evidence additionally records 171 focused tests and two authenticated desktop browser cases on the initial candidate. Mobile rendering of the new wrapping remains unverified.

A full unit run passed 258 files and exposed 57 failures in the readiness-checker suite, all due to a renamed E2E test changing the independent test-identity fingerprint. The existing generator refreshed only that fingerprint, its aggregate hash, and the checker hash binding. Root verified exact JSON equality after removing those two hash fields and exact checker-source equality after replacing the hash constant; no test counts, approval statuses, or validation logic changed. The affected checker/generator suites then passed 142 tests. This mechanical two-file refresh followed the external packet and is not claimed as externally reviewed. Fresh CI is required for the committed head.

## Initial external review

## Scoped verdict

No blocking finding remains. The slice preserves stored comparison enums, numeric policy, fallback boundaries, and comparability guards, and it presents comparable differences as recorded decreases, increases, or unchanged values with signed numbers still visible inside the fallback band.

Two warnings remain on leftover “lower is better” gloss next to comparison/trend copy. They do not restore “improved/regressed,” measurement-error, or meaningful-change claims.

## BLOCK

None.

## WARN

1. **Comparison status is still glossed as “better.”** `ComparisonWorkspace.tsx` still introduces finding comparison with “Status comes from severity percentage points, where lower is better” (`app/clients/[id]/ComparisonWorkspace.tsx:214-216`). That sits directly above “Recorded severity decreased/increased” and reintroduces outcome language this slice otherwise removed. The same gloss remains in the findings-trend footnote this slice edited (`app/clients/[id]/FindingsTrend.tsx:35-37`).

2. **Trend assistive/visible scale copy still says “lower is better” next to a comparison sentence.** `buildDescription` keeps “Deviation score out of 100; lower is better” in the same string as “Latest against previous: Screening score decreased” (`app/clients/[id]/trendModel.ts:187-189`). The limitation follows, so this is not a restored MDC claim, but it is still better/worse framing on a comparison surface.

## NONBLOCK

- Internal `improved` / `regressed` / `within_tolerance` values, `FIXED_COMPARISON_TOLERANCE` (`3` / `5`), and version, chronology, reliability, unit, and missing-value guards are unchanged (`lib/comparison/policy.ts:12-17`, `125-207`; tests at `lib/comparison/policy.test.ts:41-73`, `75-149`).
- `comparisonTone` is hard-neutral (`lib/comparison/policy.ts:256-258`). Dead `positive`/`negative` branches remain in `bandFor` (`ComparisonWorkspace.tsx:70-74`) and PDF `comparisonColor` (`lib/pdf/clientReport.tsx:45-52`, `lib/pdf/report.tsx:307-310`); they cannot fire while tone stays neutral.
- Assessment headline still uses status, not signed delta, so a within-fallback move stays “Grade C.” (`app/assessments/[id]/reviewModel.ts:201-207`, `reviewModel.test.ts:90-94`). The rail still shows the signed number (`reviewModel.ts:231-239`). That matches the accepted 8c0c96c headline note.
- History maps every `not_comparable` reason to “new engine” (`app/clients/[id]/historyRows.ts:102-108`). Comparability still fails closed; the word is coarser than the reason copy used on Compare/PDF.
- Compact dock/review labels now say “Capture quality” and “Within-burst landmark consistency” (`ReviewDock.tsx:151-153`, `ClinicalAssessmentResults.tsx:682-683`, `1085-1102`). The explicit “re-stance … not established” sentence lives in the methodology card, which is inside a collapsed disclosure (`ClinicalAssessmentResults.tsx:784-787`, `1085-1086`). The compact label no longer says “Reliability” or “Capture stability.”
- Muscle, cause, injury, and program-authority copy remains on PDFs and review; that deferral is documented and is out of this bound.

## What holds against the scoped requirements

**Stored policy and guards.** Fallback units and edge behavior are locked (`policy.test.ts:41-68`). Presenters consume `comparisonDecisionText` / `comparisonDeltaText` rather than inventing reason copy (`consumer-parity.test.tsx:186-211`).

**Neutral recorded differences.** User-facing copy is “Screening score decreased/increased/unchanged” and “Recorded severity decreased/increased/unchanged” (`policy.ts:214-230`). Tests forbid `Improved —` / `Regressed —` and `improv|regress|better|worse` on the comparison evidence list and finding descriptions (`ComparisonWorkspace.test.tsx:96-105`, `findingsModel.test.ts:121-128`, `clientReport.test.tsx:88-91`, `report.test.tsx:134-142`). Directory filter label is “Score decreased” (`clientRow.ts:36-40`).

**Fallback is not presented as error or validated change.** `MEASUREMENT_TOLERANCE_COPY` now aliases `REPEAT_CAPTURE_LIMITATION_COPY` (`policy.ts:19-23`). The old tolerance whisker is not drawn (`trendModel.ts:263`). A one-point score move is shown as a signed decrease, not “within measurement tolerance” (`ComparisonWorkspace.test.tsx:114-119`, `historyRows.test.ts:53-60`, `reviewModel.test.ts:216-224`, `trendModel.test.ts:115-124`).

**Signed numbers stay visible inside the band.** `comparisonDeltaText` returns a signed value whenever `delta` is present (`policy.ts:247-253`). Review rows, history, trends, Compare, and both PDFs attach that number for comparable pairs, including `within_tolerance` (`reviewModel.ts:304-320`, `historyRows.ts:84-101`, `findingsModel.ts:219-226`, `trendModel.ts:157-166`, `ComparisonWorkspace.tsx:98-100,251-252`, `clientReport.tsx:226-241`, `report.tsx:342-344`).

**Repeat-capture limitation is adjacent on the required surfaces.** Shared sentence: “Recorded values can differ between screenings. Repeat-capture variability and meaningful change are not established for these measurements.” (`policy.ts:19-20`). It appears on directory (`app/clients/page.tsx:278`), scan history (`ClientDetailClient.tsx:778`), trend footnote/description (`trendModel.ts:170-177,189`), findings trend (`FindingsTrend.tsx:35-37`), Compare change summary (`ComparisonWorkspace.tsx:181-184`), assessment rail (`reviewModel.ts:248,256-257`), and both PDFs (`clientReport.tsx:231`, `report.tsx:493-499`). E2E checks the Compare panel (`e2e/clients.spec.ts:274-281`).

**Within-burst, not re-stance.** Compact and methodology copy use “Within-burst landmark consistency” and “Within-burst angle variation,” and the methodology paragraph states that re-stance repeatability and clinical accuracy are not established (`ClinicalAssessmentResults.tsx:682-683,1085-1102`; `ReviewDock.tsx:151-153`; tests at `ClinicalAssessmentResults.performance.test.tsx:179-181`, `ReviewDock.test.tsx:57-59`).

**Not-comparable guards.** Version, chronology, unreliable, unit, and missing-value copy remains centralized (`policy.ts:231-244`). Compare, trends, review, history, and PDFs still fail closed (`ComparisonWorkspace.test.tsx:122-134`, `trendModel.test.ts:127-136`, `reviewModel.test.ts:127-132`, `e2e/clients.spec.ts:283-287`).

Verification attached to this slice: 171 focused tests passed, scoped e2e passed, `tsc --noEmit` passed, scoped ESLint clean, `git diff --check` clean.

**Verdict:** no BLOCK. Address the leftover “lower is better” gloss on Compare and trend/findings copy if this bound must be free of better/worse framing; otherwise the comparison and within-burst presentation meets the scoped requirements.

## Focused follow-up review

## Scoped verdict

WARN1 and WARN2 are closed in the supplied sources. Compare, findings-trend, and trend-description copy no longer use “lower is better.” They now state that lower values indicate less recorded deviation. The within-burst row now requests wrap in source. That wrap is not mobile-validated. The inventory refresh is a single algorithm fingerprint plus the aggregate hash, with IDs, counts, fixture review statuses, and live activation fields left as they were.

No blocking finding remains in this bound.

## BLOCK

None.

## WARN

None remaining from WARN1 or WARN2.

## Closure

**WARN1 — closed.** `ComparisonWorkspace.tsx` now says status comes from severity percentage points, “where lower values indicate less recorded deviation.” `FindingsTrend.tsx` now says severity is a 0–100% scale with the same gloss. Neither string contains “better” or “worse.” The Compare evidence test still forbids `improv|regress|better|worse` on the evidence list and now also asserts `queryByText(/lower is better/i)` is null. That is scale direction, not restored “improved/regressed” or meaningful-change language.

**WARN2 — closed.** `buildDescription` now uses “Deviation score out of 100; lower values indicate less recorded deviation.” The labelling test requires that phrase, forbids `better|worse|improved|regressed`, and still expects “Screening score decreased” plus the repeat-capture limitation. The comparison clause remains recorded-difference copy.

**Within-burst row wrapping — source-present, not runtime-proved.** The AccuracyCard finding row adds `flexWrap: 'wrap'`, `alignItems: 'baseline'`, `minWidth: 0`, and `overflowWrap: 'anywhere'`. Labels stay “Within-burst angle variation” and “Within-burst landmark consistency.” There is no captured mobile browser evidence in this packet, so this review does not treat wrapping as visually verified.

**Source-derived hash refresh — consistent with the supplied proof.** Only `algorithm:recommendation-engine` (`e2ca7b44…` → `e20b0883…`) and `inventory_sha256` (`a3cc0931…` → `d977d507…`) change. The same pair is bound in the inventory file, governance doc, seed release/item/activation rows, and the listed SQL tests. Proof states counts and identities are unchanged. Seed still uses `local_test_fixture`, the existing `approved` item status, and the existing activation singleton; those fields are not otherwise edited. This review did not recompute the hashes.

## What this bound does not claim

This pass does not re-audit stored comparison enums, PDF copy, or other surfaces. It does not treat the wrapping CSS as a passed mobile check. It does not treat the inventory refresh as a content or activation change.
