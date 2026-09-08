import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

test('the authenticated workout library renders through the server component boundary', async ({ page }, testInfo) => {
  await page.goto('/workouts')
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Workout library', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Workouts', exact: true })).toHaveAttribute('aria-current', 'page')
  const screen = page.locator('.app-screen')
  const viewport = page.viewportSize()!
  const bounds = await screen.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.width).toBeGreaterThanOrEqual(Math.min(viewport.width, 1000))
  expect(bounds!.width).toBeLessThanOrEqual(viewport.width)
  const client = await createClient(page, 'E2E', `Layout-${randomUUID().slice(0, 8)}`)
  const assessment = await page.request.post('/api/assessments', { data: { client_id: client.id, submission_id: randomUUID(), test_mode: true } })
  expect(assessment.ok()).toBeTruthy()
  const { id } = await assessment.json()
  await page.goto(`/workouts?assessment_id=${id}`)
  const builder = page.getByRole('region', { name: 'Personalize a workout' })
  await expect(builder).toBeVisible()
  const cards = builder.locator(':scope > div')
  const settings = await cards.nth(0).boundingBox()
  const preview = await cards.nth(1).boundingBox()
  expect(settings).not.toBeNull()
  expect(preview).not.toBeNull()
  expect(preview!.width).toBeGreaterThan(280)
  if (viewport.width <= 760) expect(preview!.y).toBeGreaterThan(settings!.y + settings!.height)
  else expect(preview!.x).toBeGreaterThan(settings!.x + settings!.width)
  await page.screenshot({ path: testInfo.outputPath('workout-layout.png'), fullPage: true })
})
