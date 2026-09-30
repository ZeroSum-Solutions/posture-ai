import { test, expect } from '@playwright/test'
import path from 'node:path'
import { countEvidenceFindings, createClient, selectClientInWizard, dismissCaptureDisclaimer, setCaptureUpload } from './helpers'

// Uploads real standing-posture photos through the actual detectPose path
// (MediaPipe WASM in the browser) — no test mode. Chromium-only via project
// config; generous timeout for the one-time model download.
test.describe('real pose detection through the wizard', () => {
  test('upload all four required photos, detect landmarks, score assessment', async ({ page }) => {
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

    // Slot order matches the wizard's four free-order slots: front, side-left,
    // side-right, back. The single side fixture stands in for both profiles.
    await setCaptureUpload(page, 0, path.join(photos, 'front_standing.jpg'))
    await setCaptureUpload(page, 1, path.join(photos, 'side_standing.jpg'))
    await setCaptureUpload(page, 2, path.join(photos, 'side_standing.jpg'))
    await setCaptureUpload(page, 3, path.join(photos, 'back_standing.jpg'))

    // Proceed once all four required views pass preflight.
    await page.getByRole('button', { name: 'Analyze Posture' }).click()

    // detectPose runs per view at submit (model download + WASM init on first call).
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 240_000 })

    // The clinical results page lists findings under their capture view in
    // Evidence (not AssessmentOnlyResults); count them across every view, same
    // as assessment-flow.spec.ts / capture-camera.spec.ts.
    // Nine findings are persisted, but the engine caps pelvic axial rotation's
    // confidence below the reliability floor (posture-engine metrics.ts), and
    // the results page lists only numeric screening readings (see
    // assessment-flow.spec.ts), so eight rows render.
    await expect.poll(() => countEvidenceFindings(page), { timeout: 15_000 }).toBe(8)

    // Assert that no MediaPipe assets were fetched from a CDN — they must be self-hosted
    expect(cdnRequests, `CDN requests found: ${cdnRequests.join(', ')}`).toHaveLength(0)
  })
})
