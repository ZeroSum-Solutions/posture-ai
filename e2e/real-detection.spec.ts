import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard } from './helpers'

// Uploads real standing-posture photos through the actual detectPose path
// (MediaPipe WASM in the browser) — no test mode. Chromium-only via project
// config; generous timeout for the one-time model download.
test.describe('real pose detection through the wizard', () => {
  test('upload front+side photos, detect landmarks, score assessment', async ({ page }) => {
    test.setTimeout(300_000)

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Detect${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Detect${stamp}`)

    const photos = path.join(__dirname, 'fixtures', 'photos')
    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })

    // Slot order matches the wizard's view order: front, side, back.
    await inputs.nth(0).setInputFiles(path.join(photos, 'front_standing.jpg'))
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))

    await page.getByRole('button', { name: 'Analyze Posture' }).click()

    // detectPose runs per view at submit (model download + WASM init on first call).
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 240_000 })

    const findings = page.locator('[data-testid^="finding-card-"]')
    await expect(findings).toHaveCount(10, { timeout: 15_000 })
  })
})
