import { expect, test } from '@playwright/test'
import { TrainingProgramWorkspaceProjectionSchema } from '../lib/training/contracts/program-workspace'

test('reviews and accepts conditioning targets after two saved bouts with a lost acceptance response', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Build a strength program', exact: true }).getByText('Practice Athlete', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
  await page.getByRole('button', { name: 'Build practice draft' }).click()
  await expect(page.getByRole('button', { name: 'Use these starting targets' })).toBeVisible()
  const publication = page.waitForResponse(response => response.request().method() === 'GET'
    && /\/api\/training\/programs\/[^/]+$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Use these starting targets' }).click()
  const stored = await publication
  expect(stored.ok()).toBe(true)
  const assignmentId = new URL(stored.url()).pathname.split('/').at(-1)!
  const readWorkspace = async (cursor: string | null = null) => {
    const response = await page.request.get(`/api/training/programs/${assignmentId}/workspace?view=program&limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    expect(response.ok()).toBe(true)
    return TrainingProgramWorkspaceProjectionSchema.parse(await response.json())
  }
  const before = await readWorkspace()
  const bouts = before.sessions.filter(session => session.kind === 'conditioning')
  expect(bouts.length).toBeGreaterThanOrEqual(4)
  for (const bout of bouts.slice(0, 2)) {
    await page.goto(`/workouts?training_session_id=${bout.sessionId}`)
    await page.getByRole('button', { name: 'Start session', exact: true }).click()
    await page.getByRole('combobox', { name: 'Perceived effort', exact: true }).selectOption('4')
    const initialMinutes = Number(await page.getByLabel('Actual duration in minutes', { exact: true }).inputValue())
    if (bout.sessionId === bouts[0].sessionId) {
      await page.getByLabel('Additional seconds', { exact: true }).fill('5')
    }
    await page.getByRole('button', { name: 'Save conditioning', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Conditioning saved', exact: true })).toBeVisible()
    if (bout.sessionId === bouts[0].sessionId) {
      const saved = await page.request.get(`/api/training/sessions/${bout.sessionId}`)
      expect(saved.ok()).toBe(true)
      expect((await saved.json()).currentConditioningActual.durationSeconds).toBe(initialMinutes * 60 + 5)
      await page.reload()
      await expect(page.getByLabel('Additional seconds', { exact: true })).toHaveValue('5')
      await expect(page.getByLabel('Actual duration in minutes', { exact: true })).toHaveValue(String(initialMinutes))
      await page.getByLabel('Additional seconds', { exact: true }).fill('0')
      await page.getByRole('button', { name: 'Correct saved conditioning', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Conditioning saved', exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Finish session', exact: true }).click()
    await expect(page.getByText(/This session is completed\./)).toBeVisible()
    if (bout.sessionId === bouts[0].sessionId) {
      const review = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/training/conditioning/progression/proposals')
      await page.getByRole('button', { name: 'Review conditioning targets', exact: true }).click()
      const result = await review
      expect(result.status()).toBe(200)
      expect(await result.json()).toMatchObject({ result: { kind: 'insufficient_history' } })
      await expect(page.getByText('Complete two comparable conditioning sessions before reviewing an increase. Your current targets remain in place.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Accept conditioning targets', exact: true })).toHaveCount(0)
    }
  }
  await page.getByRole('button', { name: 'Review conditioning targets', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept conditioning targets', exact: true })).toBeVisible()
  await expect(page.getByText(/This suggestion uses a sample policy/)).toBeVisible()
  const requestBodies: string[] = []
  await page.route('**/api/training/conditioning/progression/proposals/*/accept', async route => {
    requestBodies.push(route.request().postData()!)
    if (requestBodies.length === 1) {
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Accept conditioning targets', exact: true }).click()
  await page.getByRole('button', { name: 'Retry conditioning acceptance', exact: true }).click()
  await expect(page.getByText('Conditioning targets accepted for the two upcoming bouts.')).toBeVisible()
  expect(requestBodies).toHaveLength(2)
  expect(requestBodies[1]).toBe(requestBodies[0])
  const after = await readWorkspace()
  for (const bout of bouts.slice(0, 2)) {
    const saved = after.sessions.find(session => session.sessionId === bout.sessionId)!
    expect(saved.state).toBe('completed')
    expect(saved.planned).toEqual(bout.planned)
  }
  for (const bout of bouts.slice(2, 4)) {
    const updated = after.sessions.find(session => session.sessionId === bout.sessionId)!
    expect(updated.planned).not.toEqual(bout.planned)
    expect(updated.state).toBe('scheduled')
  }
  // At the end of the authored cycle there is no future target to change.
  let finalPage = after
  for (let pageNumber = 0; finalPage.nextCursor && pageNumber < 5; pageNumber += 1) {
    finalPage = await readWorkspace(finalPage.nextCursor)
  }
  expect(finalPage.nextCursor).toBeNull()
  const finalBout = finalPage.sessions.filter(session => session.kind === 'conditioning').at(-1)!
  expect(finalBout).toBeTruthy()
  await page.goto(`/workouts?training_session_id=${finalBout.sessionId}`)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  await page.getByRole('combobox', { name: 'Perceived effort', exact: true }).selectOption('4')
  await page.getByRole('button', { name: 'Save conditioning', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Conditioning saved', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Finish session', exact: true }).click()
  await expect(page.getByText(/This session is completed\./)).toBeVisible()
  const finalReview = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/conditioning/progression/proposals')
  await page.getByRole('button', { name: 'Review conditioning targets', exact: true }).click()
  const finalResult = await finalReview
  expect(finalResult.status()).toBe(200)
  expect(await finalResult.json()).toMatchObject({ result: { kind: 'no_pending_targets' } })
  await expect(page.getByText('No later conditioning targets are waiting. Nothing was changed.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept conditioning targets', exact: true })).toHaveCount(0)
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})
