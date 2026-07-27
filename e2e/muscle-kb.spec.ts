import { test, expect } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

// Findings -> muscle page -> exercises navigation (muscle knowledge base).
// Requires the muscle KB seed migration to be applied to the e2e database.
test.describe('muscle knowledge base', () => {
  test('finding chips link to muscle pages with rationale and exercises', async ({ page }) => {
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Kb${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await selectClientInWizard(page, `E2E Kb${stamp}`)
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    // Findings are mounted only while their tab is active. Open the first
    // finding's muscle analysis panel and follow a muscle chip.
    await page.getByRole('tab', { name: /Findings/ }).click()
    const findingWithMuscles = page.locator('[data-testid^="finding-card-"]')
      .filter({ has: page.locator('button', { hasText: /Muscle analysis/i }) })
      .first()
    await findingWithMuscles.locator('summary').click()
    await findingWithMuscles.getByRole('button', { name: /Muscle analysis/i }).click()
    const chip = findingWithMuscles.locator('[data-testid^="muscle-chip-"]').first()
    await expect(chip).toBeVisible({ timeout: 10_000 })
    await chip.click()

    await page.waitForURL(/\/muscles\/[a-z0-9-]+$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Anatomy')).toBeVisible()
    await expect(page.locator('[data-testid="related-findings"]')).toBeVisible()
    // Every muscle page must surface actionable exercise work.
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
