# Scan-to-programming audit annex

**Date:** 2026-09-07
**Scope:** Current `fix/workouts-server-boundary` worktree scan capture, landmark scoring, findings, and workout-generation path.
**Positioning:** Fitness/wellness screening and tracking. This audit does not establish clinical validity, injury prediction, load readiness, or physical-device performance.

## Decision

The pixel-to-landmark plumbing has several good deterministic controls: capture and display channels are separated, camera overlays and framing gates share one affine transform, upload EXIF orientation is normalized when the browser decoder supports it, stale async results are discarded, and only landmark frames are posted. Those controls support consistent execution of the current algorithm.

They do **not** make the findings suitable as autonomous strength or conditioning inputs. The current pipeline does not verify that a photograph matches its declared view or laterality, and the workout boundary drops the engine's construct-validity and uncertainty metadata before selecting priorities. The checked-in evidence explicitly says its real re-stance repeatability collection has not been authorized or completed. Workout generation should remain a practitioner-reviewed draft until view identity, repeatability, metric eligibility, and copy claims pass the gates below.

## Proven defects and gaps

### P0 — incomplete assessments could cross the human-review gate (fixed in this branch)

Before this audit, the approval endpoint scoped the update by assessment id and practitioner but did not require `status = complete`. Workout preview and mint required `practitioner_approved` but did not check status. A failed or interrupted legacy row containing findings could therefore be approved and used as program input.

The fix is deliberately narrow:

- Approval is still owner-scoped and now adds `status = complete` when granting approval; revocation remains possible for any status (`app/api/assessments/[id]/approve/route.ts:31-61`). A missing, foreign, or incomplete row produces the existing non-disclosing `404 {"error":"Assessment not found"}` response.
- Preview and mint both load `status` and reject a non-complete row with `409 {"error":"Assessment analysis is not complete."}` before reading findings or building a program (`app/api/workouts/preview/route.ts:78-92`, `app/api/workouts/route.ts:100-119`). This also covers already-approved malformed or legacy rows.
- Focused regression tests cover authentication, ownership/no-row behavior, complete approval, incomplete approval, revocation, and incomplete preview/mint rejection (`app/api/assessments/[id]/approve/route.test.ts`, `app/api/workouts/preview/route.test.ts`, `app/api/workouts/route.test.ts`).

### P0 — image view and laterality are asserted, not measured (open)

The UI collects four slots but maps them to only three detector views. Left and right profiles are stamped from the slot selected by the operator (`app/assessments/new/types.ts:8-13`, `app/assessments/new/types.ts:77-89`, `app/assessments/new/framePlan.ts:49-60`). The strict API schema verifies coordinate bounds, landmark structure, required groups, and that `profileSide` is used only for a side frame; it does not verify that pixels actually depict front, back, left, or right (`lib/validation/frames.ts:26-61`, `lib/validation/frames.ts:63-159`).

Preflight does not close this gap. It checks pose count, landmark presence, and framing. For a side image it accepts whichever bilateral landmark group scores better, independent of the declared `profileSide`; front and back use the same quality path (`lib/pose/quality.ts:122-195`). The functional real-model E2E currently uploads the same `side_standing.jpg` into both left and right slots (`e2e/real-detection.spec.ts:30-39`). That is useful evidence that the detector runs, but it cannot detect laterality swaps or duplicate-view submissions.

Consequences are deterministic even though their frequency is unknown: a mislabeled, mirrored, or duplicated image is stored under the asserted slot, and downstream left/right findings inherit that association. Do not add a guessed heuristic. Add a measured view-identity gate that can return `indeterminate`, plus an explicit practitioner confirmation when it cannot verify a slot.

### P0 — measurement quality is collapsed into workout actionability (open)

