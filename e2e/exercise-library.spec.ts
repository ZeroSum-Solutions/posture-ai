import { expect, test } from '@playwright/test'

test('exercise library searches one collection, exposes workout actions, and fits responsive screens', async ({ page }, testInfo) => {
  await page.goto('/exercises')
  await expect(page.getByRole('heading', { name: 'Exercises', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Find a movement', exact: true })).toBeVisible()
  const status = page.getByRole('status')
  // Licensed references are always present; reviewed content is enabled by
  // the existing practitioner/content policy in this test environment.
  await expect(status).toHaveText(/^Showing 24 of (280|353) matches$/)
  const total = (await status.textContent())!.match(/of (\d+) matches/)![1]
  await page.getByRole('button', { name: 'Show more exercises' }).click()
  await expect(status).toHaveText(`Showing 48 of ${total} matches`)

  const search = page.getByRole('searchbox', { name: 'Search exercises' })
  await search.fill('goblet')
  await expect(page.getByText('Dumbbell Goblet Squat', { exact: true })).toBeVisible()
  await expect(page.getByText(/Grasp dumbbell with both hands at the sides of the upper plates/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /wger source for dumbbell goblet squat/i })).toBeVisible()
  const addGoblet = page.getByRole('button', { name: 'Add Dumbbell Goblet Squat to workout' })
  await expect(addGoblet).toBeVisible()
  await addGoblet.click()
  const workoutSelection = page.getByRole('status', { name: 'Workout selection' })
  await expect(workoutSelection).toContainText('1 exercise selected')
  await expect(workoutSelection.getByRole('link', { name: 'Continue to workout' }))
    .toHaveAttribute('href', /exercise=wger%3A/)
  await page.getByRole('button', { name: 'Remove Dumbbell Goblet Squat from workout' }).click()
  await expect(workoutSelection).toHaveCount(0)

  await search.fill('dumbbell romanian deadlift')
  const referenceImage = page.getByRole('img', { name: 'Two views of a person holding one dumbbell in each hand: standing upright and hinging forward at the hips.' })
  await expect(referenceImage).toBeVisible()
  await expect.poll(() => referenceImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByRole('link', { name: 'CC-BY-SA 4 image license' })).toBeVisible()
  await search.fill('')

  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(search).toBeVisible()
    await expect(page.getByText('Licensed reference · not program reviewed').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    // Surface's flush modifier must not override the exercise card inset.
    expect(await page.locator('[class*="cardInner"]').first().evaluate(element => parseFloat(getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(18)

    if (width === 390 || width === 1280) {
      await testInfo.attach(`exercise-library-${width}px`, {
        body: await page.screenshot({ path: testInfo.outputPath(`exercise-library-${width}.png`), fullPage: false }),
        contentType: 'image/png',
      })
    }

    if (width >= 1280) {
      expect((await page.locator('.app-screen').boundingBox())!.width).toBeGreaterThan(900)
      const cards = page.getByText('Licensed reference · not program reviewed', { exact: true }).locator('..')
      const first = (await cards.nth(0).boundingBox())!
      const second = (await cards.nth(1).boundingBox())!
      expect(Math.abs(first.y - second.y)).toBeLessThan(2)
      expect(second.x).toBeGreaterThan(first.x)
    }
  }
})
