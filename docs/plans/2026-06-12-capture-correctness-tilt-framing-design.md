# Capture Correctness: Tilt Correction + Framing — Design

**Date:** 2026-06-12
**Status:** Design (pending approval)
**Scope:** Assessment accuracy — intake/capture correctness, lever 1 of 3
**Author:** Devin + Claude (brainstorming session)

---

## 1. Problem & context

Posture AI scores posture with a deterministic geometry engine: MediaPipe BlazePose
detects 33 landmarks client-side, the engine computes 10 postural angles
(forward-head, shoulder tilt, pelvic obliquity, knee alignment, …) and maps each
to a severity zone. This architecture is sound and matches the evidence: with a
**standardized capture protocol**, smartphone photogrammetry reaches excellent
reliability (test–retest ICC = 0.90 for the craniovertebral angle across 29
studies [1]); without standardization, free posture assessment collapses to
near-zero reliability (Kendall's W ≈ 0 on 36/37 measures [5]). Standardized
positioning and a level camera are *the* preconditions [2].

Today the app does not enforce those preconditions. Two capture defects directly
corrupt the angle math:

1. **No camera-tilt handling.** Every angle is measured against the *image's*
   axes, assuming the phone was perfectly level
   (`metrics.ts` uses `angleFromVertical(dx, dy)` and `atan2(dy, |dx|)` on raw
   image coordinates). A 4° phone tilt shifts forward-head by ~4° — but the
   forward-head *warn* threshold is 5° and the shoulder/pelvic warn threshold is
   just 2° (`thresholds.ts`). A tilt smaller than the deviation being measured can
   silently flip a result between zones. The live camera draws a plumb line, but
   it is **cosmetic only** — nothing reads device orientation, nothing measures or
   corrects tilt, and photo-library uploads bypass even the visual hint.

2. **Latent aspect-ratio bug.** Angles are computed in normalized `[0,1]` space,
   but the image is 3:4. A normalized Δy of 0.1 is 96 px while Δx of 0.1 is 72 px,
   so the same normalized offset means different physical distances per axis:
   from-vertical angles (forward head, T1 tilt, pelvic shift) are
   **systematically overstated by ~33 %** and from-horizontal angles (shoulder,
   pelvic obliquity) **understated by ~25 %**. This compounds with tilt and must
   be corrected for de-rotation to be geometrically valid anyway.

A single 2-D subject photo **cannot** separate camera tilt from the subject
leaning — they produce the identical image. The only clean "was the camera level?"
signal is the phone's own motion sensors at capture time, which exist for in-app
capture but not for uploads (PR #8 made uploads a first-class mobile path).

## 2. Goals & non-goals

**Goals**
- Measure camera roll on-device during live capture; gate and guide the user to a
  level shot; record the residual roll.
- Correct the downstream geometry: de-rotate landmarks by the measured roll so
  every metric is computed in a level reference frame.
- Fix the normalized-vs-pixel aspect-ratio bug as part of the same transform.
- Add framing/distance/centering checks (camera + uploads) so the subject is
  consistently scaled and in the lens's low-distortion zone.
- Be honest about uploads: flag "camera level not verified," normalize EXIF
  orientation, surface the limitation in the result.

**Non-goals (explicitly out of scope for this task)**
- Lighting / shadow / exposure / blur checks (lever 1 follow-up).
- Switching to MediaPipe metric **world landmarks** or sensor-gravity fusion
  (future direction; full detection rewrite).
- Any change to thresholds, grade/percentile model, metric *definitions*, or
  exercise/citation content (levers 2 and 3).

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Which accuracy lever first | **Capture correctness** (highest ROI; garbage-in dominates) |
| How far it reaches | **Measure + correct** (full-stack: sensor → schema → engine) |
| Breadth | **Tilt + framing** (the two defects that corrupt landmark geometry) |
| Tilt-correction strategy | **De-rotate landmarks once, centrally** (see §4) |
| Aspect-ratio bug | **Include the fix** in this task (changes existing scores; gated by golden tests) |

**Rejected alternatives.** *Per-metric tilt subtraction* — 10 special cases
(vertical-ref vs horizontal-ref vs knee-angle where tilt cancels), error-prone,
doesn't fix the aspect bug. *World landmarks + gravity fusion* — most correct
long-term but a full rewrite; deferred.

## 4. Architecture

Single insertion point. Pose detection already runs client-side and emits a
`PoseFrame` that is POSTed to `/api/assessments` and fed to `assessPosture()`.
We thread capture metadata onto the frame and apply one transform in the engine
before any metric runs.

```
CameraCapture ──measures roll (DeviceOrientation)──┐
                                                    ▼
detectPose(preview,view) ──attaches aspectRatio,source──► PoseFrame{
                                                              view, landmarks,
                                                              captureRollDeg?,   // camera only
                                                              aspectRatio?,      // all frames
                                                              source?            // 'camera'|'upload'
                                                            }
                                                    │ POST (Zod-validated)
                                                    ▼
assessPosture(frames):
  for each frame:
     corrected = normalizeFrame(frame)   // aspect-correct + de-rotate (−roll in
                                         // y-up terms = +captureRollDeg in the
                                         // engine's y-down screen coords)
  run 10 metrics on corrected frames
  attach tiltCorrected / levelVerified flags to result
```

### 4.1 Capture — measure tilt + level gate (live camera)

- On entering the camera (a user gesture), call
  `DeviceOrientationEvent.requestPermission()` where required (iOS Safari).
  Android fires `deviceorientation` without a prompt. Degrade gracefully if the
  API/permission is unavailable: no gate, frame marked level-unverified.
- Compute a single **camera-roll** angle. Held in portrait with the camera aimed
  horizontally (beta ≈ 90°), image roll about the optical axis ≈ `gamma`. Also
  check `beta` is within ~75–105° (phone roughly upright); a pitched phone causes
  keystone/perspective distortion that de-rotation cannot fix → warn. If
  `screen.orientation` is not portrait, prompt "hold phone upright."
- The cosmetic plumb line becomes a **live level indicator**:
  - `|roll| ≤ 2°` → green ("Level").
  - `2° < |roll| ≤ 5°` → amber (allowed; will be corrected).
  - `|roll| > 5°` → red, shutter blocked, with a manual override.
  - Thresholds grounded in the 2° smallest warn threshold and ~±1–2° sensor noise.
- Record signed `captureRollDeg` at the capture instant (countdown and manual).

### 4.2 Framing — full-body, distance, centering (camera + uploads)

Extend `assessFrameQuality()` beyond landmark visibility to geometry:
- **Distance/scale:** head-top → ankle spans ~70–90 % of frame height. Too small =
  too far (low precision); too large = cut off.
- **Centering:** hip-midpoint near horizontal center (low-distortion lens zone).
- **In-frame:** key joints within frame bounds (schema allows −0.5…1.5, so
  off-frame joints are detectable).

Same check runs for camera and uploads (image-based). In the live camera it drives
real-time guidance ("step back" / "center up" / "fits"). Framing remains a **soft
warning** (current philosophy), escalating to block only when already unusable
(covered by existing no-person / legs-not-visible).

### 4.3 Plumbing — frame metadata

- `packages/posture-engine/src/types.ts` — add to `PoseFrame` (all optional, so
  fixtures and historical payloads still validate):
  - `captureRollDeg?: number` — signed roll, camera captures only.
  - `aspectRatio?: number` — image width / height, all frames.
  - `source?: 'camera' | 'upload'`.
- `lib/validation/frames.ts` — extend `frameSchema` with the same optional fields
  (bounded: `captureRollDeg` within ±45, `aspectRatio` within 0.1…10).
- `lib/pose/detect.ts` — `detectPose` attaches `aspectRatio` (known from the
  canvas) and `source`.
- `app/assessments/new/page.tsx` — `CameraCapture` measures roll and passes it
  through `handleCameraCapture` → slot → frame before POST.

### 4.4 Engine correction — `normalizeFrame`

New immutable helper in `packages/posture-engine/src/geometry.ts`:

```
rotatePoint(p, rollDeg, aspect, pivot) -> new point
normalizeFrame(frame) -> new PoseFrame
```

- **Aspect-correct:** work in height-fraction units `x' = x * aspect, y' = y`, so
  both axes share a physical scale. (Rotation preserves angles independent of
  pivot; use image center.)
- **De-rotate:** if `captureRollDeg` is present, rotate every landmark by
  `−captureRollDeg`. If absent (uploads), aspect-correct only.
- Returns **new** landmark objects — never mutates input (immutability rule).
- Metrics consume corrected frames; their formulas are unchanged. Because the
  corrected space is square and level, the existing `atan2` math now yields **true**
  angles — this is where the aspect-ratio fix takes effect.

`assessPosture()` maps each frame through `normalizeFrame` before computing
findings, and records:
- `tiltCorrected: boolean` (any frame had a roll applied),
- `levelVerified: boolean` (all scored frames came from sensor-verified capture).

These are added to `AssessmentResult` (and persisted) for UI surfacing.

### 4.5 Uploads — honest about the limit

- Read **EXIF orientation** on upload and normalize the bitmap before detection.
  Cheap win for the common sideways-iPhone case; does **not** recover fine roll.
- Mark the slot "Camera level not verified — results may be less accurate."
- Carry `levelVerified: false` into the result.
- Do **not** alter numeric `confidence` (it means landmark visibility; keep that
  semantic clean) — the level caveat is a separate flag.

### 4.6 Output surfacing

`app/assessments/[id]/page.tsx` shows a small per-result badge:
"Tilt-corrected −3.4°" or "Level unverified (uploaded)." Keeps the correction
transparent rather than silent.

## 5. Data-flow summary

1. User opens camera → permission → live roll read.
2. Capture → `captureRollDeg` recorded; `detectPose` attaches `aspectRatio`,
   `source`.
3. Preflight quality = visibility (existing) + framing (new).
4. POST frames (Zod validates new optional fields).
5. `assessPosture` → `normalizeFrame` per frame (aspect-correct + de-rotate) →
   metrics → findings + `tiltCorrected` / `levelVerified`.
6. Result page badges the correction state.

## 6. Testing

- **`rotatePoint` / `normalizeFrame` units:** a fixture rotated by +R then
  de-rotated by −R returns to the level fixture within ε. Aspect-correction of a
  known 3:4 frame yields expected true angles.
- **Engine equivalence:** a synthetically tilted frame + matching `captureRollDeg`
  produces the **same** findings as the level frame (tilt is removed).
- **Aspect-ratio golden values:** existing fixtures get updated golden findings so
  the score shift is reviewed, intentional, and locked.
- **Framing checks:** fixtures for too-far, too-close, off-center, feet-cut-off →
  expected warnings.
- **Upload path:** EXIF-rotated fixture is normalized; result carries
  `levelVerified: false`.
- **Graceful degradation:** no DeviceOrientation support → no gate, marked
  level-unverified, no crash.
- E2E (`e2e/assessment-flow.spec.ts`): camera level indicator renders; upload path
  shows the level-unverified flag.

## 7. Risks & mitigations

- **Sensor mapping across orientations/devices** (gamma vs beta, landscape):
  constrain to portrait, validate `beta`, degrade gracefully. P0 device-spike
  findings (`docs/plans/2026-06-12-p0-device-spike-findings.md`) inform this.
- **Score shift from the aspect fix** could surprise existing users/tests:
  golden-value tests + a note in the result/changelog; bump `ENGINE_VERSION`.
- **iOS permission friction:** request on an explicit gesture; if denied, fall
  back to upload-style level-unverified rather than blocking capture.
- **Over-gating frustrates users:** tilt gate has a manual override; framing stays
  soft warnings.

## 8. Out of scope / follow-ups

- Lighting/shadow/exposure/blur checks (finish lever 1).
- Lever 2: validated metric definitions (e.g. craniovertebral angle), normative
  thresholds, confidence/MDC bands, replace invented grade/percentile.
- Lever 3: peer-reviewed citations on metrics, thresholds, and the 11 exercises.

## References

[1] Karbalaeimahdi M, et al. *Photogrammetry-based smartphone applications for
spinal posture assessment: a systematic review and meta-analysis.* Scientific
Reports, 2025. (29 studies, n=1910; CVA test–retest ICC = 0.904, inter-rater
0.889.)
[2] Stoliński L, et al. *Two-dimensional digital photography for child body
posture evaluation: standardized technique, reliable parameters and normative
data.* Scoliosis and Spinal Disorders, 2017.
[5] Hajduk K, et al. *Reliability of photographic postural assessment in male
elite junior soccer players.* Br J Sports Med, 2017. (Qualitative/visual
assessment unreliable; Kendall's W ≈ 0 on 36/37 measures.)
[12] Moreira R, et al. *A computer vision-based mobile tool for assessing human
posture: a validation study.* Comput Methods Programs Biomed, 2021. (Markerless
PoseNet valid in frontal view; markers improve reliability.)
[19] Pivotto L, et al. *Radiography and photogrammetry-based methods of assessing
cervical spine posture in the sagittal plane: a systematic review with
meta-analysis.* Gait & Posture, 2021.
