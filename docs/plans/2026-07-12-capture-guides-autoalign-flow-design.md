# Capture Screen: Live Guides, Auto-Align & Free-Order Flow — Design (v3, Codex-hardened)

**Date:** 2026-07-12
**Status:** Design (pending approval) — v3 after a second Codex GPT-5.6 (xhigh) review confirmed v2 resolved every *architectural* blocker but flagged six specification-precision items; v3 freezes them in §11
**Scope:** Capture UX — live guidance overlay, device-local auto-correction, free-order 4-view flow, per-shot quality score (Task brief items 2 + 3)
**Builds on:** `2026-06-12-capture-correctness-tilt-framing-design.md` (shipped in engine 2.0.0). Extends; does not re-derive.
**Author:** Devin + Claude (brainstorming) · adversarially reviewed by Codex GPT-5.6 (xhigh)

## 0. What changed from v1 (why v2 exists)

Codex reviewed v1 against commit `ac84ace` and returned **NO-GO** with code-grounded blockers, all verified against source before this rewrite:

- **Privacy violation.** The DB enforces `captures_no_image_bytes CHECK (storage_path IS NULL)` and the product never persists images (`docs/RUNBOOK.md`: "Photos are never uploaded or persisted — landmarks only"). v1 put corrected photos in the report/DB. **Resolved:** correction is **device-local / session-only**; report + DB stay landmark-only (user decision).
- **Per-side findings collide with `UNIQUE(assessment_id, imbalance_key)`** — two sides emitting the same metric key would violate the constraint, double-weight the overall score, and overwrite each other across reports/comparison/program. **Resolved:** one **aggregate finding per metric** + **per-side observations** (user decision).
- **Main-thread live inference freezes the UI** (`detectForVideo` is synchronous; throttling still stalls the main thread 8–12×/s). Running-mode is switchable via `setOptions` (v1's "second instance" premise was wrong). **Resolved:** live inference runs in a **Web Worker**, one serialized pose runtime.
- **Raw/display channel bleed** — making the corrected image the `preview` would feed corrected pixels into detection/scoring. **Resolved:** explicit raw-only detection channel.
- **Side label ≠ scored side** — metrics select landmarks by *visibility*, not the captured anatomical side. **Resolved:** bind `profileSide` into quality + metrics.
- **Centering gate could coach posture change** — gating on the anatomical midline lets the subject straighten a real lean to satisfy it. **Resolved:** gate on a translation-only support-base (feet-midpoint) anchor (finalized in §11.6); the posture midline is non-gating info.
- **"Never crop" unprovable; overlay coords unmapped; quality-score underspecified; capture races; memory; frame cap 15→20** — all resolved below.

**v3 (this revision):** The second Codex review verified v2's architecture — privacy/persistence, raw/display channel isolation, side-binding, and frame-cap/race/memory all came back **RESOLVED**. It returned NO-GO only on **six specification-precision freezes**, now pinned exactly in **§11**: (1) a pose-runtime state machine guaranteeing the live worker and the IMAGE scoring landmarker are never both resident; (2) a deterministic per-metric worst-side comparator + typed `observations` schema; (3) the full additive migration + every read/write/render consumer; (4) the frozen quality-score formula + the explicit decision to **keep today's gating** (only `no_person` blocks); (5) a composite rotation+translation no-crop bound; (6) a posture-invariant **feet-midpoint** centering anchor (replacing body-box).

## 1. Context (unchanged essentials)

Shipped today: rule-of-thirds grid; sensor tilt/level (`useCameraLevel`, green ≤2°/amber ≤5°/red >5°, `captureRollDeg` recorded at shutter); per-shot quality checks (`assessFrameQuality`); 5-frame burst + median + within-capture stability; instant retake; engine `normalizeFrame` de-rotates by `captureRollDeg` + aspect-corrects for scoring. The correction principle — **de-rotate by the sensor artifact, never by body landmarks** — is already the shipped architecture; we extend it.

Missing (this work adds): live pose inference; a body-midline overlay + coaching; device-local auto-correction; a user-facing quality score; four free-order views (front / left-side / right-side / back).

## 2. Goals & non-goals

**Goals**
- Live, worker-based pose inference during framing → tracking body-midline overlay (informational), guide lines, coaching, and translation-only shutter-gating.
- Device-local auto-correction of the review preview (de-rotate by sensor roll + translate-center), no source-pixel loss, never persisted, never detected.
- Four views, free order, one-tap retake; `profileSide` on side captures.
- Engine: per-side sagittal measurement → one **aggregate finding** per metric (worst side) + **per-side observations** surfaced in results.
- Per-shot 0–100 quality score from signals available at review, with explicit factors/weights/gating.
- Light device-local reference-grid overlay in review.

**Non-goals**
- Any image persistence / report imagery / privacy-model change (explicitly out — user chose device-local).
- Metric definitions, thresholds, grade model, citations (accuracy track).
- Detector swap / world landmarks (accuracy track).
- Workout/exercise form, reps (future phase).
- Blur/exposure/lighting checks (prior lever-1 follow-up) — so **no "sharpness" factor** in the quality score.
- Cross-assessment before/after — deferred to results redesign (Task 4).

## 3. Decisions (brainstorming + Codex-hardened)

| Decision | Choice |
|---|---|
| Shot set | Four: `front`, `side-left`, `side-right`, `back`; fully free order + one-tap retake |
| Correction reach | Coach + **device-local** cosmetic correction (never persisted, never detected) |
| Correction integrity | De-rotate by sensor `captureRollDeg` only; center by translation only; scoring uses raw landmarks unchanged |
| Live runtime | **Web Worker**, one serialized pose runtime; scoring landmarker warmed only after live teardown |
| Side model | `view` stays `front\|side\|back` + `profileSide?: 'left'\|'right'`; **aggregate finding (worst side) + per-side observations** |
| Side binding | `profileSide` enforced in quality + metrics (near-side landmark set); contradiction warns |
| Legacy `side` | `profileSide` undefined → "Side (unspecified)", scored as today; never invent laterality |
| Centering gate | Support-base (feet-midpoint) anchor, §11.6; midline drawn **non-gating** |
| No-crop | Anchor-centered canvas sized to contain all rotated corners, §11.5; never drop source pixels |
| Quality score | 0–100 from review-time signals (person/joints/framing/level); no sharpness; explicit gating |

## 4. Architecture

### 4.1 Live runtime (Web Worker, one serialized pose task)

- New `lib/pose/live-worker.ts` (Web Worker) owns **one** `PoseLandmarker` (lite) in `runningMode:'VIDEO'`. Main thread transfers frames as `ImageBitmap`/`OffscreenCanvas`; the worker returns landmarks + `{generation, timestampMs}`. Keeps synchronous inference **off** the render thread.
- Guards: single in-flight detect; monotonically increasing timestamps; a `generation` token so stale results (after phase/view change) are dropped; `video.currentTime` dedup to skip unchanged frames; throttle target ~8–12 fps (tunable). Suspend (not close) between frames within the `live` phase; close on phase change / unmount / `visibilitychange` hidden.
- **No two concurrent GPU tasks.** The scoring IMAGE landmarker is currently warmed eagerly when step 2 opens (`page.tsx:86`). Change: defer scoring warm-up until the live worker task is closed (i.e., at review→submit), so live (worker, VIDEO, lite) and scoring (IMAGE) never hold GPU runtimes simultaneously. Scoring path otherwise unchanged.
- **Coordinate mapping.** One tested affine `sourceImage→viewport` accounting for source dims, viewport dims, `objectFit:cover` crop, portrait orientation, and front-camera mirroring, in `lib/capture/overlay-transform.ts`. Every overlay + gating coordinate goes through it; raw normalized MediaPipe coords are never drawn directly onto the stretched `0..100` SVG.
- Fallback: worker/init failure → overlay degrades to sensor-only guides (level + fixed center line, no midline tracking); capture fully works.
- **Device evidence required before merge:** iPhone Safari + mid/low Android Chrome — init time, inference p95, long-task count, dropped UI frames, memory/context-loss, and a sustained four-view session.

### 4.2 Live overlay & coaching

Via the `overlay-transform` affine, over the video:
- **Vertical center line** (fixed target) + sensor **level line** (existing thresholds/logic) + **framing lines** (head-room + feet-in-frame from `assessFrameQuality` geometry).
- **Body-midline overlay** (shoulder-mid↔hip-mid for front/back; ear–shoulder–hip–ankle plumb for sides) — **drawn for information only; never gates the shutter**.
- **Coaching**: one-at-a-time messages ("Step left", "Phone's tilted", "Feet out of frame"). Extends the existing tilt banner.
- **Shutter gate** = existing tilt gate **AND** translation-only framing (the support-base anchor within tolerance of screen center, §11.6) **AND** full-body-in-frame. Manual override preserved. Never gated on midline angle/shape.

### 4.3 Device-local auto-correction (cosmetic; never persisted, never detected)

Invariant (load-bearing): **frames handed to `assessPosture()` are byte-identical whether or not correction runs.** Correction only produces an ephemeral display bitmap.

- Channels (explicit; no semantic overload of `preview`):
  - `rawRepresentativeUrl`, `rawBurstUrls`, `rawPoseFrame` — the **only** inputs accepted by the frame builder / detection.
  - `displayPreviewUrl` (object URL), `correction` — device-local, session-only, never POSTed, never persisted, never detected.
- Correction runs **after** raw representative detection: de-rotate the display bitmap to counter camera roll — **using the same sign convention as the shipped `geometry.ts` correction** (verify against `geometry.ts:41-58`; do not introduce a new sign) — then translate-center on the support-base anchor (§11.6).
- **No-crop:** the anchor-centered composite-bounds construction in **§11.5** (never the rotate-then-translate-within-an-expanded-canvas approach, which discards the centering offset). Source pixels are never dropped. (Device-local review, so letterboxing is fine.)
- Uploads (no sensor roll): translate-center only; keep the existing "level not verified" flag.

### 4.4 Four views, free order (`view` + `profileSide`)

- **Capture layer** uses slot keys `front | side-left | side-right | back` (UI type `CaptureSlotKey`). **Domain/engine/DB `view` stays the enum `front|side|back`** + `profileSide?: 'left'|'right'` = the subject's **anatomical side nearest the camera**.
- `types.ts`: `Captures` keyed by the four slot keys; each slot carries `profileSide` for the side slots; labels/silhouettes mirror L/R.
- Tile strip: all four tappable any time; captured tiles show thumbnail + score; one-tap retake. Required: front + both sides; back optional.
- **Capture race guard:** snapshot the slot key + a fresh immutable `captureId` at shutter; set `isCapturing` to disable tile nav + shutter until burst + correction complete; key correction/preflight to `captureId`.
- **Memory:** previews are `Blob` object URLs (not base64 data URLs) in long-lived state; revoke deterministically on retake/unmount; detect-cache keys use `captureId`, not base64.

### 4.5 Engine: per-side measurement → aggregate finding + observations

- Grouping: sagittal frames grouped by `profileSide` (`left`/`right`); each side medianed and measured independently via the existing metric math (`sagittalFacing` unchanged). **Bind the side:** `forwardHeadPosture`, `trunkLean`, `kneeExtensionBackKnee` (and their quality checks) must use the **near-side** landmark set implied by `profileSide`, not the more-visible side; if the captured profile contradicts `profileSide` (facing check), **warn** (surfaced as a low-quality/uncertain flag), don't silently score the wrong side.
- **Finding identity unchanged:** exactly **one** finding per metric per assessment (respects `UNIQUE(assessment_id, imbalance_key)`), scored from the **worst (most severe) side** — conservative for screening. Overall-score weighting unchanged (no double counting).
- **Per-side observations:** the engine attaches both sides' measured deviations/zones to the aggregate finding as observation data. Persisted via a small **additive** migration: `assessment_findings.observations jsonb NULL` (+ `captures.profile_side` nullable); no change to `view_enum`, no change to the uniqueness constraint. Back-compat: null observations / null profile_side render exactly as today.
- **Legacy:** historical `{view:'side'}` frames (no `profileSide`) → scored as the single sagittal view (aggregate = that side), labeled "Side (unspecified)".

### 4.6 Per-shot quality score (explicit)

- `lib/pose/quality-score.ts`: `scoreFrameQuality(frame, view, profileSide, rollDeg) → { score:0–100, factors }` from **review-time** signals only:
  - **Person present** — hard gate (fail → block).
  - **Required joints for (view, profileSide)** visible above the visibility floor — a **warning** that deducts the joints subscore, **not** a block (§11.4). Only `no_person` on a required slot blocks, exactly as today; this is not a new gating philosophy.
  - **Framing** (subject span 0.65–0.95, support-base centering, in-frame joints; exact formula §11.4) — soft (warn, allow), weighted.
  - **Level** (|roll| at shutter vs the 2°/5° bands) — soft, weighted.
- Weights (starting point, tuned in impl): framing 40, joint-completeness 35, level 25, with the two hard gates overriding to a blocking state. **No "sharpness"** (blur is out of scope; the signal isn't computed).
- Burst **stability** is computed later in engine aggregation, **not** at review — so it does **not** gate proceed; it may be shown post-submit in the existing accuracy card.

### 4.7 Reference-grid review overlay (device-local)

The device-local corrected review bitmap on a plumb-line/level grid with the (non-gating) detected midline drawn, so deviation reads at a glance. Ephemeral; nothing persisted.

## 5. Correctness invariants (each has a test)

1. **Scoring isolation:** `PoseFrame[]` sent to `/api/assessments` is identical with correction ON vs OFF — asserted at the `fetch` boundary, across camera, upload, failed-preflight, single-frame-fallback, and retake paths.
2. **No corrected pixels detected:** only `rawRepresentativeUrl`/`rawBurstUrls`/`rawPoseFrame` reach detection; cosmetic transforms return new objects, never mutate cached landmarks.
3. **Aggregate identity:** exactly one finding row per metric; per-side values live only in `observations`; overall score unchanged vs a single-side capture of the worse side.
4. **Side binding:** a right-profile capture is measured on the right near-side landmarks; a contradicting facing check downgrades quality rather than scoring the wrong side.
5. **No source-pixel crop:** the expanded-canvas transform preserves all corners; property test over roll×offset.
6. **Gate can't coach posture:** shutter gate is a pure function of tilt + translation-only support-base centering (§11.6) + in-frame; independent of midline angle/shape.
7. **Privacy:** no image bytes leave the device; `captures.storage_path` stays NULL; POST payload carries landmarks only (existing test extended).

## 6. Touch-point map (view/laterality + channels) — from Codex, to enumerate in the plan

Capture state/UI (`types.ts`, `page.tsx`, `FullScreenCapture.tsx`); pose/quality (`detect.ts`, `quality.ts`); validation (`frames.ts` — add `profileSide`, cap per `(view,profileSide)`, total 15→20); engine (`types.ts`, `engine.ts`, `metrics.ts`); DB/seed (additive `observations`, `captures.profile_side`; **no** `view_enum` change); adapters (`buildFindingRow.ts`, `storedFindingToEngine.ts`, assessments POST/GET); results/PDF (`app/assessments/[id]/page.tsx`, `lib/pdf/report.tsx` — show aggregate + observations; back-compat); program/comparison (`selectPriorities.ts`, `buildProgram.ts`, `clientComparison.ts`, `clients/[id]/page.tsx`); golden/fixtures/e2e/mobile (single-side assumptions in `fixtures.test.ts`, `assessment-flow.spec.ts`, `real-detection.spec.ts`, `capture-camera.spec.ts`; mobile `CameraCaptureScreen.tsx`, `poseFrameSource.ts`).

## 7. Testing

Unit: the 7 invariants above; correction math (angle-preserving; §11.5 composite-bounds no-crop — both invariants: no corner dropped AND anchor at center; sign matches `geometry.ts`); overlay affine (cover-crop + mirror round-trip); per-side aggregation (worst-side comparator, observations, `reliable` copied); side-binding + contradiction warn; quality-score bands + gating (only `no_person` blocks); legacy `side` back-compat.
Golden: extend `golden/cases.ts` with L/R sagittal cases; `npm run golden` MAE stays within baseline.
E2E: 4-view free-order capture (test mode); worker overlay renders; corrected preview + reference grid device-local; capture-race guard (no view mis-association / double capture); legacy assessment renders; **privacy: assert no image bytes in the POST body**.
Device: §4.1 real-device evidence gate before merge.

## 8. Risks & mitigations

- **Worker/GPU on mobile web** → single serialized runtime, deferred scoring warm-up, suspend-between-frames, degrade to sensor-only; real-device gate.
- **Scope (4-view ripple + worker + channels)** → land in sequenced, independently-verifiable slices (see §9); additive migrations only; back-compat throughout.
- **Users misread correction as "fixing" posture** → correction is visibly cosmetic + device-local; report is landmark-only and unchanged; gate can't coach.
- **Aggregation hides asymmetry** → per-side observations surface both sides in results even though one drives the score.

## 9. Suggested build order (for writing-plans)

1. **Data model + engine (no UI):** `profileSide` on frame/validation (cap→20), engine per-side grouping + worst-side aggregate + observations, additive migrations, adapters, golden/fixtures, back-compat. Ships behind existing gates; no visible change yet.
2. **Free-order 4-view capture flow:** slot keys, tile strip, race guard, object-URL memory, retake — using existing (post-capture) detection.
3. **Worker live runtime + overlay transform + guides/coaching + translation-only gate.**
4. **Device-local auto-correction + reference grid + quality score UI.**
5. **Results surfacing of per-side observations** (bridges into Task 4).

Each slice: TDD where it has logic, then Codex GPT-5.6 (xhigh) adversarial review before land.

## 10. Open items resolved from Codex's "required pre-plan decisions"

(1) worker runtime + deferred scoring warm-up → §4.1 · (2) immutable raw/display channels → §4.3 · (3) `profileSide` semantics + enforcement → §4.4–4.5 · (4) aggregate-vs-per-side identity + score → §4.5 · (5) legacy `side` without invented laterality → §4.5 · (6) images device-local (privacy unchanged) → §4.3, user decision · (7) no-crop transform → §4.3 · (8) translation-only gate + viewport mapping → §4.1–4.2 · (9) exact quality-score inputs/gating → §4.6.

---

## 11. Frozen specifications (v3 — resolving the second Codex review's 6 GO-blockers)

These freeze the load-bearing details. Where §4 and §11 differ, **§11 governs**.

### 11.1 Pose-runtime state machine (exclusivity guarantee)

New owner `lib/pose/capture-runtime.ts` is the *only* thing that constructs/closes a landmarker during capture. Exactly one backend is resident at a time:

- Backends: (A) live VIDEO landmarker (lite) inside the Web Worker; (B) the existing IMAGE landmarker (`lib/pose/detect.ts`) for review-preflight + submit scoring.
- States + **awaited** transitions: `closed → live-video → closed → review-image → closed`.
  - Enter `live` (framing a view): assert IMAGE closed → start worker VIDEO.
  - Shutter: grab burst, then `await closeWorker()` **before** any review/preflight IMAGE detection.
  - "Use This Photo" → next view: `await closeImage()` **before** re-entering `live`.
  - Submit: worker already closed; IMAGE runtime does final scoring, then `await closeImage()`.
  - Error / `visibilitychange`→hidden / unmount: close whichever backend is open.
- `detect.ts` changes: `warmUpLandmarker()` returns `Promise<void>`; add `closeLandmarker(): Promise<void>` (`landmarker.close()` + null the singleton promise). **Remove the eager warm at `page.tsx:86`** — warming is driven by the state machine entering `review-image`. Route the review-detection (`FullScreenCapture.tsx:334`) and parent preflight (`page.tsx:175`) through the runtime owner so they participate in the lifecycle.
- Invariant test: a construction/close counter proves **≤1 landmarker resident at any instant** across a full four-view session (live→review→next-view×4→submit), including error/visibility/unmount paths.

### 11.2 Deterministic per-metric worst-side comparator + observation types

Aggregation runs **per metric**, over that metric's two `SideObservation`s (from the left-profile and right-profile side frames). `severityPct` is metric-specific-normalized (`thresholds.ts` `toZoneAndPct`); **never compare raw degrees across metrics** — within one metric, `severityPct` then `deviation` are same-scale.

**Special case (checked first):** if **both** observations are unreliable, select `left` deterministically (unreliable `severityPct` is 0 and unreliable deviations aren't meaningfully comparable) — this short-circuits rules 2–3.

Total order for "worst" (first non-tie wins):
1. reliable (`zone !== 'unreliable'`) outranks unreliable
2. higher `severityPct`
3. higher `|deviation|`
4. stable tiebreak: `left` before `right`

Edge rules: both unreliable → the special case above selects `left`; one side only → use it; the winning side is persisted as `drivingProfileSide`. The aggregate `Finding`'s scored fields — `deviation`, `severityPct`, `zone`, `direction`, `confidence`, `viewUsed:'side'`, **and `reliable`** — are **copied verbatim from the driving observation**. `reliable === (zone !== 'unreliable')` is frozen for every observation and the aggregate (the engine's weighted mean filters on `f.reliable`, `engine.ts:97`), so a wrongly-`true` `reliable` can never let an `unreliable` winner into the score. Result: overall-score weighting is byte-identical to a single-side capture of the driving side.

```ts
interface SideObservation {
  profileSide: 'left' | 'right'
  deviation: number; direction: string; severityPct: number; zone: Zone
  confidence: number; reliable: boolean
  stabilityScore?: number; uncertaintyDeg?: number; borderline?: boolean
}
// Finding gains (present only for the per-side sagittal metrics):
observations?: SideObservation[]
drivingProfileSide?: 'left' | 'right'
```

### 11.3 Additive migration + every consumer

New migration `supabase/migrations/2026071X000000_per_side_observations.sql` (no `view_enum` change, no uniqueness change):
```sql
ALTER TABLE captures ADD COLUMN profile_side TEXT NULL CHECK (profile_side IN ('left','right'));
ALTER TABLE captures ADD CONSTRAINT captures_profile_side_only_side
  CHECK (profile_side IS NULL OR view = 'side');
ALTER TABLE assessment_findings ADD COLUMN observations jsonb NULL;
```
**Frozen `observations` JSON shape** (nullable, unversioned): `{ "sides": SideObservation[], "drivingProfileSide": "left" | "right" }`.

Consumers (each a plan task): assessment POST inserts `profile_side` on side captures (`route.ts:116`); assessment GET selects `profile_side` and **de-duplicates captures by `(view, profile_side)`** — `NULL` `profile_side` is the legacy unspecified-side slot — so L/R profiles are no longer collapsed into one `side` entry (`route.ts:64,99`); `buildFindingRow` maps `observations` + `drivingProfileSide`→jsonb; `StoredFinding`/`toEngineFinding` keep `observations` optional and **program reconstruction consumes aggregate values only** (documented + tested); results page types + render show the aggregate finding **plus** a per-side observations block; reports route + `PdfFinding` render per-side in the practitioner PDF (aggregate drives all program/comparison/workout logic). **Legacy `NULL` profile_side / `NULL` observations render exactly as today.**

### 11.4 Quality-score contract + gating decision

**Gating decision (frozen, conservative): no new hard gate.** Only `no_person` blocks proceed, exactly as today (`page.tsx:241`); missing required joints remain **warnings** (`quality.ts`). The 0–100 score is informational + drives soft warnings; it never blocks except via the existing `no_person` path.

Output: `scoreFrameQuality(frame, view, profileSide, rollDeg) → { score: 0–100, factors: { framing, joints, level }, warnings: string[], blocked: boolean /* true iff no_person */ }`. Frozen subscores. **Visibility floor = `RELIABILITY_FLOOR` (0.5)** for every "visible" test; any component whose required inputs are unavailable contributes **0** to its own subscore + a warning — it never throws, never blocks.
- **joints (0–35):** `(visible near-side required joints / required count) × 35`. Required near-side list: front → both shoulders+hips+knees+ankles (8); `side-left`/`side-right` → that side's ear+shoulder+hip+knee+ankle (5); back → both shoulders+hips (4).
- **framing (0–40) = span 15 + centering 15 + in-frame 10:**
  - *span (15):* MediaPipe has no "head-top" landmark, so `top = min(y of visible {nose,left_eye,right_eye,left_ear,right_ear})`, `bottom = max(y of visible {left_ankle,right_ankle})`, `span = bottom − top`. Full 15 for `span ∈ [0.65, 0.95]`; linear to 0 at `span ≤ 0.45` or `span ≥ 1.10` (clamp ≥0). No visible head **or** no visible ankle → 0 + warning.
  - *centering (15):* `d = |anchorX − 0.5|` (anchorX from §11.6). Full 15 for `d ≤ 0.15`; linear to 0 at `d ≥ 0.35` (clamp ≥0). `anchorX === null` → 0 + warning.
  - *in-frame (10):* **proportional** = `(near-side required joints with x∈[0,1] and y∈[0,1]) / required count × 10`.
- **level (0–25):** `|roll|≤2° → 25`; `2–5° → linear 25→12`; `>5° → linear 12→0 by 10°` (clamp ≥0). `rollDeg===null` (upload/no sensor) → **18** + "level unverified" warning; never blocks.
- **blocked** = `true` **iff** `no_person` (fewer than 4 landmarks ≥ floor, per `quality.ts`) on a **required** slot (front / side); an optional **back** `no_person` never blocks — this exactly preserves today's proceed-gating.

Pure + deterministic; fixture tests per band and per missing-signal case.

### 11.5 No-crop transform (composite bounds)

**(v3.1 — fixes the translation-cancellation defect Codex found: rebasing to the transformed-corner *minimum* subtracts the centering offset back out, so the subject is never centered.)** Compose rotation + centering in a fixed **anchor-centered** frame:

1. Rotate the source about its own center by `θ` (counter camera roll; **same sign as `geometry.ts:41-58`** — Codex confirmed this sign is correct; do not change it).
2. Let `A` = the rotated position of the support-base anchor (§11.6 feet-midpoint), and compute each rotated source corner.
3. Size the destination canvas as `width = 2·maxᵢ|cornerᵢ.x − A.x|`, `height = 2·maxᵢ|cornerᵢ.y − A.y|`, with **`A` placed at the canvas center**. By construction every rotated corner lies within the canvas (`|corner − A| ≤ half-extent`) → **no pixel dropped**, AND the anchor sits exactly at center → **centering is realized as asymmetric letterbox padding, not a crop** (the offset is never rebased away).
4. `contain`/letterbox that canvas into the review viewport.

Two tested invariants: (i) every source corner ∈ destination bounds; (ii) the anchor maps to the destination center. When `anchorX` is null (§11.6), skip step 2–3's centering and straighten only.

### 11.6 Posture-invariant centering anchor (feet midpoint)

A single **support-base anchor** `anchorX` drives live shutter-gating, the quality centering subscore (§11.4), **and** display auto-centering (§11.5). Deterministic availability:
1. both `left_ankle` **and** `right_ankle` ≥ `RELIABILITY_FLOOR` → `anchorX = mean(left_ankle.x, right_ankle.x)`;
2. else both `left_heel` **and** `right_heel` ≥ floor → `anchorX = mean(left_heel.x, right_heel.x)`;
3. else `anchorX = null` → **disable only the centering pieces**: the shutter centering-gate (gate on framing + tilt only), the quality centering subscore (0 + warning), and display auto-center (§11.5 straightens only). Straightening, tilt gate, framing, and the informational midline are unaffected.

This is the subject's floor position — invariant under lean, shoulder tilt, head carriage, and single-knee bend. Gate: `|anchorX − 0.5| ≤ tol`. **Body-box center is removed as a gating implementation.** The posture midline overlay stays informational/non-gating. Invariant test: hold the support-base fixed at the floor, vary lean/shoulder-tilt/head/knee → the gate decision does not change.

### 11.7 WARN-level items carried into the plan

- **Overlay affine:** `scale = max(vpW/srcW, vpH/srcH)` with centered `cover` crop offsets; **mirror only if the displayed video is actually mirrored** — capture uses the environment camera with no mirror (`FullScreenCapture.tsx:165,493`), so `mirror=false` unless a front-facing mode is added; use already-oriented `videoWidth/videoHeight` (don't double-rotate for portrait); invalidate on resize/orientation; identical transform for drawing **and** gating.
- **Worker bitmap ownership:** every `ImageBitmap` (processed, stale-generation, throttled, failed, abandoned) has one owner + a `close()` path; four-view device test asserts bounded memory after retakes + visibility transitions.
- **Contradiction detector (side-binding):** declare `profileSide`; if the declared near-side landmarks are materially *less* visible than the far-side (evidence the wrong profile was shot) → **indeterminate + warn**, never silently swap the declared side.
- **Cross-field frame validation:** `profileSide` allowed only when `view==='side'`; reject on front/back.
