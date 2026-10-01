import { test, expect } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

// Findings -> muscle page -> exercises navigation (muscle knowledge base).
// Requires the muscle KB seed migration to be applied to the e2e database.
test.describe('muscle knowledge base', () => {
  test('a finding spotlights its muscles; a muscle opens its detail, then the full page', async ({ page }, testInfo) => {
    // The journey now runs through the live 3D viewer's rails (mounted once the page is idle),
    // then compiles and opens the muscle page — more than the default 30 s under a dev server.
    test.setTimeout(90_000)
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Kb${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await selectClientInWizard(page, `E2E Kb${stamp}`)
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    // Everything is driven from the posture map's edge rails (keyboard-operable listboxes): the
    // right rail spotlights a finding, the left rail isolates one of its muscles (no pop-up yet).
    const frame = page.frameLocator('iframe[title="Interactive 3D anatomy model"]')
    const finding = frame.getByRole('listbox', { name: 'Findings' }).getByRole('option').first()
    await expect(finding).toBeAttached({ timeout: 30_000 })
    // A finding option reads "<finding>. <muscle> · <muscle> · …".
    const label = (await finding.getAttribute('aria-label')) ?? ''
    const muscleName = label.slice(label.indexOf('. ') + 2).split(' · ')[0]
    expect(muscleName, 'the first finding must link a drawable muscle').not.toBe('')
    await finding.press('Enter')
    await expect(page.getByRole('status', { name: 'Spotlighted finding' })).toBeVisible({ timeout: 10_000 })
    const escaped = muscleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await frame
      .getByRole('listbox', { name: 'Muscles, head to toe' })
      .getByRole('option', { name: new RegExp(`^${escaped}`) })
      .press('Enter')
    const selected = page.getByRole('status', { name: 'Selected muscle' })
    await expect(selected).toBeVisible()
    await selected.getByRole('button', { name: 'Details' }).click()

    // Details opens the muscle pop-up over the page (no navigation).
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText('What this scan found')).toBeVisible()
    await expect(dialog.getByText('Anatomy', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText(/not a diagnosis/)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('muscle-modal.png') })
    expect(page.url()).toMatch(/\/assessments\/[0-9a-f-]{36}$/)

    // ✕ closes the pop-up and leaves the muscle isolated on the map; Details reopens it.
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await expect(selected).toBeVisible()
    await selected.getByRole('button', { name: 'Details' }).click()
    await expect(dialog.getByText('Anatomy', { exact: true })).toBeVisible({ timeout: 10_000 })

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
