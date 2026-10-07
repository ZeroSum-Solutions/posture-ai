import { test, expect } from '@playwright/test'
import { countEvidenceFindings, createClient, selectClientInWizard } from './helpers'

// Golden path in test mode: fixture landmarks stand in for MediaPipe so the
// flow exercises client creation -> wizard -> scoring -> results -> PDF link
// -> client progress without a camera.
test.describe('assessment golden path (test mode)', () => {
  test('create client, run fixture assessment, see numeric findings and PDF', async ({ page }, testInfo) => {
    // This journey's results-page navigation also mounts the 3D posture-map
    // hero (GLB load + software WebGL render); the default 30s budget is too
    // tight for that on top of the rest of the flow.
    test.setTimeout(90_000)
    const hydrationErrors: string[] = []
    page.on('pageerror', error => { if (/hydration/i.test(error.message)) hydrationErrors.push(error.message) })
    const stamp = Date.now().toString().slice(-7)
    const client = await createClient(page, 'E2E', `Flow${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await expect(page.getByText('TEST MODE').first()).toBeVisible()

    await selectClientInWizard(page, `E2E Flow${stamp}`)

    await page.getByRole('button', { name: 'Run Test Analysis' }).click()

    // Synchronous scoring + status polling ends on the results page.
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    // Results open with the grade always on screen (outside the tab strip) and
    // Evidence as the default, keyboard-accessible tab; the findings themselves
    // live on the posture map, and Program is the other tab. No disclaimer copy
    // on the page: the screening notice is accepted at onboarding.
    await expect(page.getByRole('tab', { name: /^Evidence/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: /^Findings/ })).toHaveCount(0)
    await expect(page.getByText(/Grade C/i).first()).toBeVisible()
    await expect(page.locator('[data-testid="disclaimer"]')).toHaveCount(0)

    // Evidence lists each finding under the capture view it was measured on.
    // The current fixture has eight numeric screening readings; non-numeric
    // records are not fabricated into plotted findings.
    await expect.poll(() => countEvidenceFindings(page), { timeout: 15_000 }).toBe(8)

    // Exercises are no longer their own tab — they are a nested disclosure
    // inside Program's "Matched exercises" summary.
    await page.getByRole('tab', { name: /^Program/ }).click()
    await page.locator('summary', { hasText: /^Matched exercises/ }).click()
    await expect(page.locator('[data-testid="exercises-section"]')).toBeVisible()
    await expect(page.locator('[data-testid="exercises-section"]')).not.toHaveAttribute('open', '')

    // Every coach-side program control needs stable form identity for browser
    // autofill/devtools and explicit label association.
    await expect(page.getByTestId('capability-select')).toBeVisible()
    const firstSwap = page.locator('[data-testid^="swap-"]').first()
    await expect(firstSwap).toBeVisible()
    const firstSwapId = await firstSwap.getAttribute('id')
    expect(firstSwapId).toBeTruthy()
    await expect(page.locator(`label[for="${firstSwapId}"]`)).toHaveText('Swap')
    await expect(
      page.locator('[data-testid="corrective-program"] select:not([id]), [data-testid="corrective-program"] select:not([name])'),
    ).toHaveCount(0)

    // Fixture frames carry no sensor roll → honest level-unverified badge.
    await expect(page.locator('[data-testid="level-badge"]')).toContainText(/level not verified/i)

    await expect(page.getByRole('button', { name: /PDF/i })).toBeVisible()

    // Client page (progress surface) renders for this client.
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByText(`E2E Flow${stamp}`).first()).toBeVisible()
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await expect(page.getByText('null pts', { exact: false })).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath(`client-overview-${width}.png`), fullPage: true })
    }
    expect(hydrationErrors).toEqual([])
    await page.getByRole('link', { name: 'Open anatomy view for the latest assessment' }).click()
    // The posture map is the results page hero: the deep link lands on it, Evidence stays the
    // selected tab, and the live model mounts on its own once the page is idle.
    await expect(page.locator('#anatomy-viewer-title')).toBeAttached()
    await expect(page.getByRole('tab', { name: /^Evidence/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTitle('Interactive 3D anatomy model')).toHaveCount(1, { timeout: 15_000 })
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
    await page.getByRole('tab', { name: /^Program/ }).click()
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

test('the real scan entry offers a dedicated upload screen on compact layouts', async ({ page }, testInfo) => {
  const stamp = Date.now().toString().slice(-7)
  const client = await createClient(page, 'Upload', `Flow${stamp}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/assessments/new?client_id=${client.id}`)
  await page.getByRole('button', { name: 'Choose capture method' }).click()
  await expect(page.getByRole('button', { name: 'Start live capture' })).toBeVisible()
  await page.getByRole('button', { name: 'Upload existing photos' }).click()
  await expect(page.getByRole('heading', { name: 'Upload four posture views' })).toBeVisible()
  for (const name of ['Front', 'Left Side', 'Right Side', 'Back']) {
    await expect(page.getByRole('button', { name: `${name} Choose photo`, exact: true })).toBeVisible()
  }
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Front Choose photo', exact: true }).click()
  const chooser = await chooserPromise
  expect(await chooser.element().getAttribute('aria-label')).toBe('Upload Front photo')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('dedicated-upload-390.png') })
})
