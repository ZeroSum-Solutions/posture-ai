import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createClient } from './helpers'

test('saved evidence exposes a deferred 3D model with compact controls', async ({ page }, testInfo) => {
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
    await expect(page.getByText('Loading interactive anatomy…', { exact: true })).not.toBeVisible()
    await expect(frame.locator('[data-model-state="ready"]')).toBeVisible()
    await expect(frame.locator('canvas')).toBeVisible()
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await frame.getByRole('button', { name: 'Back', exact: true }).click()
      await frame.getByRole('button', { name: 'Reset', exact: true }).click()
      await page.locator('iframe[title="Interactive 3D anatomy model"]').scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`anatomy-${width}.png`) })
    }
  } finally {
    const deleted = await page.request.delete(`/api/clients/${client.id}`, { data: { reason_code: 'practitioner_correction' } })
    expect(deleted.ok(), await deleted.text()).toBeTruthy()
  }
})
