import { expect, test, type Page } from '@playwright/test'
import type { TrainingBuildProjection } from '../app/workouts/_strength/StrengthBuilder.gateway'
import { TrainingBuildExplanationV1Schema } from '../lib/training/explanation/contracts'
import { trainingExplanationProviderConfiguration } from '../lib/training/explanation/provider.server'

const responsiveWidths = [320, 390, 768, 1280, 1440] as const

async function assertExplanationFits(page: Page, width: number) {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
  const panel = page.getByRole('region', { name: 'Why this draft looks this way', exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Refresh explanation', exact: true })).toBeVisible()
  const bounds = await panel.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
}

test('explains the exact saved draft with deterministic facts and leaves acceptance unchanged', async ({ page }) => {
  test.setTimeout(90_000)
  expect(trainingExplanationProviderConfiguration()).toBeUndefined()

  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Build a strength program', exact: true })
    .getByText('Practice Athlete', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')

  const buildResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/programs/builds'
  ))
  await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
  const buildResponse = await buildResponsePromise
  expect(buildResponse.ok()).toBe(true)
  const projection = await buildResponse.json() as TrainingBuildProjection
  expect(projection.result.kind).toBe('draft_program')
  if (projection.result.kind !== 'draft_program' || !projection.buildId) {
    throw new Error('Expected a stored draft program projection')
  }
  await expect(page.getByRole('heading', {
    name: `${projection.result.cycleLengthWeeks}-week draft`,
    exact: true,
  })).toBeVisible()

  const startingLoads = page.getByRole('combobox', { name: 'Starting load', exact: true })
  const beforeLoads = await startingLoads.evaluateAll(selects => selects.map(select => (
    (select as HTMLSelectElement).value
  )))
  const acceptButton = page.getByRole('button', { name: 'Use these starting targets', exact: true })
  await expect(acceptButton).toBeEnabled()
  const acceptanceRequests: string[] = []
  page.on('request', request => {
    if (/\/api\/training\/programs\/builds\/[^/]+\/accept$/.test(new URL(request.url()).pathname)) {
      acceptanceRequests.push(request.url())
    }
  })

  const explanationResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/training/programs/builds/${projection.buildId}/explanation`
  ))
  await page.getByRole('button', { name: 'Explain this draft', exact: true }).click()
  const explanationResponse = await explanationResponsePromise
  expect(explanationResponse.ok()).toBe(true)
  const explanation = TrainingBuildExplanationV1Schema.parse(await explanationResponse.json())
  expect(explanation.source).toBe('deterministic_default')
  expect(explanation.fallbackReason).toBe('selection_absent')
  expect(explanation.binding).toEqual({
    buildId: projection.buildId,
    subjectId: projection.result.subjectId,
    profileRevision: Number(projection.result.profileRevisionId),
  })

  const explanationPanel = page.getByRole('region', {
    name: 'Why this draft looks this way',
    exact: true,
  })
  await expect(explanationPanel.getByRole('listitem')).toHaveCount(explanation.facts.length)
  for (const fact of explanation.facts) {
    await expect(explanationPanel.getByText(fact.text, { exact: true })).toBeVisible()
  }
  await expect(explanationPanel.getByText(/do not change its targets/i)).toBeVisible()

  for (const width of responsiveWidths) await assertExplanationFits(page, width)

  expect(await startingLoads.evaluateAll(selects => selects.map(select => (
    (select as HTMLSelectElement).value
  )))).toEqual(beforeLoads)
  await expect(acceptButton).toBeEnabled()
  expect(acceptanceRequests).toEqual([])
  await expect(page.getByText('Starting targets accepted and program created.')).toHaveCount(0)
})
