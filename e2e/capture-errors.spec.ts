import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard } from './helpers'

// Camera error handling and no-person-detection flows.
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

    const nopersonPhoto = path.join(__dirname, 'fixtures', 'photos', 'no-person.png')
    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })

    // Upload the no-person fixture to the front view slot
    await inputs.nth(0).setInputFiles(nopersonPhoto)

    // Wait for the preflight to complete — the slot should show the no_person badge
    // (MediaPipe WASM detects no person in a plain gray image)
    const noPesonBadge = page.getByText('No person detected — retake')
    await expect(noPesonBadge).toBeVisible({ timeout: 90_000 })

    // Also upload a valid side view photo so the only blocker is the front slot
    // (Otherwise submit will fail with "Side view required" before checking no_person)
    const photos = path.join(__dirname, 'fixtures', 'photos')
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))

    // Wait for side slot preflight (it may complete as ok or warnings — not no_person)
    await expect(page.locator('text=No person detected — retake')).toHaveCount(1, { timeout: 90_000 })

    // Now try to submit — the front slot (no_person) blocks it
    const analyzeBtn = page.getByRole('button', { name: 'Analyze Posture' })
    await analyzeBtn.click()

    // Should see the upload error about retaking
    const errorBanner = page.getByText(/person detected|retake/i).first()
    await expect(errorBanner).toBeVisible({ timeout: 5_000 })

    // Still on step 2 — not redirected to step 3
    await expect(page.getByRole('heading', { name: 'Step 2: Upload Posture Views' })).toBeVisible()
  })
})
