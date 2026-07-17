import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// Phase-1 T1b — browser-lane calibration. Runs as its own Playwright project
// (`calibration` in playwright.config.ts) through the standard e2e bootstrap
// (scripts/run-e2e.mjs — server, local Supabase, auth storage state), because
// `/assessments/new` sits behind the auth proxy and only that bootstrap
// provides it. The PRODUCTION sampler + scorer are driven via
// `window.__pixelQualityHooks`, exposed only under the app's client test-mode
// gate (`?testMode=1`, see app/assessments/new/page.tsx + pixel-quality-test-hooks.ts)
// — never a re-implementation of the algorithm here.
//
// Write mode (default): derives thresholds from the committed fixtures and
// writes lib/capture/pixel-quality.calibration.json.
// Check mode (`CALIBRATION_CHECK=1`, wired as `npm run calibrate:check`):
// recomputes the same pipeline and FAILS on drift beyond a zero-safe
// tolerance instead of writing — see ABS_EPS below.

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
const CALIBRATION_PATH = path.join(__dirname, '..', 'lib', 'capture', 'pixel-quality.calibration.json')

// ALL committed normal fixtures are normals (post-T4 amendment: calibrating
// against front only left side/back — which e2e uses as valid uploads — able
// to false-positive, violating the PRD's 0-FP-on-normals bias). Degraded
// variants stay front-derived.
const FIXTURES = {
  normal_front: 'front_standing.jpg',
  normal_side: 'side_standing.jpg',
  normal_back: 'back_standing.jpg',
  blurry: 'front_standing_blurry.jpg',
  dark: 'front_standing_dark.jpg',
  overexposed: 'front_standing_overexposed.jpg',
} as const
type FixtureKey = keyof typeof FIXTURES
const NORMAL_KEYS = ['normal_front', 'normal_side', 'normal_back'] as const

// scale candidates + the two source sizes the production pipeline hands the
// sampler (camera shutter canvas ~720p-ish, upload-normalized canvas up to
// ~1600px long edge) — spec §"Core design".
const CANDIDATE_SCALES = [160, 320, 480] as const
const SOURCE_SIZES = [720, 1600] as const // [camera-like, upload-like]
const SHARPNESS_MARGIN = 2 // sharp/blurred pair must separate by >= this at the chosen scale, at BOTH source sizes

const CHECK_MODE = process.env.CALIBRATION_CHECK === '1'
// Zero-safe drift tolerance (r3 Sol-3): relative-only tolerance is unstable for
// metrics that sit at/near 0 (darkClip/brightClip on clean fixtures), so every
// metric is compared against max(5% relative, ABS_EPS). ABS_EPS=0.005 is well
// below the smallest calibrated signal we rely on (clip fractions, luma units)
// but well above JPEG-encode / anti-aliasing jitter between runs.
const ABS_EPS = 0.005

interface Metrics {
  sharpness: number
  lumaMean: number
  darkClip: number
  brightClip: number
}
// matrix[sourceSize][fixture][scale]
type Matrix = Record<number, Record<FixtureKey, Record<number, Metrics>>>

interface Thresholds {
  sharpnessMin: number
  lumaDarkMax: number
  lumaBrightMin: number
  darkClipMax: number
  brightClipMax: number
}

// Rounds to 4 significant digits (spec §T1b: "4-significant-digit rounding").
function round4(n: number): number {
  if (n === 0 || !Number.isFinite(n)) return 0
  const power = 4 - Math.ceil(Math.log10(Math.abs(n)))
  const magnitude = Math.pow(10, power)
  return Math.round(n * magnitude) / magnitude
}

