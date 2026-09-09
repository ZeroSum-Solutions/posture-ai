# Screening provenance independent review

Reviewed model: Grok4.6 Build via subscription OAuth. Scope: capture provenance, screening adapter and descriptive verdict headline. Root integration verification:172 application tests,18 engine normalization tests, TypeScript and focused ESLint passed. Local raw proof remains under docs/qa/evidence/screening-provenance-review (repository-ignored generated evidence). This does not establish physical-device or clinical validity.

**Accept this rereview slice.** The prior CaptureRuntime BLOCK is closed. The bounded WARNs that blocked provenance are closed. Screening W1–W5 stay accepted. The review-headline change stays accepted as a separate, already-proved copy edit. Engine scores, thresholds, geometry, SQL, and report-claims sources are unchanged in this slice.

This is a source review of the frozen packet plus the supplied 397-test log, empty typecheck, and empty ESLint log. It is not a whole-app, clinical, or device certification.

---

## Prior BLOCK / WARN closure

### BLOCK 1 — `CaptureRuntime.detect` dropped `poseInput` — **CLOSED**

`createCaptureRuntime().detect` now forwards the fourth argument to the IMAGE backend, and the real deps pass it into `detectPose`.

```255:258:lib/pose/capture-runtime.ts
    detect: (src, view, source, poseInput) => exclusive(async () => {
      await enterReviewImageInternal()
      try {
        return await image.detect(src, view, source, poseInput)
```

```328:330:lib/pose/capture-runtime.ts
    async detect(src, view, source, poseInput) {
      const { detectPose } = await import('./detect')
      return detectPose(src, view, source, poseInput)
```

Proof: `capture-runtime.test.ts` “forwards the exact acquisition provenance to the IMAGE backend”; log shows 15/15 passed in that file. Wizard preflight, review still, and submit burst now reach `detectPose` with the acquisition record.

### WARN 2 — `detectPose` invented v1 metadata — **CLOSED**

Provenance is written only when the caller supplied `poseInput` and the decoded image has intrinsic size. Legacy calls keep `poseMeta` undefined.

```318:341:lib/pose/detect.ts
    if (poseInput && img.naturalWidth > 0 && img.naturalHeight > 0) {
      frame.poseMeta = { ... }
    }
```

Proof: `detect.test.ts` “does not invent acquisition provenance when the caller did not supply it” (10/10 in that file).

### WARN 3 — mirror flags are constants — **CLOSED for this slice**

Live video, canvas `drawImage(video, 0, 0)`, and the review still are locked unmirrored. Schema still rejects `analysisMirrored: true`. The stamps match this pipeline; they are not a live CSS/affine observation.

Proof: `FullScreenCapture.pixel-quality.test.tsx` “keeps live video, canvas acquisition, and the reviewed still unmirrored”.

### WARN 4 — review headline only — **ACCEPT (unchanged)**

Headline is “score decreased” / “score increased”. Red then green proof is in the tuesday-demo packet (`review-copy-red.txt` → `review-copy-green.txt`, 35 tests). This is not a product-wide copy rewrite.

### WARN 5 — 720×960 fallback stamp — **CLOSED**

Zero intrinsic video size now throws before `drawImage` or provenance stamp.

```730:734:app/assessments/new/FullScreenCapture.tsx
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        throw new Error('Camera frame dimensions unavailable')
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
```

Proof: “refuses capture when intrinsic video dimensions disappear instead of stamping fallback dimensions”.

### WARN 6 — mixed invalid capture-group rows fail-open — **CLOSED**

Any invalid row in a required group now marks that observation unavailable. A valid front group still stays descriptive.

```124:129:lib/training/screening/screeningContext.ts
    } else if (groupRows.some((row) => captureProblem(row) === 'invalid')) {
      reasons.push(`invalid_capture_group:${group}`)
    }
```

Proof: SC-02 mixed valid/invalid back-row test; `screeningContext.test.ts` 18/18.

---

## Screening W1–W5 — **still ACCEPT**

