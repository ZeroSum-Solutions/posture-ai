import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, test } from '@playwright/test'
import { createClient } from './helpers'

test('capture photos remain private, preserve their view and support retry and erasure', async ({ page, playwright }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Storage transaction coverage runs once; gallery layout is checked at mobile and desktop widths here.')
  const client = await createClient(page, 'E2E', `Photos-${randomUUID().slice(0, 8)}`)
  const created = await page.request.post('/api/assessments', {
    data: { client_id: client.id, submission_id: randomUUID(), test_mode: true },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { id: assessmentId } = await created.json()
  // Generated color cards exercise storage only; these are not human scans.
  const jpeg = await sharp({ create: { width: 128, height: 192, channels: 3, background: '#347d7b' } }).jpeg().toBuffer()
  const upload = () => page.request.post(`/api/assessments/${assessmentId}/capture-images`, {
    multipart: { slot: 'front', image: { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpeg } },
  })
  const saved = await upload()
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const receipt = await saved.json()
  expect(receipt).toMatchObject({ slot: 'front', status: 'saved' })
  const retry = await upload()
  expect(retry.ok(), await retry.text()).toBeTruthy()
  expect(await retry.json()).toEqual({ ...receipt, status: 'already_saved' })
  const imageUrl = `/api/captures/${receipt.captureId}/image`
  const authorizedImage = await page.request.get(imageUrl)
  expect(authorizedImage.ok()).toBeTruthy()
  expect(authorizedImage.headers()['content-type']).toContain('image/jpeg')
  expect(authorizedImage.headers()['cache-control']).toContain('no-store')
  const anonymous = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL, storageState: { cookies: [], origins: [] } })
  try { expect((await anonymous.get(imageUrl)).status()).toBe(401) } finally { await anonymous.dispose() }
  const report = await page.request.get(`/api/assessments/${assessmentId}`)
  expect(report.ok(), await report.text()).toBeTruthy()
  expect((await report.json()).captures.find((capture: { view: string }) => capture.view === 'front').signed_url).toBe(imageUrl)
  await page.goto(`/assessments/${assessmentId}`)
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: 'Enlarge front capture' }).click()
    const dialog = page.getByRole('dialog', { name: 'front capture photo' })
    await expect(dialog).toBeVisible()
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width)
    await expect(dialog.getByRole('img')).toBeVisible()
    await expect.poll(() => dialog.getByRole('img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`capture-photo-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  }
  const deleted = await page.request.delete(`/api/clients/${client.id}`, { data: { reason_code: 'practitioner_correction' } })
  expect(deleted.ok(), await deleted.text()).toBeTruthy()
  expect((await page.request.get(imageUrl)).status()).toBe(404)
})
