// One-shot fixture generator (phase-1 T1b). Loads the committed
// e2e/fixtures/photos/front_standing.jpg into a real Chromium tab (via
// Playwright) and produces three degraded variants, applied and encoded
// entirely in-browser so the pixel math matches what the production capture
// pipeline sees (canvas 2D, real JPEG encoder) rather than a node-side
// image library:
//   - front_standing_blurry.jpg      gaussian blur, sigma=3 (separable convolution)
//   - front_standing_dark.jpg        exposure x0.35 (uniform RGB multiply, clamped)
//   - front_standing_overexposed.jpg exposure x2.2 (uniform RGB multiply, clamped)
//
// Run once (`node scripts/generate-degraded-fixtures.mjs`) and commit the
// output — these are fixed, hand-picked degradations, not regenerated per run.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PHOTOS_DIR = path.join(__dirname, '..', 'e2e', 'fixtures', 'photos')
const SOURCE_FILE = 'front_standing.jpg'
const BLUR_SIGMA = 3
const DARK_FACTOR = 0.35
const OVEREXPOSED_FACTOR = 2.2
const JPEG_QUALITY = 0.92

// Runs entirely inside the page (Playwright serializes this function and
// calls it in-browser) — no access to outer node scope, so every helper it
// needs is declared inside.
async function degradeInBrowser({ dataUrl, sigma, darkFactor, brightFactor, quality }) {
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  // Separable gaussian blur (RGB only; alpha copied through) — two 1D passes
  // (horizontal then vertical), kernel radius = ceil(3*sigma), edges clamped.
  function gaussianBlur(imageData, sigmaVal) {
    const radius = Math.max(1, Math.ceil(sigmaVal * 3))
    const size = radius * 2 + 1
    const kernel = new Float64Array(size)
    let sum = 0
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigmaVal * sigmaVal))
      kernel[i + radius] = v
      sum += v
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum

    const { width, height, data: src } = imageData
    const tmp = new Float64Array(width * height * 3)
    const out = new Uint8ClampedArray(src.length)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.min(width - 1, Math.max(0, x + k))
          const si = (y * width + sx) * 4
          const w = kernel[k + radius]
          r += src[si] * w
          g += src[si + 1] * w
          b += src[si + 2] * w
        }
        const ti = (y * width + x) * 3
        tmp[ti] = r
        tmp[ti + 1] = g
        tmp[ti + 2] = b
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.min(height - 1, Math.max(0, y + k))
          const ti = (sy * width + x) * 3
          const w = kernel[k + radius]
          r += tmp[ti] * w
          g += tmp[ti + 1] * w
          b += tmp[ti + 2] * w
        }
        const oi = (y * width + x) * 4
        out[oi] = r
        out[oi + 1] = g
        out[oi + 2] = b
        out[oi + 3] = src[oi + 3]
      }
    }

    return new ImageData(out, width, height)
  }

  // Uniform RGB multiply, clamped to [0,255] by Uint8ClampedArray itself.
  function exposure(imageData, factor) {
    const { width, height, data: src } = imageData
    const out = new Uint8ClampedArray(src.length)
    for (let i = 0; i < src.length; i += 4) {
      out[i] = src[i] * factor
      out[i + 1] = src[i + 1] * factor
      out[i + 2] = src[i + 2] * factor
      out[i + 3] = src[i + 3]
    }
    return new ImageData(out, width, height)
  }

  function encode(imageData, q) {
    const c = document.createElement('canvas')
    c.width = imageData.width
    c.height = imageData.height
    const cctx = c.getContext('2d')
    cctx.putImageData(imageData, 0, 0)
    return c.toDataURL('image/jpeg', q)
  }

  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const original = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const blurred = gaussianBlur(original, sigma)
  const dark = exposure(original, darkFactor)
  const overexposed = exposure(original, brightFactor)

  return {
    blurry: encode(blurred, quality),
    dark: encode(dark, quality),
    overexposed: encode(overexposed, quality),
    width: canvas.width,
    height: canvas.height,
  }
}

async function main() {
  const sourcePath = path.join(PHOTOS_DIR, SOURCE_FILE)
  const sourceBuffer = readFileSync(sourcePath)
  const sourceDataUrl = `data:image/jpeg;base64,${sourceBuffer.toString('base64')}`

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()

    const results = await page.evaluate(degradeInBrowser, {
      dataUrl: sourceDataUrl,
      sigma: BLUR_SIGMA,
      darkFactor: DARK_FACTOR,
      brightFactor: OVEREXPOSED_FACTOR,
      quality: JPEG_QUALITY,
    })

    const stem = path.basename(SOURCE_FILE, path.extname(SOURCE_FILE))
    const outputs = {
      [`${stem}_blurry.jpg`]: results.blurry,
      [`${stem}_dark.jpg`]: results.dark,
      [`${stem}_overexposed.jpg`]: results.overexposed,
    }

    for (const [filename, dataUrl] of Object.entries(outputs)) {
      const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
      const outPath = path.join(PHOTOS_DIR, filename)
      writeFileSync(outPath, Buffer.from(base64, 'base64'))
      console.log(`wrote ${outPath} (${results.width}x${results.height})`)
    }
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
