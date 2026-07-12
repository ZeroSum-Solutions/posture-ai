import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createClient, selectClientInWizard, dismissCaptureDisclaimer } from './helpers'

// Exercises the NEW full-screen camera-capture flow (shutter → review →
// auto-advance, self-timer, retake) that the upload/error specs don't cover.
// Chromium-only (fake MediaStream + MediaPipe WASM); mobile-webkit ignores it.

// A fake camera fed by an animated canvas — enough for the <video> to go live
// and for capture() to grab a frame. The drawn "figure" is not a real person,
// so MediaPipe reports no_person; that's fine for testing the UI mechanics
// (advancing does not require passing quality — only final submit does).
const FAKE_FIGURE_STREAM = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 960
  const ctx = canvas.getContext('2d')!
  function draw() {
    ctx.fillStyle = '#12202e'
    ctx.fillRect(0, 0, 720, 960)
    ctx.fillStyle = 'rgba(200,210,225,0.6)'
    ctx.beginPath(); ctx.arc(360, 210, 60, 0, Math.PI * 2); ctx.fill()
    ctx.fillRect(300, 280, 120, 320)
    requestAnimationFrame(draw)
  }
  draw()
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30)
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => stream, writable: true, configurable: true,
  })
}

test.describe('full-screen camera capture', () => {
  test('shutter, review, auto-advance, self-timer and retake work', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(FAKE_FIGURE_STREAM)

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `CamFlow${stamp}`)
    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E CamFlow${stamp}`)
    await dismissCaptureDisclaimer(page)

    // Opens on the Front slot with its directional prompt + a live shutter.
    await expect(page.getByText('Face the camera')).toBeVisible({ timeout: 10_000 })
    const shutter = page.getByRole('button', { name: 'Capture photo' })
    await expect(shutter).toBeVisible()

    // Self-timer: toggling it flips aria-pressed…
    const timer = page.getByRole('button', { name: 'Self-timer' })
    await timer.click()
    await expect(timer).toHaveAttribute('aria-pressed', 'true')

    // …and firing the shutter now runs the 3-2-1 countdown before capturing.
    await shutter.click()
    await expect(page.getByRole('button', { name: 'Use This Photo' })).toBeVisible({ timeout: 12_000 })

    // Committing the shot advances Front → Left Side (canonical slot order).
    await page.getByRole('button', { name: 'Use This Photo' }).click()
    await expect(page.getByText('Left side to the camera')).toBeVisible()
    await expect(page.getByRole('button', { name: /Front captured/ })).toBeVisible()

    // Instant capture (timer back off) on the Left Side → advances to Right Side.
    await timer.click()
    await expect(timer).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Capture photo' }).click()
    await expect(page.getByRole('button', { name: 'Use This Photo' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Use This Photo' }).click()
    await expect(page.getByText('Right side to the camera')).toBeVisible()

    // Capturing the Right Side advances to the optional Back slot.
    await page.getByRole('button', { name: 'Capture photo' }).click()
    await expect(page.getByRole('button', { name: 'Use This Photo' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Use This Photo' }).click()
    await expect(page.getByText('Turn around')).toBeVisible()

    // Free order: tapping any captured thumbnail re-arms that slot for a retake.
    await page.getByRole('button', { name: /Front captured/ }).click()
    await expect(page.getByText('Face the camera')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeVisible()
  })

  test('capturing Front + both sides via the camera scores an assessment', async ({ page }) => {
    test.setTimeout(300_000)
    await page.setViewportSize({ width: 390, height: 844 })

    // Draw the real posture fixtures into the fake stream so MediaPipe detects a
    // person — the camera path must reach scoring, not just the UI.
    const photos = path.join(__dirname, 'fixtures', 'photos')
    const toDataUrl = (f: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join(photos, f)).toString('base64')}`
    const frames = { front: toDataUrl('front_standing.jpg'), side: toDataUrl('side_standing.jpg') }

    await page.addInitScript((imgs: Record<string, string>) => {
      const loaded: Record<string, HTMLImageElement> = {}
      for (const [k, src] of Object.entries(imgs)) { const im = new Image(); im.src = src; loaded[k] = im }
      let current: HTMLImageElement | null = null
      ;(window as unknown as { __useFrame: (k: string) => void }).__useFrame = (k) => { current = loaded[k] }
      const canvas = document.createElement('canvas')
      canvas.width = 720
      canvas.height = 960
      const ctx = canvas.getContext('2d')!
      function draw() {
        ctx.fillStyle = '#111'
        ctx.fillRect(0, 0, 720, 960)
        if (current && current.complete && current.naturalWidth) {
          const s = Math.min(720 / current.naturalWidth, 960 / current.naturalHeight)
          const w = current.naturalWidth * s
          const h = current.naturalHeight * s
          ctx.drawImage(current, (720 - w) / 2, (960 - h) / 2, w, h)
        }
        requestAnimationFrame(draw)
      }
      draw()
      const stream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30)
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => stream, writable: true, configurable: true,
      })
    }, frames)

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `CamScore${stamp}`)
    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E CamScore${stamp}`)
    await dismissCaptureDisclaimer(page)

    // Capture the Front fixture through the shutter.
    await page.evaluate(() => (window as unknown as { __useFrame: (k: string) => void }).__useFrame('front'))
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(600) // let the frame propagate into the <video>
    await page.getByRole('button', { name: 'Capture photo' }).click()
    await page.getByRole('button', { name: 'Use This Photo' }).click()
    await expect(page.getByText('Left side to the camera')).toBeVisible()

    // Capture the Left Side (the side fixture stands in for both profiles).
    await page.evaluate(() => (window as unknown as { __useFrame: (k: string) => void }).__useFrame('side'))
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Capture photo' }).click()
    await page.getByRole('button', { name: 'Use This Photo' }).click()
    await expect(page.getByText('Right side to the camera')).toBeVisible()

    // Capture the Right Side.
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Capture photo' }).click()
    await page.getByRole('button', { name: 'Use This Photo' }).click()

    // Front + both sides captured → skip the optional Back and analyze.
    await page.getByRole('button', { name: 'Skip Back & Analyze Posture' }).click()

    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 240_000 })
    await expect(page.locator('[data-testid^="finding-card-"]')).toHaveCount(9, { timeout: 15_000 })
  })
})