The engine uses `reliable` to mean that required landmarks meet a visibility floor (`packages/posture-engine/src/metrics.ts:7-17`). The result type explicitly says burst stability is within-capture detector jitter, **not** test-retest repeatability, and `borderline` is display-only (`packages/posture-engine/src/types.ts:47-61`). The engine weights the overall score using metric-validity and landmark-confidence factors and reports capture stability (`packages/posture-engine/src/engine.ts:109-143`).

That information is lost at the programming boundary. Preview and mint select only key, label, region, deviation, direction, severity, zone, view, and confidence (`app/api/workouts/preview/route.ts:93-104`, `app/api/workouts/route.ts:130-142`). `storedFindingToEngine` reconstructs any non-`unreliable` zone as reliable and does not restore `metric_validity`, stability, or uncertainty (`lib/findings/storedFindingToEngine.ts:8-46`). Priority selection then admits every reconstructed `warning` or `danger` finding and ranks by zone, severity, confidence, and deviation (`lib/program/selectPriorities.ts:44-97`).

This is a contract defect: detector visibility answers “could the model see the landmarks?”; it does not answer “is this construct validated, repeatable on this device, or actionable for training?” Define those as separate fields and make the program boundary consume them explicitly. Avoid a quick `borderline` filter by itself: uploaded stills have no burst, so it would penalize the better-instrumented camera path without establishing repeatability.

### P1 — the output language is stronger than the evidence (open)

Comparison policy calls 3 overall-score points or 5 severity points “Improved” or “Regressed,” while its own header identifies these values as temporary engineering fallbacks rather than validated minimal detectable change (`lib/comparison/policy.ts:3-20`, `lib/comparison/policy.ts:122-164`, `lib/comparison/policy.ts:207-217`). Report copy also attributes findings to desk/phone time, reaching, driving, sitting, or tight hip flexors and predicts that movements “usually,” “quickly,” or “noticeably” change them (`content/report/imbalance-copy.ts:16-30`, `content/report/imbalance-copy.ts:39-75`, `content/report/imbalance-copy.ts:77-106`).

Those statements are not outputs of the scan model. Until each claim has an evidence record and approved population/context, use observational language: what was measured, which view produced it, whether the measurement passed quality gates, and what a practitioner chose to explore. Do not derive injury avoidance, diagnosis, load, volume, progression, or return-to-play decisions from the grade.

## What is deterministic and currently aligned

These controls should be preserved:

- **Raw association:** each slot receives an immutable capture id; late preflight work is discarded rather than attached to a retake (`app/assessments/new/types.ts:33-39`, `app/assessments/new/NewAssessmentWizard.tsx:555-606`). Camera burst frame zero is the reviewed representative and all frames stay attached to the same slot (`app/assessments/new/NewAssessmentWizard.tsx:665-680`, `app/assessments/new/FullScreenCapture.tsx:680-757`).
- **No corrected-image scoring:** frame plans read only raw representative/burst/cached pose channels, never display previews (`app/assessments/new/types.ts:41-59`, `app/assessments/new/framePlan.ts:25-46`).
- **Camera coordinates:** the shutter canvas uses intrinsic `videoWidth`/`videoHeight`; the live video and captured review both use `object-fit: cover` (`app/assessments/new/FullScreenCapture.tsx:721-733`, `app/assessments/new/FullScreenCapture.tsx:1076-1099`). Overlay drawing and framing gates use the same source-to-viewport cover affine (`app/assessments/new/FullScreenCapture.tsx:316-326`, `lib/capture/overlay-transform.ts:29-63`, `app/assessments/new/LiveGuides.tsx:50-57`). No mirror transform is applied in the current environment-camera flow.
- **Upload coordinates:** supported browsers decode with EXIF orientation, resize to a bounded intrinsic canvas, and emit a new JPEG with the orientation baked into pixels (`lib/pose/normalize-upload.ts:20-61`). The detector records the decoded intrinsic aspect ratio, and engine geometry compensates normalized x coordinates for that aspect ratio (`lib/pose/detect.ts:226-297`, `packages/posture-engine/src/geometry.ts:61-82`).
- **Privacy and validation:** local analysis posts landmark frames rather than image bytes, and submit is blocked until each required slot has a completed one-person preflight (`app/assessments/new/NewAssessmentWizard.tsx:682-700`, `app/assessments/new/NewAssessmentWizard.tsx:725-763`). The server validates bounded coordinates and all required view/profile groups (`lib/validation/frames.ts:26-159`).
- **Program containment:** the program uses authored, admitted content; optional AI may only choose from prebuilt candidates, and mint requires human approval (`app/api/workouts/preview/route.ts:96-104`, `app/api/workouts/preview/route.ts:120-168`, `app/api/workouts/route.ts:100-119`). User-selected capability remains an explicit program input rather than being inferred from posture (`lib/program/buildProgram.ts:164-188`).

