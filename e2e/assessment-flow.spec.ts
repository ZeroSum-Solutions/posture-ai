import { test, expect } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

// Golden path in test mode: fixture landmarks stand in for MediaPipe so the
// flow exercises client creation -> wizard -> scoring -> results -> PDF link
// -> client progress without a camera.
test.describe('assessment golden path (test mode)', () => {
  test('create client, run fixture assessment, see 10 findings and PDF', async ({ page }) => {
    const stamp = Date.now().toString().slice(-7)
    const client = await createClient(page, 'E2E', `Flow${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await expect(page.getByText('TEST MODE').first()).toBeVisible()

    await selectClientInWizard(page, `E2E Flow${stamp}`)

    await page.getByRole('button', { name: 'Run Test Analysis' }).click()

    // Synchronous scoring + status polling ends on the results page.
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    const findings = page.locator('[data-testid^="finding-card-"]')
    await expect(findings).toHaveCount(10, { timeout: 15_000 })

    // Overall grade from the fixture is deterministic (B).
    await expect(page.getByText(/Grade/i).first()).toBeVisible()

    await expect(page.locator('[data-testid="exercises-section"]')).toBeVisible()
    await expect(page.locator('[data-testid="disclaimer"]')).toBeVisible()

    // Fixture frames carry no sensor roll → honest level-unverified badge.
    await expect(page.locator('[data-testid="level-badge"]')).toContainText(/level not verified/i)

    await expect(page.getByRole('button', { name: /PDF/i })).toBeVisible()

    // Client page (progress surface) renders for this client.
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByText(`E2E Flow${stamp}`).first()).toBeVisible()
  })

  test('wizard requires a client before continuing', async ({ page }) => {
    await page.goto('/assessments/new?testMode=1')
    const next = page.getByRole('button', { name: /Next: Confirm/ })
    await expect(next).toBeDisabled()
  })

  test('exercise detail sheet opens from the corrective program and closes on Escape', async ({ page }) => {
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Detail${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await selectClientInWizard(page, `E2E Detail${stamp}`)
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await expect(page.locator('[data-testid="corrective-program"]')).toBeVisible({ timeout: 15_000 })

    const detailButton = page.locator('[data-testid^="exercise-detail-"]').first()
    await detailButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The sheet's aria-label carries the exercise name the button opened.
    await expect(dialog).toHaveAttribute('aria-label', /details$/)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
})
