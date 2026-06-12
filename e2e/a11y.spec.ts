import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient, selectClientInWizard } from './helpers'

// Pragmatic accessibility budget (roadmap P5): zero serious/critical axe
// violations on every primary surface. Desktop-chromium only — axe results
// are viewport-independent enough for a budget gate.
test.describe('accessibility budget', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'axe runs once, on chromium')

  async function expectNoSeriousViolations(page: import('@playwright/test').Page, name: string) {
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    const detail = serious.map(v =>
      `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`
    )
    expect(serious, `${name}:\n${detail.join('\n')}`).toEqual([])
  }

  test('static surfaces pass the axe budget', async ({ page }) => {
    for (const [path, name] of [
      ['/dashboard', 'dashboard'],
      ['/clients', 'clients'],
      ['/exercises', 'exercises'],
      ['/muscles', 'muscle library'],
      ['/muscles/suboccipitals', 'muscle detail'],
    ] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoSeriousViolations(page, name)
    }
  })

  test('wizard and results pass the axe budget', async ({ page }) => {
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Axe${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'wizard step 1')

    await selectClientInWizard(page, `E2E Axe${stamp}`)
    await expectNoSeriousViolations(page, 'wizard step 2 (confirm)')

    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'results')
  })
})
