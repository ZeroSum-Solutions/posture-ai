import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard, dismissCaptureDisclaimer } from './helpers'

// Uploads real standing-posture photos through the actual detectPose path
// (MediaPipe WASM in the browser) — no test mode. Chromium-only via project
// config; generous timeout for the one-time model download.
test.describe('real pose detection through the wizard', () => {
  test('upload front+side photos, detect landmarks, score assessment', async ({ page }) => {
    test.setTimeout(300_000)

    // Track requests to known CDN hosts — none should be made for MediaPipe assets
    const cdnRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('cdn.jsdelivr.net') || url.includes('storage.googleapis.com')) {
        cdnRequests.push(url)
      }
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Detect${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Detect${stamp}`)
    // Full-screen capture opens on the one-time disclaimer; dismiss to reach the
    // upload fallback (no camera in headless — the upload path still works).
    await dismissCaptureDisclaimer(page)

    const photos = path.join(__dirname, 'fixtures', 'photos')
    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })

    // Slot order matches the wizard's view order: front, side, back.
    await inputs.nth(0).setInputFiles(path.join(photos, 'front_standing.jpg'))
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))

    // Proceed once front+side are captured (label reads "Skip Back & Analyze Posture"
    // until the optional back view is added — matched here as a substring).
    await page.getByRole('button', { name: 'Analyze Posture' }).click()

    // detectPose runs per view at submit (model download + WASM init on first call).
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 240_000 })

    const findings = page.locator('[data-testid^="finding-card-"]')
    await expect(findings).toHaveCount(9, { timeout: 15_000 })

    // Assert that no MediaPipe assets were fetched from a CDN — they must be self-hosted
    expect(cdnRequests, `CDN requests found: ${cdnRequests.join(', ')}`).toHaveLength(0)
  })
})
