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

  test('auth surfaces pass the axe budget', async ({ page }) => {
    for (const [path, name] of [
      ['/auth/sign-in', 'sign-in'],
      ['/auth/forgot-password', 'forgot-password'],
    ] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoSeriousViolations(page, name)
    }
  })

  test('static surfaces pass the axe budget', async ({ page }) => {
    for (const [path, name] of [
      ['/dashboard', 'dashboard'],
      ['/clients', 'clients'],
      ['/exercises', 'exercises'],
      ['/muscles', 'muscle library'],
      ['/muscles/suboccipitals', 'muscle detail'],
      ['/privacy', 'privacy'],
      ['/terms', 'terms'],
      ['/settings', 'settings'],
    ] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoSeriousViolations(page, name)
    }
  })

  test('client CRUD surfaces pass the axe budget', async ({ page }) => {
    await page.goto('/clients/new')
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'client new')

    const stamp = Date.now().toString().slice(-7)
    const client = await createClient(page, 'A11y', `Budget${stamp}`)

    await page.goto(`/clients/${client.id}`)
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'client detail')

    await page.goto(`/clients/${client.id}/edit`)
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'client edit')
  })

  test('consent page passes the axe budget', async ({ page }) => {
    const c = await createClient(page, 'A11yConsent', `Cns${Date.now().toString().slice(-6)}`, { remote: true })
    const link = await page.request.post('/api/consent/link', { data: { client_id: c.id } })
    expect(link.ok()).toBeTruthy()
    const token = String((await link.json()).url).split('/consent/')[1]
    await page.goto(`/consent/${token}`)
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'consent')
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

  test('assessment results with prior assessment (compare-select + category badges) pass the axe budget', async ({ page }) => {
    const stamp = Date.now().toString().slice(-7)
    const client = await createClient(page, 'A11y', `Prior${stamp}`)

    // First assessment — approve so it appears in the compare-select dropdown
    await page.goto(`/assessments/new?testMode=1&client_id=${client.id}`)
    await page.waitForLoadState('networkidle')
    await page.getByText(`A11y Prior${stamp}`).first().click()
    await page.getByRole('button', { name: /Next: (Confirm|Upload Views)/ }).click()
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    const approveBtn = page.getByRole('button', { name: /Approve report/i })
    if (await approveBtn.isVisible()) await approveBtn.click()
    await page.waitForTimeout(500)

    // Second assessment — compare-select, corrective program, and category badges all render
    await page.goto(`/assessments/new?testMode=1&client_id=${client.id}`)
    await page.waitForLoadState('networkidle')
    await page.getByText(`A11y Prior${stamp}`).first().click()
    await page.getByRole('button', { name: /Next: (Confirm|Upload Views)/ }).click()
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, 'assessment results with prior (compare-select + badges)')
  })
})
