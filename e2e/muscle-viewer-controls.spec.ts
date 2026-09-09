import { expect, test } from '@playwright/test'

test('neutral anatomy responds to browser pointer controls', async ({ page, isMobile }) => {
  await page.goto('/muscle-viewer/index.html?embed=1')
  const viewer = page.locator('[data-model-state="ready"]')
  await expect(viewer).toBeVisible({ timeout: 25_000 })
  const canvas = page.locator('canvas')
  const front = page.getByRole('button', { name: /Front/ })
  const back = page.getByRole('button', { name: /Back/ })
  if (isMobile) await front.tap()
  else await front.click()
  await expect(viewer).toHaveAttribute('data-camera-state', 'settled')
  const frontImage = await canvas.screenshot()
  if (isMobile) await back.tap()
  else await back.click()
  await expect(viewer).toHaveAttribute('data-camera-state', 'settled')
  expect(frontImage.equals(await canvas.screenshot())).toBe(false)

  if (!isMobile) {
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    const x = bounds!.x + bounds!.width / 2
    const y = bounds!.y + bounds!.height / 2
    const beforeDrag = await canvas.screenshot()
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 90, y + 20, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => beforeDrag.equals(await canvas.screenshot())).toBe(false)
    const beforeZoom = await canvas.screenshot()
    await page.mouse.wheel(0, -200)
    await expect.poll(async () => beforeZoom.equals(await canvas.screenshot())).toBe(false)
  }
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width)
})
