# Phase 1 PRD — Capture-quality preflight (blur/exposure warnings) · v3

slug: posture-ai-phase-1
date: 2026-07-17 (v3 after audit round 2: Sol 3 MATERIAL + Gemini 2 MATERIAL reconciled;
r1 was Sol 9 + Gemini 5)
branch: phase-1-capture-quality  base_sha: 7724184 (main after PR #130)
parent: docs/plans/2026-07-17-reliability-baseline.md §4 · docs/ROADMAP.md Phase 1
evidence: explorer summaries + DeepSeek verification + audit r1/r2 dispositions,
~/.claude/goal-state/posture-ai-phases/phase-1/

## Goal
Warn the practitioner when a capture is too blurry or badly exposed, BEFORE
analysis — as soft warnings that never block submit — closing the
"lighting/blur checks" follow-up deferred by the 2026-06-12 lever-1 design (§8).

## Core design (v3)
Pixel metrics are computed at **image-acquisition time**, from canvases that
already exist, never by re-decoding a JPEG URL:
- **Camera:** the shutter canvas holds each raw burst frame before `toBlob`
  (FullScreenCapture.tsx:436). Sample ONLY the representative middle frame
  (`i === Math.floor(BURST_SIZE / 2)` — the frame the UI moves to `burst[0]`
  at :442 for review and preflight). Extraction (GPU `drawImage` downscale +
  `getImageData` on the small canvas) happens at that frame's capture moment;
  **scoring runs asynchronously after burst acquisition** (microtask/`await`),
  before `onCameraCapture` fires — the shutter tap itself never blocks on
  scoring (r2 jank objection).
- **Upload:** `normalize-upload.ts` draws every upload to a canvas (:26-34).
  Sample that canvas (decoded-and-resized pixels, PRE-`toDataURL` — there is
  no post-encode sampling anywhere; r2 calibration-point objection) and return
  the result alongside the data URL.
- **Typed payload (r2 association objection):** camera path hands up
  `{ burst, captureRollDeg, representativePixelQuality: PixelQualityResult | null }`;
  upload path returns `{ dataUrl, pixelQuality }`. The association is pinned by
  a test that feeds deliberately different per-frame pixels and asserts the
  middle frame's metrics are the ones reported.
- **Bounded by long edge (r2 bound objection):** the sampler computes
  `scale = min(1, MAX_EDGE / max(srcW, srcH))` and proportional target
  dimensions — BOTH dimensions bounded for any aspect ratio (480×1600 portrait
  included), no aspect warp (Laplacian is aspect-sensitive).
Consequences: no second JPEG decode, all metrics on a ≤MAX_EDGE sample,
`runPreflight` gains **no new await** — the merge is synchronous, so the
staleness-token flow at page.tsx:206/229/250 is untouched.

## Product constraints (verified against code)
- Pixels exist only client-side pre-submit (landmarks-only payload, page.tsx:294).
- Soft warnings only; the sole hard block stays `no_person`. Fail OPEN on any
  compute error: try/catch at both acquisition sites → `null`; merge treats
  null as "no pixel warnings"; `modelError` never set by sampling.
- Do NOT touch lib/pose/quality.ts, quality-score.ts, or the frozen
  lib/capture/shutter-gate.ts. New module = lib/capture/pixel-quality.ts.
- Warning copy: "sentence — corrective action." style; banned stems checked
  mechanically (T5 adds `'lib/capture'` to the ui-vocabulary sweep roots).
- Thresholds are ENGINEERING DEFAULTS until Tier B data exists. All calibration
  and thresholds are produced by the SAME sampling pipeline production runs,
  inside a REAL browser (r2: node pure-JS downsampling ≠ browser GPU
  `drawImage`; thresholds calibrated in node would be invalid).

## Tasks (ordered; each criterion is a command that must exit 0)

### T1 — Pure pixel-quality scorer (TDD)
`lib/capture/pixel-quality.ts`: `assessPixelQuality(img: PixelSample): PixelQualityResult`
where `PixelSample = { data: Uint8ClampedArray (RGBA), width, height }` —
already downscaled by the caller; the scorer NEVER resizes. Computes:
- luma (Rec.601) mean + fraction clipped dark (<16) / bright (>239);
- sharpness: variance of a 3×3 Laplacian over luma.
Returns `{ sharpness, lumaMean, darkClip, brightClip, warnings: string[] }`.
Copy: "Photo looks blurry — hold the camera steady and retake." / "Photo is too
dark — add more light and retake." / "Photo is overexposed — reduce direct
light and retake." Thresholds imported from the calibration JSON (T1b).
Also exports pure `mergePreflightQuality(frameQuality, pixelQuality|null)`:
ok+pixelWarnings→'warnings'; warnings→concatenated (pixel last); 'no_person'
unchanged; null → frameQuality verbatim.
Tests (node env): synthetic patterns pin scorer behavior + boundaries + purity
+ empty input throws; merge-helper table incl. null and no_person cases.
**Verify:** `npx vitest run lib/capture/pixel-quality.test.ts` → exit 0.

### T2 — Sampler + acquisition wiring (fail-open, DI-testable)
`lib/capture/pixel-sample.ts`: `samplePixelsFromSource(source: CanvasImageSource,
srcW, srcH, maxEdge = MAX_SAMPLE_EDGE): PixelSample | null` — computes
`scale = min(1, maxEdge / max(srcW, srcH))`, proportional targetW/targetH
(no aspect warp), small-canvas `drawImage` downscale, `getImageData`; entire
body try/catch → null. Test-mode hook: when the app's existing
`POSTURE_TEST_MODE_ENABLED` is active, expose
`window.__pixelQualityHooks = { samplePixelsFromSource, assessPixelQuality }`
from the capture page (repo precedent: test-mode fixture landmarks) — this is
what T1b calibration and T4b browser specs drive.
Wire both acquisition sites per Core design (middle-frame sampling + async
scoring + typed payloads).
Unit tests (jsdom + stubbed 2d context): null on getContext-null /
drawImage-throw / getImageData-throw; proportional dims for 480×1600 and
1067×1600 inputs (both bounded ≤maxEdge); happy-path shape.
**Verify:** `npx vitest run lib/capture/pixel-sample.test.ts` → exit 0 AND
`npx tsc --noEmit` → exit 0.

### T1b — Browser-lane calibration + labeled fixture matrix
Degraded fixtures are generated ONCE by `scripts/generate-degraded-fixtures.mjs`
(Playwright chromium: gaussian σ=3 via separable pure-JS convolution on RGBA
from the real photos; exposure ×0.35 / ×2.2 clamp; encoded to JPEG in-browser)
and COMMITTED. `scripts/calibrate-pixel-quality.mjs` (Playwright chromium,
test-mode hooks) runs the PRODUCTION `samplePixelsFromSource` +
`assessPixelQuality` over the committed normal+degraded fixtures at scales
{160, 320, 480} and both source sizes (720px camera-like, 1600px upload-like);
selects the smallest scale where every sharp/blurred pair separates by ≥2×
Laplacian-variance margin; writes `lib/capture/pixel-quality.calibration.json`
(scale, thresholds, per-fixture values, 4-significant-digit rounding).
`--check` mode recomputes from the COMMITTED fixtures in the same browser lane
and fails if any recomputed value drifts >5% from the committed JSON (browser
implementation drift gate; images themselves are committed, not hash-gated —
encoding is impl-dependent by design).
Acceptance pinned by `lib/capture/pixel-quality.matrix.test.ts` (node, loads
committed JSON + fixture metrics): **0 warnings on all normal fixtures and the
correct warning on every degraded fixture.**
**Verify:** `node scripts/calibrate-pixel-quality.mjs --check` → exit 0 AND
`npx vitest run lib/capture/pixel-quality.matrix.test.ts` → exit 0.

### T3 — Merge into BOTH quality surfaces + a11y
- `page.tsx` `runPreflight`: merge via `mergePreflightQuality` — synchronous
  (pixelQuality arrives precomputed; no new await; token flow untouched).
  Sampling/scoring failure never sets `modelError`.
- FullScreenCapture.tsx review card (local `previewQuality`, :485-504): merge
  the capture's precomputed pixelQuality into the local result — warnings
  visible on the review screen before "Use This Photo"; no duplicate compute.
- A11y: slot tile accessible name appends "— quality warning" when status is
  'warnings' (:814); tile badge shows amber ⚠ instead of the green check for
  warned slots (:828). Review card keeps `role="status"`/polite.
Unit test (jsdom): capture with pixel warnings renders the amber card text and
the tile aria-label; middle-frame association test (different per-frame pixels
→ reported metrics are the middle frame's).
**Verify:** `npx vitest run lib/capture app/assessments` → exit 0.

### T4 — E2E warning flow (chromium)
Extend `e2e/capture-errors.spec.ts` (desktop-chromium): upload committed
`front_standing_blurry.jpg` + normal side fixtures for both side slots; wait
for all preflights to settle; assert (a) amber warning containing "blurry"
visible, (b) "No person detected" NOT present, (c) click Analyze → capture
overlay disappears and processing begins (submit not blocked).
**Verify:** `npm run test:e2e -- e2e/capture-errors.spec.ts
--project=desktop-chromium` → exit 0.

### T4b — Cross-engine sampler spec + perf budget (resolves r1 S10 fully)
New `e2e/pixel-sample.spec.ts` running in BOTH projects (desktop-chromium +
mobile-webkit; NOT in the webkit testIgnore list; no MediaPipe dependency —
drives the test-mode hooks): loads committed normal + blurry + dark fixtures,
asserts non-null sample, correct warning classification per fixture, and a
main-thread budget: sampler+scorer ≤ 80ms per image on the CI runner
(generous; catches accidental full-res scans). This makes the Safari check
executable instead of a logged manual QA item.
**Verify:** `npm run test:e2e -- e2e/pixel-sample.spec.ts` → exit 0 (both
projects).

### T5 — Vocabulary sweep + full gate
Add `'lib/capture'` to the roots in `lib/ui-vocabulary.test.ts:10`.
**Verify (all must exit 0):** `npx vitest run` · `npx tsc --noEmit` ·
`npm run lint` · `npm run lint:vocab` · `npm run golden` · `npm run build` ·
`npm run test:e2e -- e2e/capture-errors.spec.ts --project=desktop-chromium` ·
`npm run test:e2e -- e2e/pixel-sample.spec.ts`.

## Audit dispositions
r1 (14 material): see goal-state/phase-1/audit-reconciliation.md.
r2 (Sol 3 + Gemini 2 material, overlapping):
- Sol-1/Gemini-1 (unbounded dims + shutter jank) → FIXED: long-edge bound with
  proportional dims; scoring async after burst, off the tap path; T4b real-
  browser perf budget replaces the node-only 250ms bench.
- Sol-2 (calibration point ≠ production sampling point) → FIXED: no post-encode
  claim anywhere; calibration drives the production sampler on the pre-encode
  canvas pipeline.
- Sol-3 (representative-frame association) → FIXED: typed payload, middle-frame
  sampling, association test.
- Gemini-2 (node-calibrated thresholds invalid for browser GPU downscale) →
  FIXED: calibration runs in Playwright chromium via test-mode hooks using the
  production functions.
- Gemini-NIT (aspect warp) → FIXED (proportional dims). Sol-NIT-4 (S10 wording
  + executable Safari check) → FIXED: T4b runs on mobile-webkit; rationale now
  "a new pixel-readback operation on established Safari canvas APIs". Sol-NIT-5
  (drift gate) → FIXED: --check recomputes in-browser with 5% tolerance;
  fixtures committed; rounding pinned at 4 significant digits.

## Non-goals
Hard blocking on blur/exposure · touching quality.ts/quality-score.ts/
shutter-gate.ts · re-decoding JPEGs for metrics · threshold re-anchoring
(needs Tier B data) · server-side pixel handling (privacy boundary).

## Risks
Residual: browser-version drift can move calibration values (bounded by the 5%
--check tolerance; regenerate deliberately on chromium upgrades). Calibration
fixtures are stock photos (interim per e2e/fixtures/photos/README) — thresholds
stay conservative eng defaults until Tier B real-capture data; the 0-FP-on-
normals matrix criterion biases against over-warning, the stated product risk.
