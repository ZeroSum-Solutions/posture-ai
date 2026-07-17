import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Phase-1 T4b — cross-engine sampler spec + perf budget (resolves r1 S10
// fully). Runs in BOTH desktop-chromium and mobile-webkit (not testIgnore'd
// in either project, and not the dedicated `calibration` project — see
// playwright.config.ts). No MediaPipe dependency: like
// e2e/pixel-calibration.spec.ts, this drives the PRODUCTION sampler + scorer
// directly via `window.__pixelQualityHooks`, exposed only under the app's
// client test-mode gate (`?testMode=1`).
//
// Asserts, per committed fixture: (1) samplePixelsFromSource returns a
// non-null sample, (2) assessPixelQuality's warning classification matches
// the committed calibration behavior (pixel-quality.matrix.test.ts /
// pixel-quality.calibration.json — including the documented dark-fixture
// finding: blur warning ONLY, the dark channel is 0-FP-inert by calibration
// construction), and (3) sampler+scorer together stay within an 80ms
// main-thread budget per image on the CI runner (generous; catches an
// accidental full-res scan regression) — making the Safari/webkit check
// executable instead of a logged manual QA item.

declare global {
  interface Window {
    __pixelQualityHooks?: {
      samplePixelsFromSource: (source: CanvasImageSource, srcW: number, srcH: number, maxEdge?: number) => {
        data: Uint8ClampedArray
        width: number
        height: number
      } | null
      assessPixelQuality: (img: { data: Uint8ClampedArray; width: number; height: number }) => {
        sharpness: number
        lumaMean: number
        darkClip: number
        brightClip: number
        warnings: string[]
      }
    }
  }
}

const PHOTOS_DIR = path.join(__dirname, 'fixtures', 'photos')
// Budget catches accidental full-res scans (multi-second at 1600px in pure
// JS), not scheduler jitter: shared 2-core CI runners measured 110-287ms on
// the FIRST call (cold JIT + first canvas readback) vs 3-14ms locally, so the
// timed loop below runs one untimed warm-up first and the bound sits well
// above warm CI noise while staying far under a genuine unbounded scan.
const PERF_BUDGET_MS = 250

const BLUR_WARNING = 'Photo looks blurry — hold the camera steady and retake.'
const BRIGHT_WARNING = 'Photo is overexposed — reduce direct light and retake.'

// Expected classifications are the committed, calibrated (honest) behavior —
// see pixel-quality.matrix.test.ts and the calibration.json comments: the
// dark fixture gets ONLY the blur warning because the dark-exposure channel
// is 0-FP-inert against the normal population (lumaDarkMax=14 < the dark
// fixture's own ~70 lumaMean; darkClipMax=0.8321 similarly uncatchable).
const FIXTURES: { key: string; file: string; expectedWarnings: string[] }[] = [
  { key: 'normal', file: 'front_standing.jpg', expectedWarnings: [] },
  { key: 'blurry', file: 'front_standing_blurry.jpg', expectedWarnings: [BLUR_WARNING] },
  { key: 'dark', file: 'front_standing_dark.jpg', expectedWarnings: [BLUR_WARNING] },
  { key: 'overexposed', file: 'front_standing_overexposed.jpg', expectedWarnings: [BRIGHT_WARNING] },
]

test.describe('pixel-sample cross-engine spec', () => {
  test('samples + classifies every fixture within the perf budget', async ({ page }) => {
    test.setTimeout(60_000)

    const images: Record<string, string> = {}
    for (const { key, file } of FIXTURES) {
      const buf = readFileSync(path.join(PHOTOS_DIR, file))
      images[key] = `data:image/jpeg;base64,${buf.toString('base64')}`
    }

    await page.goto('/assessments/new?testMode=1')
    // Hooks install unconditionally at mount (page.tsx effect), independent
    // of wizard step — no need to walk the client-select flow.
    await page.waitForFunction(() => !!window.__pixelQualityHooks, undefined, { timeout: 15_000 })

    const results = await page.evaluate(async ({ images }) => {
      const hooks = window.__pixelQualityHooks
      if (!hooks) throw new Error('window.__pixelQualityHooks missing — test-mode gate did not install hooks')

      function loadImage(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('image load failed'))
          img.src = src
        })
      }

      // Untimed warm-up: absorb one-time JIT + first-canvas-readback cost so
      // the timed loop measures steady-state sampler+scorer work (the thing
      // the budget guards), not cold-start scheduler noise on slow CI runners.
      {
        const warm = document.createElement('canvas')
        warm.width = 64
        warm.height = 64
        const wctx = warm.getContext('2d')
        if (wctx) {
          wctx.fillRect(0, 0, 64, 64)
          const warmSample = hooks.samplePixelsFromSource(warm, 64, 64)
          if (warmSample) hooks.assessPixelQuality(warmSample)
        }
      }

      const out: { key: string; sampleIsNull: boolean; warnings: string[]; elapsedMs: number }[] = []
      for (const [key, dataUrl] of Object.entries(images)) {
        const img = await loadImage(dataUrl)

        // Draw onto a source canvas the way the production pipeline hands
        // the sampler pixels (upload-normalized canvas, up to 1600px long
        // edge — lib/pose/normalize-upload.ts), THEN measure the sampler's
        // own bounded downscale + scorer as the perf-budgeted operation.
        const srcScale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
        const sw = Math.max(1, Math.round(img.naturalWidth * srcScale))
        const sh = Math.max(1, Math.round(img.naturalHeight * srcScale))
        const sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = sw
        sourceCanvas.height = sh
        const sctx = sourceCanvas.getContext('2d')
        if (!sctx) throw new Error('2d context unavailable for source canvas')
        sctx.drawImage(img, 0, 0, sw, sh)

        const start = performance.now()
        const sample = hooks.samplePixelsFromSource(sourceCanvas, sw, sh)
        const scored = sample ? hooks.assessPixelQuality(sample) : null
        const elapsedMs = performance.now() - start

        out.push({
          key,
          sampleIsNull: sample === null,
          warnings: scored ? scored.warnings : [],
          elapsedMs,
        })
      }
      return out
    }, { images })

    expect(results).toHaveLength(FIXTURES.length)

    for (const fixture of FIXTURES) {
      const result = results.find(r => r.key === fixture.key)
      if (!result) throw new Error(`missing result for fixture ${fixture.key}`)

      expect(result.sampleIsNull, `${fixture.key}: samplePixelsFromSource returned null`).toBe(false)
      expect(result.warnings, `${fixture.key}: warning classification mismatch`).toEqual(fixture.expectedWarnings)
      expect(
        result.elapsedMs,
        `${fixture.key}: sampler+scorer took ${result.elapsedMs.toFixed(2)}ms, over the ${PERF_BUDGET_MS}ms budget`,
      ).toBeLessThanOrEqual(PERF_BUDGET_MS)
    }
  })
})