Two alignment limits remain. First, upload normalization falls back to the original object URL when `createImageBitmap` is unavailable or fails, so correct EXIF handling then depends on the browser image decoder (`lib/pose/normalize-upload.ts:20-61`). Second, `facingMode: environment` is an ideal constraint, not an exact rear-camera guarantee (`app/assessments/new/FullScreenCapture.tsx:383-385`). These are testable platform risks; no current evidence in this audit establishes their real-device failure rate.

## Unvalidated science, separated from code defects

The engine itself labels shoulder, pelvic, and knee measures as 2D proxies with engineering defaults pending validation; knee alignment has no validated 2D cutpoint in the cited design (`packages/posture-engine/src/thresholds.ts:24-52`). Its evidence table distinguishes screening-only from cited metrics and marks none as validated, while grade bands were calibrated on internal golden anchors rather than outcomes (`packages/posture-engine/src/thresholds.ts:68-99`, `packages/posture-engine/src/thresholds.ts:127-163`). These limitations do not prove the metrics are useless. They mean the repository does not establish construct validity or training actionability.

The real re-stance protocol is prepared but collection is not authorized. It explicitly excludes accuracy, day-to-day/operator/clinic reliability, clinical validity, and model-default decisions (`docs/qa/tierb-reliability/protocol.md:1-22`). It requires at least 12 participants, two exact devices, and three complete re-stances per participant (`docs/qa/tierb-reliability/protocol.md:24-41`). Eligibility requires complete-case, missingness, finite-statistic, bootstrap, view, and device gates (`docs/qa/tierb-reliability/protocol.md:124-157`). The current baseline states that the app has no test-retest number and that the Tier B directory is empty pending authorization (`docs/plans/2026-07-17-reliability-baseline.md:17-32`, `docs/plans/2026-07-17-reliability-baseline.md:53-68`).

Accordingly, current functional evidence proves execution, not scientific performance. The real MediaPipe E2E proves four uploads can produce and persist nine findings without a CDN dependency (`e2e/real-detection.spec.ts:5-56`). Synthetic noise/pitch fixtures can detect algorithm regressions. Neither is a clinical ground truth, a repeatability study, or proof that a selected exercise changes the measured construct.

## Required gates before scan-driven training constraints or measurement-change claims

These gates govern expanded uses of the scan. They do not block a general strength-and-conditioning plan based on history, goals, symptoms and actual performance while scan findings remain descriptive.

