import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createClient } from './helpers'

test('saved evidence exposes a deferred 3D model with compact controls', async ({ page }, testInfo) => {
  // CI renders the full GLB through software WebGL, then exercises two viewports.
  // Keep each readiness assertion bounded while allowing the whole journey to finish.
  test.setTimeout(60_000)
  const hydrationErrors: string[] = []
  page.on('pageerror', error => {
    if (/hydration|hydrating|server rendered/i.test(error.message)) hydrationErrors.push(error.message)
  })
  const client = await createClient(page, 'E2E', `Anatomy-${randomUUID().slice(0, 8)}`)
  try {
    const response = await page.request.post('/api/assessments', {
      data: { client_id: client.id, submission_id: randomUUID(), test_mode: true },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const { id } = await response.json()
    await page.goto(`/assessments/${id}`)
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click()
    await expect(page.locator('iframe[title="Interactive 3D anatomy model"]')).toHaveCount(0)
    await page.getByRole('button', { name: /Open interactive 3D anatomy/ }).click()
    const frame = page.frameLocator('iframe[title="Interactive 3D anatomy model"]')
    await expect(frame.getByRole('button', { name: 'Front', exact: true })).toBeVisible()
    // The overlay clears only after the viewer reports model-ready, i.e. after
    // the ~9 MB GLB is parsed and drawn through software WebGL. Give that the
    // same bounded 25 s readiness window muscle-3d.spec.ts uses.
    await expect(page.getByText('Loading interactive anatomy…', { exact: true })).not.toBeVisible({ timeout: 25_000 })
    await expect(frame.locator('[data-model-state="ready"]')).toBeVisible({ timeout: 25_000 })
    await expect(frame.locator('canvas')).toBeVisible()
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await frame.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(frame.locator('[data-model-state="ready"][data-camera-state="settled"]')).toBeVisible({ timeout: 10_000 })
      await frame.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(frame.locator('[data-model-state="ready"][data-camera-state="settled"]')).toBeVisible({ timeout: 10_000 })
      const canvasBounds = await frame.locator('canvas').boundingBox()
      const helpBounds = await frame.locator('[data-viewer-help]').boundingBox()
      const controlBounds = await frame.locator('[data-viewer-controls]').boundingBox()
      expect(canvasBounds).not.toBeNull()
      expect(helpBounds).not.toBeNull()
      expect(controlBounds).not.toBeNull()
      expect(controlBounds!.y + controlBounds!.height).toBeLessThanOrEqual(canvasBounds!.y + 1)
      expect(helpBounds!.y).toBeGreaterThanOrEqual(canvasBounds!.y + canvasBounds!.height - 1)
      await page.locator('iframe[title="Interactive 3D anatomy model"]').scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`anatomy-${width}.png`) })
    }
    expect(hydrationErrors, 'Evidence must hydrate consistently across browser engines').toEqual([])
  } finally {
    const deleted = await page.request.delete(`/api/clients/${client.id}`, { data: { reason_code: 'practitioner_correction' } })
    expect(deleted.ok(), await deleted.text()).toBeTruthy()
  }
})
