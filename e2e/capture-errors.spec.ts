import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard, dismissCaptureDisclaimer } from './helpers'

// Camera error handling and no-person-detection flows in the full-screen capture.
// Desktop-Chromium only — camera permission APIs and MediaPipe WASM tests
// are consistent there. The playwright.config.ts mobile-webkit project
// ignores this file (testIgnore pattern).

test.describe('camera error handling and quality preflight', () => {
  test('camera permission denied shows specific copy and upload fallback', async ({ browser }) => {
    // Create a context without camera permissions
    const context = await browser.newContext()
    const page = await context.newPage()

    // Override getUserMedia to immediately reject with NotAllowedError
    // so this test runs without OS permission dialogs
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

    const errorMsg = page.getByTestId('camera-error-msg')
    await expect(errorMsg).toBeVisible({ timeout: 10_000 })
    await expect(errorMsg).toContainText('Camera access denied')

    // The upload fallback stays available (button + the hidden per-view inputs).
    await expect(page.getByRole('button', { name: 'Use File Upload Instead' })).toBeVisible()
    await expect(page.locator('input[type="file"]').first()).toBeAttached()

    await context.close()
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

    // Upload the no-person fixture to the front view slot (index 0)
    await inputs.nth(0).setInputFiles(nopersonPhoto)

    // Wait for the preflight to complete — the no-person banner appears
    // (MediaPipe WASM detects no person in a plain gray image)
    const noPersonBadge = page.getByText('No person detected — retake')
    await expect(noPersonBadge).toBeVisible({ timeout: 90_000 })

    // Also upload a valid side view photo so the only blocker is the front slot
    // (Otherwise submit will fail with "Side view required" before checking no_person)
    const photos = path.join(__dirname, 'fixtures', 'photos')
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))

    // Wait for side slot preflight (it may complete as ok or warnings — not no_person)
    await expect(page.locator('text=No person detected — retake')).toHaveCount(1, { timeout: 90_000 })

    // Now try to submit — the front slot (no_person) blocks it
    await page.getByRole('button', { name: 'Analyze Posture' }).click()

    // Should see the upload error about retaking
    const errorBanner = page.getByText(/person detected|retake/i).first()
    await expect(errorBanner).toBeVisible({ timeout: 5_000 })

    // Still on the capture screen — not redirected to processing
    await expect(page.getByTestId('fullscreen-capture')).toBeVisible()
  })
})