// Threshold where LOWER values trigger the warning (sharpness, luma-dark),
// with the PRD's 0-FP-on-normals bias as the BINDING constraint. When the
// populations separate, take the midpoint. When they do NOT separate — the
// degraded fixture reads higher than the worst normal, so any threshold that
// catches it would false-positive on a normal — set the threshold at half the
// normal minimum (0 FPs by construction, degraded honestly uncaught) and log
// it loudly. Post-T4 reality: side/back normals are natively darker
// (lumaMean ~45/~28) than the x0.35-degraded front fixture (~70), so the
// luma-dark channel lands in this fallback by necessity, not by bug.
function chooseLowerBoundThreshold(normalValues: number[], degradedValues: number[], label: string): number {
  const normalMin = Math.min(...normalValues)
  const degradedMax = Math.max(...degradedValues)
  if (degradedMax < normalMin) return (normalMin + degradedMax) / 2
  const fallback = normalMin / 2
  console.warn(
    `[calibration] ${label}: NOT separable (degraded max ${degradedMax} >= normal min ${normalMin}) — ` +
      `0-FP fallback threshold ${fallback}; the degraded fixture is NOT caught via this channel`,
  )
  return fallback
}

// Threshold where HIGHER values trigger the warning (luma-bright): mirror of
// chooseLowerBoundThreshold. All current populations separate; the throw
// stays because no committed fixture exercises the fallback direction.
function chooseUpperBoundThreshold(normalValues: number[], degradedValues: number[], label: string): number {
  const normalMax = Math.max(...normalValues)
  const degradedMin = Math.min(...degradedValues)
  if (degradedMin <= normalMax) {
    throw new Error(`${label}: cannot separate — degraded min ${degradedMin} <= normal max ${normalMax}`)
  }
  return (normalMax + degradedMin) / 2
}

// Clip-fraction thresholds (darkClipMax/brightClipMax) are a secondary OR
// signal (pixel-quality.ts: "a large clipped fraction with a normal mean").
// The degraded fixtures are uniform global exposure shifts, not localized
// clipping, so the target fixture's own clip fraction is a weak calibration
// point — the primary signal is lumaMean. 0 FPs on normals is the hard bar:
// when the target's clip fraction clears every non-target with room, take the
// midpoint (floored at a 0.05 backstop); when it does not — back_standing's
// dark background alone dark-clips ~66% of the frame, far beyond the darkened
// fixture's ~0.3% — place the threshold at the midpoint between the largest
// non-target value and 1.0, which cannot false-positive and honestly leaves
// the channel inert for the degraded fixture.
function deriveClipThreshold(nonTargetValues: number[], targetValues: number[], label: string): number {
  const nonTargetMax = Math.max(0, ...nonTargetValues)
  const targetMin = Math.min(...targetValues)
  if (targetMin > nonTargetMax) {
    return Math.max((nonTargetMax + targetMin) / 2, 0.05)
  }
  const fallback = (nonTargetMax + 1) / 2
  console.warn(
    `[calibration] ${label}: NOT separable (target min ${targetMin} <= non-target max ${nonTargetMax}) — ` +
      `0-FP fallback threshold ${fallback}; the degraded fixture is NOT caught via this channel`,
  )
  return fallback
}

function assertWithinTolerance(label: string, committed: number, fresh: number) {
  const tolerance = Math.max(0.05 * Math.abs(committed), ABS_EPS)
  const diff = Math.abs(fresh - committed)
  expect(diff, `${label}: committed=${committed} fresh=${fresh} diff=${diff} tolerance=${tolerance}`).toBeLessThanOrEqual(tolerance)
}

