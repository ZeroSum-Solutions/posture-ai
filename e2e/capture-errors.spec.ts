import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard, dismissCaptureDisclaimer } from './helpers'

// Camera error handling and no-person-detection flows in the full-screen capture.
// Desktop-Chromium only — camera permission APIs and MediaPipe WASM tests
// are consistent there. The playwright.config.ts mobile-webkit project
// ignores this file (testIgnore pattern).

test.describe('camera error handling and quality preflight', () => {
  test('camera permission denied shows copy, upload fallback, and advances on upload', async ({ page }) => {
    // Override getUserMedia to immediately reject with NotAllowedError so this
    // runs without OS permission dialogs. Uses the authenticated page fixture so
    // createClient's API call carries the practitioner session.
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async function () {
          throw new DOMException('Permission denied', 'NotAllowedError')
        },
        writable: true,
        configurable: true,
      })
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Cam${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Cam${stamp}`)

    // Dismissing the disclaimer auto-starts the camera; getUserMedia rejects
    // with NotAllowedError → the capture screen surfaces the error inline.
    await dismissCaptureDisclaimer(page)

    await expect(page.getByRole('navigation', { name: 'Application navigation' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel and return to client selection' })).toBeVisible()

    const errorMsg = page.getByTestId('camera-error-msg')
    await expect(errorMsg).toBeVisible({ timeout: 10_000 })
    await expect(errorMsg).toContainText('Camera access denied')

    // The upload fallback is available for the Front slot…
    await expect(page.getByRole('button', { name: /Use File Upload Instead — Front/ })).toBeVisible()
    await expect(page.locator('input[type="file"]').first()).toBeAttached()

    // …and uploading Front advances the fallback to the Left Side slot, so the
    // upload-only path walks through the required slots instead of dead-ending.
    await page.locator('input[type="file"]').nth(0)
      .setInputFiles(path.join(__dirname, 'fixtures', 'photos', 'front_standing.jpg'))
    await expect(page.getByRole('button', { name: /Use File Upload Instead — Left Side/ })).toBeVisible({ timeout: 10_000 })
  })

  test('camera works without orientation sensors: no gate, no indicator', async ({ page }) => {
    // Fake getUserMedia so the camera opens without OS dialogs.
    // DeviceOrientationEvent fires no events in desktop Chromium → the
    // useCameraLevel hook degrades to 'unsupported' → roll stays null.
    await page.addInitScript(() => {
      // Minimal fake MediaStream: a canvas capture track is enough for the
      // video element to enter the live phase without a real camera.
      const canvas = document.createElement('canvas')
      canvas.width = 2
      canvas.height = 2
      const fakeStream: MediaStream = (canvas as HTMLCanvasElement & { captureStream(): MediaStream }).captureStream()
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => fakeStream,
        writable: true,
        configurable: true,
      })
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Level${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Level${stamp}`)
    await dismissCaptureDisclaimer(page)

    // Camera goes live with the fake stream; the shutter is present and enabled.
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled({ timeout: 10_000 })

    // Desktop Chromium fires no DeviceOrientation events → roll stays null →
    // level-indicator is never rendered, and tilt-blocked cannot appear.
    await expect(page.locator('[data-testid="level-indicator"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="tilt-blocked"]')).toHaveCount(0)
  })

  test('uploading a non-person image shows no-person state and blocks submit', async ({ page }) => {
    test.setTimeout(120_000)

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `NoPerson${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E NoPerson${stamp}`)
    // Dismiss the disclaimer so the capture controls (no-person banner + submit)
    // render. No camera in headless — the per-view upload inputs still work.
    await dismissCaptureDisclaimer(page)

    const nopersonPhoto = path.join(__dirname, 'fixtures', 'photos', 'no-person.png')
    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })

    // Upload the no-person fixture to the front slot (index 0)
    await inputs.nth(0).setInputFiles(nopersonPhoto)

    // Wait for the preflight to complete — the no-person banner appears
    // (MediaPipe WASM detects no person in a plain gray image)
    const noPersonBadge = page.getByText('No person detected — retake')
    await expect(noPersonBadge).toBeVisible({ timeout: 90_000 })

    // Fill BOTH side slots (indices 1 = left, 2 = right) with a valid photo so the
    // required slots are all present and the Analyze action gates only on the
    // front slot's no_person (otherwise it blocks earlier on a missing required slot).
    const photos = path.join(__dirname, 'fixtures', 'photos')
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))
    await inputs.nth(2).setInputFiles(path.join(photos, 'side_standing.jpg'))

    // Only the front slot stays no_person (the sides complete as ok or warnings)
    await expect(page.locator('text=No person detected — retake')).toHaveCount(1, { timeout: 90_000 })

    // Now try to submit — the front slot (no_person) blocks it. Back is optional
    // and uncaptured, so the action reads "Skip Back & Analyze Posture".
    await page.getByRole('button', { name: 'Skip Back & Analyze Posture' }).click()

    // Should see the upload error about retaking
    const errorBanner = page.getByText(/person detected|retake/i).first()
    await expect(errorBanner).toBeVisible({ timeout: 5_000 })

    // Still on the capture screen — not redirected to processing
    await expect(page.getByTestId('fullscreen-capture')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Application navigation' })).not.toBeVisible()
  })

  test('uploading a blurry photo shows a quality warning and does not block submit', async ({ page }) => {
    test.setTimeout(120_000)

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Blur${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Blur${stamp}`)
    await dismissCaptureDisclaimer(page)

    const photos = path.join(__dirname, 'fixtures', 'photos')
    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })

    // Front gets the degraded (blurry) fixture; both side slots get the normal
    // side fixture used elsewhere in this file as a valid, person-detected photo.
    await inputs.nth(0).setInputFiles(path.join(photos, 'front_standing_blurry.jpg'))
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))
    await inputs.nth(2).setInputFiles(path.join(photos, 'side_standing.jpg'))

    // Wait for all three preflights to settle: the Front tile's accessible name
    // gains the "— quality warning" suffix (page.tsx runPreflight → slotStatus
    // 'warnings' → FullScreenCapture.tsx:875) once MediaPipe + the pixel-quality
    // merge finish for that slot. Real detector + real scorer, so give it the
    // same generous budget as the no-person precedent above.
    const frontTile = page.getByRole('button', { name: /Front.*quality warning/ })
    await expect(frontTile).toBeVisible({ timeout: 90_000 })

    // (a) An amber quality-warning indicator is visible on the Front slot tile —
    // the ring/badge driven by slotStatus === 'warnings' (FullScreenCapture.tsx:866,
    // 890). NOTE: the literal warning copy ("Photo looks blurry — hold the camera
    // steady and retake.") only renders in the camera-capture review card
    // (phase === 'review', FullScreenCapture.tsx:839-845 / previewQuality) — T3
    // scoped that card to the shutter flow. The upload path (used here, matching
    // this file's upload-only precedent) commits immediately without ever
    // entering 'review', so no per-photo warning text is rendered anywhere in the
    // DOM for uploads; the tile's amber ring + badge + this aria-label suffix are
    // the only visible signal. Confirmed empirically before writing this test.
    await expect(frontTile).toHaveAttribute('aria-label', /quality warning/)

    // (b) The blurry fixture still has a detectable person — MediaPipe does not
    // fall back to "no person detected" on it (verified empirically: sigma=3
    // gaussian blur keeps enough structure for landmark detection).
    await expect(page.getByText('No person detected — retake')).toHaveCount(0)

    // (c) Warnings are soft — submit is not blocked. Back is optional and
    // uncaptured, so the action reads "Skip Back & Analyze Posture".
    await page.getByRole('button', { name: 'Skip Back & Analyze Posture' }).click()

    // The capture overlay disappears and processing begins (Step 3).
    await expect(page.getByTestId('fullscreen-capture')).not.toBeVisible()
    await expect(page.getByText('Analyzing Posture...')).toBeVisible({ timeout: 10_000 })
  })
})
