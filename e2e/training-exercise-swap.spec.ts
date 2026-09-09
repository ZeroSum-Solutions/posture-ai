import { expect, test } from '@playwright/test'

test('accepts a future-only exercise alternative in the private practice workspace', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/workouts')
  await page.getByRole('combobox', { name: 'Sample program', exact: true })
    .selectOption('exercise-swap')
  const setupResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/simulation/setup'
    && new URL(response.url()).searchParams.get('catalog') === 'exercise-swap'
  ))
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  expect((await setupResponse).ok()).toBe(true)

  await expect(page.getByRole('region', { name: 'Build a strength program' })
    .getByText('Practice Athlete', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
  await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: '8-week draft', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', {
    name: 'Synthetic two-dumbbell floor press',
    exact: true,
  })).toBeVisible()
  await expect(page.getByRole('heading', {
    name: 'Synthetic neutral-grip two-dumbbell floor press',
    exact: true,
  })).toHaveCount(0)

  const publishResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/programs/publish'
  ))
  await page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
  const published = await publishResponse
  expect(published.ok()).toBe(true)
  const publication = await published.json() as { assignmentId?: unknown }
  expect(typeof publication.assignmentId).toBe('string')
  const assignmentId = publication.assignmentId as string

  const firstSessionHref = await page.getByRole('link', {
    name: 'Open first strength session',
    exact: true,
  }).getAttribute('href')
  expect(firstSessionHref).toMatch(/^\/workouts\?training_session_id=/)
  await page.goto(firstSessionHref!)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  const finishWithOmissions = page.getByRole('button', { name: /Finish with \d+ omissions?/ })
  await expect(finishWithOmissions).toBeVisible()
  await finishWithOmissions.click()
  await expect(page.getByText(/session is completed with omissions/i)).toBeVisible()

  await page.goto(`/workouts?training_program_id=${encodeURIComponent(assignmentId)}`)
  await page.getByRole('tab', { name: 'Program', exact: true }).click()
  const sourceRows = page.getByText('Synthetic two-dumbbell floor press', { exact: true })
    .locator('..')
    .filter({ has: page.getByRole('heading', { name: 'Exercise alternatives', exact: true }) })
  await expect(sourceRows.first()).toBeVisible()
  const sourceRow = sourceRows.first()
  await sourceRow.getByRole('button', { name: 'Find alternatives', exact: true }).click()
  await expect(sourceRow.getByRole('heading', {
    name: 'Synthetic neutral-grip two-dumbbell floor press',
    exact: true,
  })).toBeVisible()
  await expect(sourceRow.getByText(/palms facing each other/i)).toBeVisible()
  const startingTargets = sourceRow.getByRole('radio')
  await expect(startingTargets.first()).not.toBeChecked()
  await expect(sourceRow.getByRole('button', {
    name: 'Accept selected starting target',
    exact: true,
  })).toBeDisabled()

  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
    await expect(sourceRow.getByRole('heading', {
      name: 'Synthetic neutral-grip two-dumbbell floor press',
      exact: true,
    })).toBeVisible()
    await expect(startingTargets.first()).toBeVisible()
    await expect(sourceRow.getByRole('button', {
      name: 'Accept selected starting target',
      exact: true,
    })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  }
  await page.setViewportSize({ width: 320, height: 844 })
  await startingTargets.nth(1).check()
  const acceptanceResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && /\/api\/training\/exercise-swaps\/proposals\/[^/]+\/accept$/.test(new URL(response.url()).pathname)
  ))
  await sourceRow.getByRole('button', {
    name: 'Accept selected starting target',
    exact: true,
  }).click()
  expect((await acceptanceResponse).ok()).toBe(true)

  await expect(page.getByText(
    'Synthetic neutral-grip two-dumbbell floor press',
    { exact: true },
  ).first()).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: 'Program', exact: true }).click()
  await expect(page.getByText(
    'Synthetic neutral-grip two-dumbbell floor press',
    { exact: true },
  ).first()).toBeVisible()

  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.getByText('Finished with omissions', { exact: true })).toBeVisible()
  await expect(page.getByText(
    'Synthetic two-dumbbell floor press',
    { exact: true },
  ).first()).toBeVisible()
  await expect(page.getByText(
    'Synthetic neutral-grip two-dumbbell floor press',
    { exact: true },
  )).toHaveCount(0)
})