1. **Typed actionability contract.** Persist and load separate values for capture quality, landmark confidence, metric construct-validity class, device-specific repeatability eligibility, uncertainty/MDC, and practitioner disposition. A program candidate must identify which gates passed. Missing fields fail to `draft/unavailable`, not `reliable`.
2. **View-identity and duplicate-image evaluation.** Build an authorized, de-identified fixture set balanced across front/back/left/right, body presentation, devices, EXIF rotations, and intentional mirrors. Include wrong-slot, same-image-in-two-slots, cropped, and ambiguous negatives. Report a confusion matrix, wrong-slot false-accept rate, indeterminate rate, and subgroup/device slices. Freeze acceptance criteria before tuning; favor `indeterminate` over silent relabeling.
3. **Geometry invariance suite.** For pure transforms, assert the same source landmarks map to the same normalized coordinates after upload EXIF rotations, camera/upload canvas paths, cover crops, and explicit mirror transforms. For end-to-end detection, measure metric deltas rather than requiring pixel-identical landmarks. Record browser, device, camera id/facing mode, source dimensions, decoded dimensions, orientation, and model hash.
4. **Authorized repeatability study.** Execute the frozen Tier B protocol without changing thresholds to manufacture a pass. Publish device-and-metric-specific agreement SEM/MDC95, missing/unreliable rates, and bootstrap intervals. A finding with no eligible profile remains measurable but cannot drive “improved/regressed” or automatic priority claims.
5. **Construct-validity evaluation.** For each named metric, predeclare the anatomical construct, reference method, assessor blinding, population, bias/limits-of-agreement targets, and subgroup analysis. Hip-center pelvic obliquity, for example, cannot inherit claims established for a different landmark construct. Promote metrics individually; do not promote the overall grade by association.
6. **Programming evaluation.** Keep grade out of load, volume, progression, injury-risk, and readiness logic. Collect goals, training age, symptoms/red flags, recent load, equipment, movement tolerance, and practitioner decisions as independent inputs. Evaluate recommendation agreement against blinded qualified reviewers, override rate/reasons, contraindication escapes, and adverse events before claiming effectiveness.
7. **Copy provenance.** Give every causal, symptom, expected-response, and time-to-change statement a source id, reviewed population, applicability condition, review owner, and expiry. Until then, render measured observations and uncertainty, with the screening limitation adjacent to the grade and comparison result rather than only in secondary detail.

## Measurable release checks

| Boundary | Minimum evidence before expanding claims |
|---|---|
| Capture slot identity | Predeclared wrong-slot false-accept target met on held-out devices and relevant subgroups; duplicates and mirrors explicitly tested |
| Camera/upload alignment | Pure affine/EXIF invariants pass; end-to-end metric-delta distributions published per browser/device path |
| Repeatability | Frozen protocol eligible for every metric/device/view used by programming; MDC95 loaded by exact engine/model/profile version |
| Comparison language | “Improved/regressed” only when the same comparable metric exceeds its eligible MDC95; otherwise “change not established” |
| Program admission | Every priority carries measurement-quality, validity, repeatability, uncertainty, and practitioner-disposition provenance |
| Program safety | No scan-derived load/readiness/injury claim; contraindication/red-flag and professional-review escape tests pass |
| Outcome claims | Prospective, predeclared evaluation connects the intervention to relevant outcomes; scan-score movement alone is insufficient |

## Verification performed for this annex

- `mise exec node@22.23.2 -- npm exec --no -- vitest run 'app/api/assessments/[id]/approve/route.test.ts' app/api/workouts/preview/route.test.ts app/api/workouts/route.test.ts` — **22/22 passed**.
- Source trace covered upload normalization, camera capture, overlay transform, landmark association, frame validation, metric computation, stored finding reconstruction, priority selection, preview/mint gates, comparison policy, report copy, and the current Tier B protocol.
- No thresholds, clinical interpretation, model configuration, migration, deployment, or evidence packet was changed.

## Independent review of the narrow fix

Second-agent review found no blocking defect. The root independently reran the same 22 tests and full TypeScript/lint checks. Checkpoint: `bd94785`.

One nonblocking defense-in-depth followup remains: the governed and prototype workout RPCs should recheck `assessment.status = complete` inside their writer transaction in the next additive migration (`supabase/migrations/20260720020000_clinical_content_governance.sql:837`, `supabase/migrations/20260907030000_prototype_operation.sql:665`). Current application writers do not move a completed assessment back into processing/failed, and the routes now check status before generation, so review found no currently reachable downgrade race. Add a direct-RPC regression when that database invariant is introduced; preserve the existing approval/owner/client checks.
