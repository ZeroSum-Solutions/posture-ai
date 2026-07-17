# Phase 1 PRD — Capture-quality preflight (blur/exposure warnings) · v4

slug: posture-ai-phase-1
date: 2026-07-17 (v4 after audit round 3: Gemini 0 MATERIAL/approved; Sol 3 MATERIAL
folded in per Devin's "proceed with v4" ruling. v3 ← r2: Sol 3 + Gemini 2;
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
  (`i === Math.floor(BURST_SIZE / 2)`). **Association is by URL, not index**
  (r3 Sol-1): the burst loop skips failed encodes, so the capture path retains
  the sampled iteration's blob URL explicitly (`representativeUrl`) alongside
  its PixelSample; after the loop, that exact URL is moved to `burst[0]`. If
  the sampled iteration's encode failed, `pixelQuality = null` (fail-open) and
  burst[0] falls back to the first successful frame. Extraction (GPU
  `drawImage` downscale + `getImageData` on the small canvas) happens at that
  frame's capture moment; **scoring runs after burst acquisition behind a
  macrotask yield** (`await new Promise(r => setTimeout(r, 0))` — lets the
  burst-finished UI state paint before the CPU loop; r3 Gemini-NIT/Sol-NIT-5),
  before `onCameraCapture` fires — the shutter tap itself never blocks on
  scoring (r2 jank objection). This is deferred/bounded main-thread work, not
  free: the ≤MAX_EDGE bound + T4b's ≤80ms CI budget cap it; real-device
  verification stays a follow-up.
- **Upload:** `normalize-upload.ts` draws every upload to a canvas (:26-34).
  Sample that canvas (decoded-and-resized pixels, PRE-`toDataURL` — there is
  no post-encode sampling anywhere; r2 calibration-point objection) and return
  the result alongside the data URL.
- **Typed payload (r2 association objection):** camera path hands up
  `{ burst, captureRollDeg, representativePixelQuality: PixelQualityResult | null }`;
  upload path returns `{ dataUrl, pixelQuality }`. The association is pinned by
  a test that feeds deliberately different per-frame pixels and asserts the
  reported metrics belong to the frame at `burst[0]` — including runs that
  inject encode failures before, at, and after the midpoint (r3 Sol-1).
- **Bounded by long edge (r2 bound objection):** the sampler computes
  `scale = min(1, MAX_EDGE / max(srcW, srcH))` and proportional target
  dimensions — BOTH dimensions bounded for any aspect ratio (480×1600 portrait
  included), no aspect warp (Laplacian is aspect-sensitive). Dimensions are
  validated finite-positive and each target clamped
  `Math.max(1, Math.round(...))` so extreme panoramas can't round to zero
  (r3 Sol-NIT-4; one extreme-aspect test).
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
body try/catch → null. Test-mode hook (r3 Sol-2 — the gate must be CLIENT-side;
`POSTURE_TEST_MODE_ENABLED` is server-only, app/api/assessments/route.ts:14):
gate on the app's existing client test-mode mechanism
(`NEXT_PUBLIC_POSTURE_TEST_MODE` / the query-param path, page.tsx:24 precedent)
and expose `window.__pixelQualityHooks = { samplePixelsFromSource,
assessPixelQuality }` from the capture page. A unit/e2e check proves the hooks
exist under the test gate and are ABSENT when the gate is off (production).
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
and COMMITTED. Calibration runs as a **dedicated Playwright project through the
existing e2e runner** (r3 Sol-2: `/assessments/new` sits behind the auth proxy,
and only `scripts/run-e2e.mjs` + Playwright project deps provide the server,
env, auth, and storage state — a standalone node script gets none of that):
`e2e/pixel-calibration.setup.spec.ts` in a `calibration` project drives the
test-mode hooks, runs the PRODUCTION `samplePixelsFromSource` +
`assessPixelQuality` over the committed normal+degraded fixtures at scales
{160, 320, 480} and both source sizes (720px camera-like, 1600px upload-like);
selects the smallest scale where every sharp/blurred pair separates by ≥2×
Laplacian-variance margin; writes `lib/capture/pixel-quality.calibration.json`
(scale, thresholds, per-fixture values, 4-significant-digit rounding).
Check mode (`npm run calibrate:check` → the same project with
`CALIBRATION_CHECK=1`) recomputes from the COMMITTED fixtures in the same
browser lane and fails on drift beyond a **zero-safe tolerance**:
`|new - committed| > max(0.05 * |committed|, ABS_EPS)` per metric (relative-only
is unstable for darkClip/brightClip at or near 0; r3 Sol-3). Images themselves
are committed, not hash-gated — encoding is impl-dependent by design.
Acceptance pinned by `lib/capture/pixel-quality.matrix.test.ts` (node, loads
committed JSON + fixture metrics): **0 warnings on all normal fixtures and the
correct warning on every degraded fixture.**
**Verify:** `npm run calibrate:check` → exit 0 AND
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
drives the test-mode hooks): loads committed normal + blurry + dark +
overexposed fixtures (r3 Sol-3: live overexposure classification included),
asserts non-null sample, correct warning classification per fixture, and a
main-thread budget: sampler+scorer ≤ 80ms per image on the CI runner
(generous; catches accidental full-res scans). This makes the Safari check
executable instead of a logged manual QA item.
**Verify:** `npm run test:e2e -- e2e/pixel-sample.spec.ts` → exit 0 (both
projects).

