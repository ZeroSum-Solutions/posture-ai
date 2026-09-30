import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createClient } from './helpers'

test('results hero mounts the 3D posture map with overlay controls at phone and desktop widths', async ({ page }, testInfo) => {
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
    // No Evidence detour and no click: the map is the first thing on the page.
    const frame = page.frameLocator('iframe[title="Interactive 3D anatomy model"]')
    await expect(frame.getByRole('button', { name: 'Front', exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('[data-model-state="ready"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Loading your posture map…', { exact: true })).not.toBeVisible()
    await expect(frame.locator('canvas')).toBeVisible()
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await frame.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(frame.locator('[data-model-state="ready"][data-camera-state="settled"]')).toBeVisible({ timeout: 10_000 })
      await frame.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(frame.locator('[data-model-state="ready"][data-camera-state="settled"]')).toBeVisible({ timeout: 10_000 })
      // Controls float over the canvas and stay inside it at every width.
      const canvasBounds = await frame.locator('canvas').boundingBox()
      const controlBounds = await frame.locator('[data-viewer-controls]').boundingBox()
      expect(canvasBounds).not.toBeNull()
      expect(controlBounds).not.toBeNull()
      expect(controlBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x - 1)
      expect(controlBounds!.x + controlBounds!.width).toBeLessThanOrEqual(canvasBounds!.x + canvasBounds!.width + 1)
      await page.locator('iframe[title="Interactive 3D anatomy model"]').scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`anatomy-${width}.png`) })
    }
    expect(hydrationErrors, 'The results hero must hydrate consistently across browser engines').toEqual([])
  } finally {
    const deleted = await page.request.delete(`/api/clients/${client.id}`, { data: { reason_code: 'practitioner_correction' } })
    expect(deleted.ok(), await deleted.text()).toBeTruthy()
  }
})
