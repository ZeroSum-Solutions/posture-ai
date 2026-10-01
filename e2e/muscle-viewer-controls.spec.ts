import { expect, test } from '@playwright/test'

test('neutral anatomy responds to browser pointer controls', async ({ page, isMobile }) => {
  // The glass viewer re-renders on every pointer step; under CI's software WebGL that is about a
  // second a frame, so the drag keeps to a few steps and the journey gets a longer budget.
  test.setTimeout(90_000)
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
    await page.mouse.move(x + 90, y + 20, { steps: 4 })
    await page.mouse.up()
    // Each poll takes a full-viewport WebGL canvas screenshot. Under CI's
    // software renderer one capture can use most of the default 5 s, so the
    // image-change checks get a bounded 20 s window. The assertions are unchanged.
    await expect.poll(async () => beforeDrag.equals(await canvas.screenshot()), { timeout: 20_000 }).toBe(false)
    const beforeZoom = await canvas.screenshot()
    await page.mouse.wheel(0, -200)
    await expect.poll(async () => beforeZoom.equals(await canvas.screenshot()), { timeout: 20_000 }).toBe(false)
  }
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width)
})