test.describe('pixel-quality calibration', () => {
  test(
    CHECK_MODE ? 'recomputes from committed fixtures and fails on drift' : 'derives thresholds from committed fixtures and writes calibration.json',
    async ({ page }) => {
      test.setTimeout(120_000)

      const images: Record<FixtureKey, string> = {} as Record<FixtureKey, string>
      for (const key of Object.keys(FIXTURES) as FixtureKey[]) {
        const buf = readFileSync(path.join(PHOTOS_DIR, FIXTURES[key]))
        images[key] = `data:image/jpeg;base64,${buf.toString('base64')}`
      }

      await page.goto('/assessments/new?testMode=1')
      // The hooks-install effect runs unconditionally at mount (page.tsx),
      // independent of wizard step — no need to walk the client-select flow.
      await page.waitForFunction(() => !!window.__pixelQualityHooks, undefined, { timeout: 15_000 })

      const matrix: Matrix = await page.evaluate(
        async ({ images, scales, sourceSizes }) => {
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

          const loaded: Record<string, HTMLImageElement> = {}
          for (const [key, dataUrl] of Object.entries(images)) {
            loaded[key] = await loadImage(dataUrl)
          }

          const result: Record<number, Record<string, Record<number, Metrics>>> = {}
          for (const sourceSize of sourceSizes) {
            result[sourceSize] = {}
            for (const [key, img] of Object.entries(loaded)) {
              // Two-stage draw, matching production: first the acquisition
              // canvas at the source-pipeline's resolution (camera shutter
              // frame / upload-normalized canvas), THEN the sampler's own
              // bounded downscale to the calibration scale under test.
              const srcScale = Math.min(1, sourceSize / Math.max(img.naturalWidth, img.naturalHeight))
              const sw = Math.max(1, Math.round(img.naturalWidth * srcScale))
              const sh = Math.max(1, Math.round(img.naturalHeight * srcScale))
              const sourceCanvas = document.createElement('canvas')
              sourceCanvas.width = sw
              sourceCanvas.height = sh
              const sctx = sourceCanvas.getContext('2d')
              if (!sctx) throw new Error('2d context unavailable for source canvas')
              sctx.drawImage(img, 0, 0, sw, sh)

              result[sourceSize][key] = {}
              for (const scale of scales) {
                const sample = hooks.samplePixelsFromSource(sourceCanvas, sw, sh, scale)
                if (!sample) throw new Error(`samplePixelsFromSource returned null for ${key} @ source=${sourceSize} scale=${scale}`)
                const scored = hooks.assessPixelQuality(sample)
                result[sourceSize][key][scale] = {
                  sharpness: scored.sharpness,
                  lumaMean: scored.lumaMean,
                  darkClip: scored.darkClip,
                  brightClip: scored.brightClip,
                }
              }
            }
          }
          return result
        },
        { images, scales: CANDIDATE_SCALES, sourceSizes: SOURCE_SIZES },
      )

      // ---- Scale selection: smallest candidate where EVERY normal/blurry
      // pair separates by >= SHARPNESS_MARGIN at BOTH source sizes (spec
      // §T1b). If no candidate reaches the margin, fall back to the scale
      // with the best worst-pair margin, derive anyway, and report the
      // achieved margin honestly rather than forcing it. ----
      const worstMarginAt = (scale: number): number => {
        let worst = Infinity
        for (const sourceSize of SOURCE_SIZES) {
          const blurrySharp = matrix[sourceSize].blurry[scale].sharpness
          if (blurrySharp <= 0) return 0
          for (const normalKey of NORMAL_KEYS) {
            worst = Math.min(worst, matrix[sourceSize][normalKey][scale].sharpness / blurrySharp)
          }
        }
        return worst
      }
      let chosenScale: number = CANDIDATE_SCALES[0]
      let achievedMargin = -Infinity
      let marginMet = false
      for (const scale of CANDIDATE_SCALES) {
        const margin = worstMarginAt(scale)
        if (margin >= SHARPNESS_MARGIN) {
          chosenScale = scale
          achievedMargin = margin
          marginMet = true
          break
        }
        if (margin > achievedMargin) {
          chosenScale = scale
          achievedMargin = margin
        }
      }
      if (!marginMet) {
        console.warn(
          `[calibration] no candidate scale reaches the ${SHARPNESS_MARGIN}x worst-pair margin; ` +
            `using best-margin scale ${chosenScale} (worst pair ${achievedMargin.toFixed(2)}x)`,
        )
      }
      console.log(`[calibration] scale ${chosenScale}: worst normal/blurry margin ${achievedMargin.toFixed(2)}x (required ${SHARPNESS_MARGIN}x, met=${marginMet})`)

      // ---- Threshold derivation at the chosen scale, aggregated across both
      // source sizes AND the whole normal population (front + side + back) —
      // conservative worst-case bound in each direction. ----
      const at = (fixture: FixtureKey, metric: keyof Metrics): number[] =>
        SOURCE_SIZES.map(sourceSize => matrix[sourceSize][fixture][chosenScale][metric])
      const atNormals = (metric: keyof Metrics): number[] => NORMAL_KEYS.flatMap(key => at(key, metric))

      const thresholds: Thresholds = {
        sharpnessMin: chooseLowerBoundThreshold(atNormals('sharpness'), at('blurry', 'sharpness'), 'sharpnessMin'),
        lumaDarkMax: chooseLowerBoundThreshold(atNormals('lumaMean'), at('dark', 'lumaMean'), 'lumaDarkMax'),
        lumaBrightMin: chooseUpperBoundThreshold(atNormals('lumaMean'), at('overexposed', 'lumaMean'), 'lumaBrightMin'),
        darkClipMax: deriveClipThreshold(
          [...atNormals('darkClip'), ...at('blurry', 'darkClip'), ...at('overexposed', 'darkClip')],
          at('dark', 'darkClip'),
          'darkClipMax',
        ),
        brightClipMax: deriveClipThreshold(
          [...atNormals('brightClip'), ...at('blurry', 'brightClip'), ...at('dark', 'brightClip')],
          at('overexposed', 'brightClip'),
          'brightClipMax',
        ),
      }
      const roundedThresholds: Thresholds = {
        sharpnessMin: round4(thresholds.sharpnessMin),
        lumaDarkMax: round4(thresholds.lumaDarkMax),
        lumaBrightMin: round4(thresholds.lumaBrightMin),
        darkClipMax: round4(thresholds.darkClipMax),
        brightClipMax: round4(thresholds.brightClipMax),
      }

      const perFixture: Record<FixtureKey, { camera: Metrics; upload: Metrics }> = {} as Record<FixtureKey, { camera: Metrics; upload: Metrics }>
      for (const key of Object.keys(FIXTURES) as FixtureKey[]) {
        const camera = matrix[720][key][chosenScale]
        const upload = matrix[1600][key][chosenScale]
        perFixture[key] = {
          camera: { sharpness: round4(camera.sharpness), lumaMean: round4(camera.lumaMean), darkClip: round4(camera.darkClip), brightClip: round4(camera.brightClip) },
          upload: { sharpness: round4(upload.sharpness), lumaMean: round4(upload.lumaMean), darkClip: round4(upload.darkClip), brightClip: round4(upload.brightClip) },
        }
      }

      const fresh = { scale: chosenScale, thresholds: roundedThresholds, perFixture }

      if (CHECK_MODE) {
        if (!existsSync(CALIBRATION_PATH)) {
          throw new Error(`calibrate:check requires a committed calibration file at ${CALIBRATION_PATH}`)
        }
        const committed = JSON.parse(readFileSync(CALIBRATION_PATH, 'utf8')) as typeof fresh

        expect(fresh.scale, `calibrated scale drifted: committed=${committed.scale} fresh=${fresh.scale}`).toBe(committed.scale)

        // Drift gate on the separation margin itself: a browser upgrade that
        // erodes the 2x normal/blurry sharpness margin must fail CI, not just log.
        expect(marginMet, `normal/blurry sharpness margin fell below ${SHARPNESS_MARGIN}x (achieved ${achievedMargin.toFixed(2)}x)`).toBe(true)

        for (const key of Object.keys(roundedThresholds) as (keyof Thresholds)[]) {
          assertWithinTolerance(`thresholds.${key}`, committed.thresholds[key], fresh.thresholds[key])
        }

        for (const fixtureKey of Object.keys(FIXTURES) as FixtureKey[]) {
          for (const sourceLabel of ['camera', 'upload'] as const) {
            for (const metric of ['sharpness', 'lumaMean', 'darkClip', 'brightClip'] as const) {
              assertWithinTolerance(
                `perFixture.${fixtureKey}.${sourceLabel}.${metric}`,
                committed.perFixture[fixtureKey][sourceLabel][metric],
                fresh.perFixture[fixtureKey][sourceLabel][metric],
              )
            }
          }
        }
      } else {
        // Write mode is intentionally assertion-free: it is a generator, not a
        // gate — separation/derivation preconditions already threw above, and
        // the gates are calibrate:check + pixel-quality.matrix.test.ts.
        writeFileSync(CALIBRATION_PATH, JSON.stringify(fresh, null, 2) + '\n')
        console.log('[calibration] wrote', CALIBRATION_PATH)
        console.log('[calibration] scale =', fresh.scale)
        console.log('[calibration] thresholds =', JSON.stringify(fresh.thresholds))
      }
    },
  )
})