### T5 — Vocabulary sweep + full gate + CI drift wiring
Add `'lib/capture'` to the roots in `lib/ui-vocabulary.test.ts:10`.
Add `calibrate:check` to package.json scripts AND to `.github/workflows/ci.yml`
(e2e job, after the existing `npm run test:e2e` step — it needs the same
Supabase/Playwright environment; r3 Sol-3: browser drift must fail CI, not
just local runs).
**Verify (all must exit 0):** `npx vitest run` · `npx tsc --noEmit` ·
`npm run lint` · `npm run lint:vocab` · `npm run golden` · `npm run build` ·
`npm run test:e2e -- e2e/capture-errors.spec.ts --project=desktop-chromium` ·
`npm run test:e2e -- e2e/pixel-sample.spec.ts` · `npm run calibrate:check` ·
`grep -q "calibrate:check" .github/workflows/ci.yml`.

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

r3 (Gemini 0 material — approved; Sol 3 material, folded into v4 on Devin's
"proceed with v4" ruling, no fourth audit round):
- Sol-1 (fixed-index sampling breaks when burst encodes fail) → FIXED: URL-based
  association (`representativeUrl` moved to burst[0]; null pixelQuality if the
  sampled encode failed); association tests inject encode failures before/at/
  after the midpoint.
- Sol-2 (server-only env gate + no bootstrap for standalone calibration) →
  FIXED: hooks gated on the CLIENT test-mode mechanism (page.tsx:24 precedent)
  with a hooks-absent-in-production check; calibration is a dedicated
  Playwright project run through scripts/run-e2e.mjs (server/auth/storage
  state provided), `npm run calibrate:check` wraps check mode.
- Sol-3 (drift gate absent from full gate/CI; relative tolerance unstable near
  zero) → FIXED: calibrate:check added to T5 gate + ci.yml e2e job; zero-safe
  tolerance `max(5% relative, ABS_EPS)`; overexposed fixture added to T4b's
  live browser matrix.
- Sol-NIT-4 (zero-dim rounding on extreme aspect) → FIXED: finite-positive
  validation + `Math.max(1, Math.round(...))` clamp + extreme-aspect test.
- Sol-NIT-5 + Gemini-NIT-1 (microtask still blocks paint; async ≠ free) →
  FIXED: macrotask yield (`setTimeout 0`) before scoring; work described as
  deferred/bounded; real-device perf verification remains a follow-up.
- Gemini-NIT-2 (hook reachability for Playwright) → NOTED for implementation:
  hooks mount on the capture page; the calibration project authenticates via
  the e2e storage state, so reaching Step 2 is scripted once in the setup spec.

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