| Prior W | Current behavior | Status |
|---|---|---|
| W1 invented `unsupported` / `spine` | raw `imbalance_key`, region `unknown`, `value: null` | Closed |
| W2 attached this build’s thresholds on incompatible engine | `thresholdProvenance.status: 'unavailable'`, validity `incompatible_engine` | Closed |
| W3 null `assessment_type` treated as compatible | `unsupported_assessment_type:missing`, `scanUse: 'incompatible'` | Closed |
| W4 incompatible scans still carried `descriptive` values | every observation `unavailable`, `value: null` | Closed |
| W5 dropped driving side | persisted `observations.sides` + `drivingProfileSide` only; invalid → unavailable | Closed |

`scanAllowsGeneralTraining: true` remains a no-restriction flag, not eligibility clearance.

---

## Remaining defects

No new BLOCK in this slice.

No remaining WARN that should keep this provenance repair from merging.

Residuals that are not merge defects:

- Mirror and requested facing are still caller-supplied (`false` / `'environment'`), now locked to the current unmirrored environment-camera path. A later front-camera or CSS mirror would need new stamps and schema.
- `poseMeta` stays optional for old payloads. A frame without it still scores; screening then records explicit provenance gaps.
- Numeric EXIF angle, image bytes, and `imageSha256` are still not stored.
- Prototype RPC may leave flat `width_px` / `model_version` null; nested `pose_frame.poseMeta` is the fallback the adapter already reads.
- `work/screening-contract/remaining-claims-audit.md` is out of scope.

---

## SC01 provenance vs actual (after the repair)

| Fact | Recorded | Actual? |
|---|---|---|
| Analysis size | `img.naturalWidth/Height` | Yes |
| Source size / orientation path | caller `poseInput`, now forwarded | Yes on camera and upload paths |
| Selected model | pinned runtime, variant, path, SHA | Yes; `pose-model.test.ts` hashed the bundled files in this log |
| Analysis/display mirror | hardcoded `false` | Matches current UI; test-locked, not measured |
| View identity | `operator_asserted_not_verified` | Honest |
| Requested facing | `'environment'` | Matches `getUserMedia` constraint |
| Observed facing | `getSettings().facingMode` or `null` | Honest |

Camera no longer invents `camera_video_frame` with a null requested facing, so that path should not 422. EXIF uploads keep `exif_from_image_canvas_v1` and pre-resize source pixels. Decoder fallback keeps `browser_decoder` with null source size.

---

## Invariance

- Engine formulas, thresholds, and geometry implementation are not in the repair diff. The new normalize test only checks that a pixel reflection plus inverted roll keeps anatomical direction. **Accept score invariance.**
- No SQL or database-state change is in the packet.
- `stripFaceLandmarks` copies the rest of the frame, so `poseMeta` survives; `captures.test.ts` asserts that.

---

## Tests (do not over-claim)

Supplied focused suite: **41 files, 397 passed**, typecheck clean, scoped ESLint clean.

That log covers the repair seams: capture-runtime forwarding, detect provenance omit/stamp/cache, upload EXIF vs resize, camera zero-dimension refuse, unmirrored acquisition, frames ingress, capture-row mapping, screening adapter, and engine golden/normalize tests.

It does not prove physical-camera calibration, test/retest repeatability, clinical validity, or later training-program integration. Review-headline proof is the separate 35-test tuesday-demo run, not this 397-test log.

---

## Scoped verdict

| Piece | Verdict |
|---|---|
| Prior BLOCK 1 (CaptureRuntime forwarding) | **Closed** |
| Prior WARNs 2, 3 (test-locked), 5, 6 | **Closed** |
| Screening adapter W1–W5 | **Accept** |
| Engine score/threshold/geometry invariance | **Accept** |
| Review headline copy | **Accept** (headline only) |
| SC01 provenance through CaptureRuntime → detect → persist → screening | **Accept this repair** |
| Remaining-claims audit | **Out of scope** |
| Clinical / device / whole-app certification | **Not claimed; not accepted** |

**Ship gate for this slice:** the provenance BLOCK is fixed and tested. Merge of this capture/provenance repair is reasonable. Do not treat the screening contract as finished, and do not treat `scanAllowsGeneralTraining: true` as medical or training clearance.
