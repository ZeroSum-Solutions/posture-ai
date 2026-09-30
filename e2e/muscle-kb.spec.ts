import { test, expect } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

// Findings -> muscle page -> exercises navigation (muscle knowledge base).
// Requires the muscle KB seed migration to be applied to the e2e database.
test.describe('muscle knowledge base', () => {
  test('a finding spotlights its muscles; a muscle opens its detail, then the full page', async ({ page }, testInfo) => {
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Kb${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await selectClientInWizard(page, `E2E Kb${stamp}`)
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    // Findings no longer expand in place: tapping one spotlights its muscles on the 3D posture
    // map at the top of the page and lists them as chips there.
    await page.getByRole('tab', { name: /Findings/ }).click()
    const finding = page.locator('[data-testid^="finding-spotlight-"]').first()
    await expect(finding).toBeVisible({ timeout: 10_000 })
    await finding.click()
    await expect(finding).toHaveAttribute('aria-pressed', 'true')
    const chips = page.getByRole('group', { name: / muscles$/ })
    await expect(chips).toBeVisible()
    await chips.getByRole('button').first().click()

    // Muscle detail opens as a modal over the page (no navigation).
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText('What this scan found')).toBeVisible()
    await expect(dialog.getByText('Anatomy', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText(/Screening indication, not a diagnosis/)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('muscle-modal.png') })
    expect(page.url()).toMatch(/\/assessments\/[0-9a-f-]{36}$/)

    // The full muscle page stays one tap away and still carries rationale + exercises.
    await dialog.getByRole('link', { name: 'Full muscle page' }).click()
    await page.waitForURL(/\/muscles\/[a-z0-9-]+$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Anatomy')).toBeVisible()
    await expect(page.locator('[data-testid="related-findings"]')).toBeVisible()
    const hasStretch = await page.locator('[data-testid="stretch-exercises"]').isVisible().catch(() => false)
    const hasStrengthen = await page.locator('[data-testid="strengthen-exercises"]').isVisible().catch(() => false)
    expect(hasStretch || hasStrengthen, 'muscle page must list stretches or strengthening work').toBe(true)
    await expect(page.locator('[data-testid="screening-disclaimer"]')).toBeVisible()
  })

  test('muscle library lists regions and supports search', async ({ page }) => {
    await page.goto('/muscles')
    await expect(page.getByRole('heading', { name: 'Muscle Guide' })).toBeVisible()
    const cards = page.locator('[data-testid^="muscle-card-"]')
    await expect(cards.first()).toBeVisible({ timeout: 10_000 })
    // Equals the number of muscles in the KB seed (currently 29). Bump only when the seed legitimately changes.
    expect(await cards.count()).toBe(29)

    await page.getByRole('searchbox', { name: 'Search muscles' }).fill('trapezius')
    await expect(page.locator('[data-testid^="muscle-card-"]')).toHaveCount(3)
  })
})
