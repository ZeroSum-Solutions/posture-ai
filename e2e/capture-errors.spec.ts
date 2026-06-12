import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard } from './helpers'

// Camera error handling and no-person-detection flows.
// Desktop-Chromium only — camera permission APIs are consistent there.

test.describe('camera error handling and quality preflight', () => {
  test('camera permission denied shows specific copy and upload fallback', async ({ browser }) => {
    // Create a context with camera permission denied
    const context = await browser.newContext({
      permissions: [], // deny camera
    })
    const page = await context.newPage()

    // Inject a getUserMedia override that rejects with NotAllowedError,
    // so the test is not dependent on OS-level permission dialogs.
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async function () {
          const err = new DOMException('Permission denied', 'NotAllowedError')
          throw err
        },
        writable: true,
        configurable: true,
      })
      void original // suppress unused-var lint
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Cam${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Cam${stamp}`)

    // Click "Use Camera" on the Front View slot
    const useCameraBtn = page.getByRole('button', { name: 'Use Camera' }).first()
    await expect(useCameraBtn).toBeVisible({ timeout: 10_000 })
    await useCameraBtn.click()

    // The camera modal opens; getUserMedia fires and rejects with NotAllowedError
    const errorMsg = page.getByTestId('camera-error-msg')
    await expect(errorMsg).toBeVisible({ timeout: 10_000 })
    await expect(errorMsg).toContainText('Camera access denied')

    // The "Use File Upload Instead" button is present and functional
    const uploadBtn = page.getByRole('button', { name: 'Use File Upload Instead' })
    await expect(uploadBtn).toBeVisible()
    await uploadBtn.click()

    // Modal closes; user is back on the upload step
    await expect(page.getByRole('button', { name: 'Use Camera' }).first()).toBeVisible()

    await context.close()
  })

  test('uploading a non-person image shows no-person state and blocks submit', async ({ page }) => {
    test.setTimeout(120_000)

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `NoPerson${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E NoPerson${stamp}`)

    const nopersonPhoto = path.join(__dirname, 'fixtures', 'photos', 'no-person.jpg')
    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })

    // Upload the no-person fixture to the front view slot
    await inputs.nth(0).setInputFiles(nopersonPhoto)

    // Wait for the preflight to complete — the slot should show the no_person badge
    const noPesonBadge = page.getByText('No person detected — retake')
    await expect(noPesonBadge).toBeVisible({ timeout: 60_000 })

    // Attempting to submit while a required slot has no_person should be blocked
    // (submit triggers validation that catches no_person required slots)
    // First add a side view so front is the only blocker
    // (submit will catch it before even calling API)
    const analyzeBtn = page.getByRole('button', { name: 'Analyze Posture' })
    await analyzeBtn.click()

    // Should see the upload error (slot is blocked, not an API error)
    const errorBanner = page.locator('[style*="EF4444"]').filter({ hasText: /person|retake/i }).first()
    await expect(errorBanner).toBeVisible({ timeout: 5_000 })

    // Still on step 2 — not redirected to step 3
    await expect(page.getByRole('heading', { name: 'Step 2: Upload Posture Views' })).toBeVisible()
  })
})
