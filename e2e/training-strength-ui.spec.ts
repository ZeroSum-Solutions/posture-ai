import { expect, test, type Page, type TestInfo } from '@playwright/test'

const responsiveWidths = [320, 390, 768, 1280, 1440] as const

async function assertNoHorizontalOverflow(page: Page, width: number, testInfo: TestInfo) {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
  await expect(page.getByRole('heading', { name: 'Eight-week draft' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)

  const builder = page.getByRole('region', { name: 'Strength program builder' })
  const bounds = await builder.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
  await expect(page.getByRole('combobox', { name: 'Starting load', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Duration in minutes', exact: true }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`strength-builder-${width}.png`), fullPage: true })
}

test('builds, accepts, and records a private sample strength program through the original Workouts UI', async ({ page }, testInfo) => {
  await page.goto('/workouts')
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true, level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Build a strength program', exact: true }).getByText('Practice Athlete', { exact: true })).toBeVisible()
  await expect(page.getByText(/separate private practice athlete/i)).toBeVisible()
  await expect(page.getByText(/Profile revision \d+/)).toBeVisible()

  await page.getByRole('tab', { name: 'Schedule' }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
  await page.getByRole('button', { name: 'Build practice draft' }).click()
  await expect(page.getByRole('heading', { name: 'Eight-week draft' })).toBeVisible()
  const startingLoads = page.getByRole('combobox', { name: 'Starting load', exact: true })
  await expect(startingLoads.first()).toBeVisible()
  await expect(startingLoads.nth(1)).toBeVisible()
  const selectedLoadLabels = await startingLoads.evaluateAll(selects => selects.map(select =>
    (select as HTMLSelectElement).selectedOptions[0]?.textContent ?? '',
  ))
  expect(selectedLoadLabels[0]).toMatch(/one dumbbell total/i)
  expect(selectedLoadLabels[1]).toMatch(/per hand · two dumbbells/i)

  for (const width of responsiveWidths) await assertNoHorizontalOverflow(page, width, testInfo)

  let acceptanceRequests = 0
  const publishedDraftIds: string[] = []
  page.on('request', request => {
    if (/\/api\/training\/programs\/builds\/[^/]+\/accept$/.test(new URL(request.url()).pathname)) acceptanceRequests += 1
  })
  // Inject a transport failure after the actual server acceptance transaction.
  await page.route('**/api/training/programs/publish', async route => {
    publishedDraftIds.push(route.request().postDataJSON().draftId)
    if (publishedDraftIds.length === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'training_publication_unavailable' }) })
    } else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: 'Use these starting targets' }).click()
  await expect(page.getByText('Starting targets were accepted, but the program was not published. Retry publishing this accepted draft.')).toBeVisible()
  await expect(startingLoads.first()).toBeDisabled()
  await expect(page.getByRole('spinbutton', { name: 'Duration in minutes', exact: true }).first()).toBeDisabled()
  await page.getByRole('button', { name: 'Retry publishing accepted draft', exact: true }).click()
  await expect(page.getByText('Starting targets accepted and program created.')).toBeVisible()
  expect(acceptanceRequests).toBe(1)
  expect(publishedDraftIds).toHaveLength(2)
  expect(publishedDraftIds[1]).toBe(publishedDraftIds[0])
  const strengthHref = await page.getByRole('link', { name: 'Open first strength session' }).getAttribute('href')
  const conditioningHref = await page.getByRole('link', { name: 'Open first conditioning session' }).getAttribute('href')
  expect(strengthHref).toMatch(/^\/workouts\?training_session_id=/)
  expect(conditioningHref).toMatch(/^\/workouts\?training_session_id=/)

  await page.goto(strengthHref!)
  await expect(page.getByRole('heading', { name: 'Session', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start session' }).click()
  const firstSet = page.getByRole('group', { name: 'Set 1' }).first()
  const rir = firstSet.getByRole('combobox', { name: 'RIR', exact: true })
  await expect(rir).toHaveValue('unknown')
  await rir.selectOption('3')
  await firstSet.getByRole('button', { name: 'Save set' }).click()
  await expect(firstSet.getByRole('button', { name: 'Set saved' })).toBeVisible()
  const finishWithOmissions = page.getByRole('button', { name: /Finish with \d+ omissions?/ })
  await expect(finishWithOmissions).toBeVisible()
  await finishWithOmissions.click()
  await expect(page.getByText(/session is completed with omissions/i)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Set 2' }).first()).toContainText('Omitted when finished.')
  await expect(page.getByRole('button', { name: 'Save set', exact: true })).toHaveCount(0)
  await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()

  await page.goto(conditioningHref!)
  await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start session' }).click()
  await page.getByRole('combobox', { name: 'Perceived effort', exact: true }).selectOption('4')
  await page.getByRole('button', { name: 'Save conditioning' }).click()
  await expect(page.getByRole('button', { name: 'Conditioning saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Finish session' }).click()
  await expect(page.getByText(/session is completed/i)).toBeVisible()

  await page.goto('/workouts')
  await expect(page.getByRole('combobox', { name: 'Build strength program for', exact: true }).locator('option').filter({ hasText: /^Practice Athlete$/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Resume a session' })).toBeVisible()
  await expect(page.getByText('Practice data', { exact: true }).first()).toBeVisible()
})
