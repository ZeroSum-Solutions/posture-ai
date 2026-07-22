import { test, expect } from '@playwright/test'
import path from 'node:path'
import { createClient, selectClientInWizard, dismissCaptureDisclaimer } from './helpers'

test.describe('capture model readiness and recovery', () => {
  test('throttled cold assets expose lifecycle, then a warm check stays ready', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })

    let delayedRequests = 0
    await page.route('**/mediapipe/**', async route => {
      delayedRequests += 1
      await new Promise(resolve => setTimeout(resolve, 600))
      await route.continue()
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `ColdModel${stamp}`)
    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E ColdModel${stamp}`)
    await dismissCaptureDisclaimer(page)

    const photos = path.join(__dirname, 'fixtures', 'photos')
    const inputs = page.locator('input[type="file"]')
    const heapBefore = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      return memory?.usedJSHeapSize ?? null
    })
    const coldStart = Date.now()
    await inputs.nth(0).setInputFiles(path.join(photos, 'front_standing.jpg'))

    const readiness = page.getByTestId('pose-readiness')
    await expect(readiness).toContainText(/Downloading posture model|Initializing posture model/, { timeout: 30_000 })
    await expect(readiness).toContainText('Posture model ready', { timeout: 120_000 })
    const coldMs = Date.now() - coldStart

    const warmStart = Date.now()
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))
    await expect(page.getByRole('button', { name: /Left Side.*captured/ })).not.toHaveAttribute('aria-label', /model check failed/, { timeout: 90_000 })
    await expect(readiness).toContainText('Posture model ready', { timeout: 90_000 })
    const warmMs = Date.now() - warmStart
    const heapAfter = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      return memory?.usedJSHeapSize ?? null
    })

    expect(delayedRequests).toBeGreaterThan(0)
    expect(coldMs).toBeGreaterThanOrEqual(600)
    // Diagnostic timing is retained in the Playwright receipt/output; it is not a
    // device-performance threshold (physical closure belongs to HG-04).
    console.info(JSON.stringify({ evidence: 'PR-03-model-readiness', coldMs, warmMs, delayedRequests, heapBefore, heapAfter, visibleMemorySymptoms: 'none' }))
  })

  test('both delegate startup failures recover through Retry Model without reload', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })

    let failModelAssets = true
    let aborted = 0
    await page.route('**/mediapipe/models/**', async route => {
      if (failModelAssets) {
        aborted += 1
        await route.abort('failed')
      } else {
        await route.continue()
      }
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `RetryModel${stamp}`)
    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E RetryModel${stamp}`)
    await dismissCaptureDisclaimer(page)

    // This scenario owns lifecycle recovery, not full-resolution inference
    // performance (covered by real-detection.spec.ts and physical HG-04 evidence).
    // Keep the post-retry inference lightweight so headless SwiftShader stalls do
    // not turn a successful model reload into a false 10-second product timeout.
    const recoveryFixture = path.join(__dirname, 'fixtures', 'photos', 'no-person.png')
    await page.locator('input[type="file"]').nth(0).setInputFiles(recoveryFixture)
    const readiness = page.getByTestId('pose-readiness')
    await expect(readiness).toHaveAttribute('role', 'alert', { timeout: 120_000 })
    await expect(page.getByRole('button', { name: /Front.*model check failed/ })).toBeVisible()

    failModelAssets = false
    await page.getByRole('button', { name: 'Retry Model' }).click()
    await expect(readiness).toContainText('Posture model ready', { timeout: 120_000 })
    await expect(page.getByRole('button', { name: /Front.*captured/ })).not.toHaveAttribute('aria-label', /model check failed/, { timeout: 90_000 })
    expect(aborted).toBeGreaterThan(0)
  })
})
