import { expect, test } from '@playwright/test'

test('exercise library searches its full collection and fits compact screens', async ({ page }) => {
  await page.goto('/exercises')
  await expect(page.getByRole('heading', { name: 'Exercises', exact: true })).toBeVisible()
  const status = page.getByRole('status')
  await expect(status).toHaveText('Showing 24 of 280 matches')
  await page.getByRole('button', { name: 'Show more exercises' }).click()
  await expect(status).toHaveText('Showing 48 of 280 matches')
  const search = page.getByRole('searchbox', { name: 'Search reference exercises' })
  await search.fill('goblet')
  await expect(page.getByText('Dumbbell Goblet Squat', { exact: true })).toBeVisible()
  await page.getByText('Instructions and source', { exact: true }).first().click()
  await expect(page.getByRole('link', { name: /wger source for dumbbell goblet squat/i })).toBeVisible()
  await search.fill('dumbbell romanian deadlift')
  const referenceImage = page.getByRole('img', { name: 'Two views of a person holding one dumbbell in each hand: standing upright and hinging forward at the hips.' })
  await expect(referenceImage).toBeVisible()
  await expect.poll(() => referenceImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByRole('link', { name: 'CC-BY-SA 4 image license' })).toBeVisible()
  await search.fill('')
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(search).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 1280) {
      expect((await page.locator('.app-screen').boundingBox())!.width).toBeGreaterThan(900)
      const cards = page.getByText('Reference · unreviewed', { exact: true }).locator('..')
      const first = (await cards.nth(0).boundingBox())!
      const second = (await cards.nth(1).boundingBox())!
      expect(Math.abs(first.y - second.y)).toBeLessThan(2)
      expect(second.x).toBeGreaterThan(first.x)
    }
  }
})
