import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  ConditioningRevisionAcceptanceV1Schema,
  ConditioningRevisionOptionsV1Schema,
  ConditioningRevisionProposalProjectionV1Schema,
  type ConditioningRevisionAcceptanceV1,
  type ConditioningRevisionOptionsV1,
} from '../lib/training/contracts/conditioning-revision'
import {
  TrainingProgramWorkspaceProjectionSchema,
  type TrainingProgramWorkspaceProjection,
  type TrainingProgramWorkspaceSession,
} from '../lib/training/contracts/program-workspace'

const CONDITIONING_FIXTURE_ID = 'synthetic-conditioning-journey-catalog.v1'
const CONDITIONING_FIXTURE_HASH = 'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e'
const WALKING_ID = 'synthetic-continuous-walking.v1'
const CYCLING_ID = 'synthetic-stationary-cycling.v1'

type Options = Extract<ConditioningRevisionOptionsV1['result'], { kind: 'options' }>

async function readProgram(
  request: APIRequestContext,
  assignmentId: string,
): Promise<{ assignment: TrainingProgramWorkspaceProjection['assignment']; sessions: TrainingProgramWorkspaceSession[] }> {
  const sessions: TrainingProgramWorkspaceSession[] = []
  let cursor: string | null = null
  let assignment: TrainingProgramWorkspaceProjection['assignment'] | null = null
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const query = new URLSearchParams({ view: 'program', limit: '24' })
    if (cursor) query.set('cursor', cursor)
    const response = await request.get(`/api/training/programs/${encodeURIComponent(assignmentId)}/workspace?${query}`)
    expect(response.ok()).toBe(true)
    const projection = TrainingProgramWorkspaceProjectionSchema.parse(await response.json())
    expect(projection.assignment.assignmentId).toBe(assignmentId)
    assignment ??= projection.assignment
    sessions.push(...projection.sessions)
    cursor = projection.nextCursor
    if (!cursor) return { assignment, sessions }
  }
  throw new Error('Conditioning program pagination did not terminate')
}

async function readOptions(request: APIRequestContext, assignmentId: string): Promise<Options> {
  const response = await request.get(`/api/training/conditioning/revisions?assignmentId=${encodeURIComponent(assignmentId)}`)
  expect(response.ok()).toBe(true)
  const projection = ConditioningRevisionOptionsV1Schema.parse(await response.json())
  expect(projection.result.kind).toBe('options')
  if (projection.result.kind !== 'options') throw new Error('Conditioning revision options are unavailable')
  expect(projection.result.assignmentId).toBe(assignmentId)
  return projection.result
}

async function recordConditioning(
  page: Page,
  sessionId: string,
  seconds: number,
  finish: boolean,
) {
  await page.goto(`/workouts?training_session_id=${encodeURIComponent(sessionId)}`)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  await page.getByLabel('Actual duration in minutes', { exact: true }).fill('10')
  await page.getByLabel('Additional seconds', { exact: true }).fill(String(seconds))
  await page.getByRole('combobox', { name: 'Perceived effort', exact: true }).selectOption('4')
  await page.getByRole('button', { name: 'Save conditioning', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Conditioning saved', exact: true })).toBeVisible()
  const saved = await page.request.get(`/api/training/sessions/${encodeURIComponent(sessionId)}`)
  expect(saved.ok()).toBe(true)
  expect((await saved.json()).currentConditioningActual.durationSeconds).toBe(600 + seconds)
  if (!finish) return
  await page.getByRole('button', { name: 'Finish session', exact: true }).click()
  await expect(page.getByText(/This session is completed\./)).toBeVisible()
}

async function preview(page: Page) {
  const responsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/conditioning/revisions/proposals'
  ))
  await page.getByRole('button', { name: 'Preview conditioning changes', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  return ConditioningRevisionProposalProjectionV1Schema.parse(await response.json())
}

async function acceptAndConfirmPersisted(page: Page): Promise<ConditioningRevisionAcceptanceV1> {
  const responsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && /\/api\/training\/conditioning\/revisions\/proposals\/[^/]+\/accept$/.test(new URL(response.url()).pathname)
  ))
  await page.getByRole('button', { name: 'Accept conditioning revision', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const receipt = ConditioningRevisionAcceptanceV1Schema.parse(await response.json())
  const requestBody = response.request().postDataJSON()
  const exactRetry = await page.request.post(response.url(), { data: requestBody })
  expect(exactRetry.ok()).toBe(true)
  expect(ConditioningRevisionAcceptanceV1Schema.parse(await exactRetry.json())).toEqual(receipt)
  await expect(page.getByRole('status').filter({ hasText: `Conditioning changes saved as program revision ${receipt.programRevisionNumber}.` })).toBeVisible()
  return receipt
}

function sameWeekStrengthDate(
  sessions: readonly TrainingProgramWorkspaceSession[],
  boutId: string,
) {
  const bout = sessions.find(session => session.sessionId === boutId)
  if (!bout) throw new Error(`Missing conditioning bout ${boutId}`)
  const strength = sessions.find(session => (
    session.kind === 'strength'
    && session.weekNumber === bout.weekNumber
    && session.scheduledLocalDate !== bout.scheduledLocalDate
  ))
  if (!strength) throw new Error(`Missing same-week strength collision for ${boutId}`)
  return strength.scheduledLocalDate
}

test('revises future conditioning with explicit activity, duration, and schedule evidence boundaries', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/workouts')
  await page.getByRole('combobox', { name: 'Sample program', exact: true }).selectOption('conditioning')
  const setupResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/simulation/setup'
    && new URL(response.url()).searchParams.get('catalog') === 'conditioning'
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
    name: 'Choose each weekly starting duration',
    exact: true,
  })).toBeVisible()
  await expect(page.getByText('2 weekly slots', { exact: true })).toBeVisible()

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

  const initial = await readProgram(page.request, assignmentId)
  const initialBouts = initial.sessions.filter(session => session.kind === 'conditioning')
  expect(initialBouts.length).toBeGreaterThanOrEqual(6)
  await recordConditioning(page, initialBouts[0].sessionId, 7, true)
  await recordConditioning(page, initialBouts[1].sessionId, 11, true)
  await recordConditioning(page, initialBouts[2].sessionId, 13, false)

  const beforeRevision = await readProgram(page.request, assignmentId)
  const protectedIds = initialBouts.slice(0, 3).map(session => session.sessionId)
  const protectedSessions = new Map(protectedIds.map(id => [
    id,
    beforeRevision.sessions.find(session => session.sessionId === id)!,
  ]))
  expect(protectedSessions.get(protectedIds[0])?.state).toBe('completed')
  expect(protectedSessions.get(protectedIds[1])?.state).toBe('completed')
  expect(protectedSessions.get(protectedIds[2])?.state).toBe('in_progress')

  const originalOptions = await readOptions(page.request, assignmentId)
  expect(originalOptions.executionContext).toMatchObject({
    kind: 'synthetic_simulation',
    fixtureId: CONDITIONING_FIXTURE_ID,
    fixtureHash: CONDITIONING_FIXTURE_HASH,
  })
  expect(originalOptions.modalities.map(modality => [modality.modalityId, modality.label])).toEqual([
    [WALKING_ID, 'Synthetic continuous walking'],
    [CYCLING_ID, 'Synthetic stationary cycling'],
  ])
  expect(originalOptions.changeableBouts.every(bout => !protectedIds.includes(bout.boutId))).toBe(true)

  await page.goto(`/workouts?training_program_id=${encodeURIComponent(assignmentId)}`)
  await page.getByRole('tab', { name: 'Program', exact: true }).click()
  await page.getByText('Change conditioning activity or schedule', { exact: true }).click()
  const form = page.getByRole('form', { name: 'Edit future conditioning' })
  await expect(form).toBeVisible()
  const activity = form.getByRole('combobox', { name: 'Activity', exact: true })
  const minuteInputs = form.getByRole('textbox', { name: 'Minutes', exact: true })
  const secondInputs = form.getByRole('textbox', { name: 'Additional seconds', exact: true })
  for (let index = 0; index < originalOptions.changeableBouts.length; index += 1) {
    const duration = originalOptions.changeableBouts[index].acceptedDurationSeconds
    await expect(minuteInputs.nth(index)).toHaveValue(String(Math.floor(duration / 60)))
    await expect(secondInputs.nth(index)).toHaveValue(String(duration % 60))
  }
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
    await expect(activity).toBeVisible()
    await expect(form.getByRole('button', { name: 'Preview conditioning changes', exact: true })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  }

  const firstSourceBout = originalOptions.changeableBouts[0]
  const dateInputs = form.getByRole('textbox', { name: 'Date', exact: true })
  await dateInputs.first().fill(sameWeekStrengthDate(beforeRevision.sessions, firstSourceBout.boutId))
  const initialConflict = await preview(page)
  expect(initialConflict.revision.result.kind).toBe('reschedule_required')
  if (initialConflict.revision.result.kind !== 'reschedule_required') throw new Error('Expected a schedule conflict')
  const conflict = initialConflict.revision.result.conflicts.find(item => item.sourceBoutId === firstSourceBout.boutId)
  expect(conflict?.reason).toBe('strength_date_requires_arrangement')
  expect(conflict?.offDayAlternatives.length).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'Choose another schedule', exact: true })).toBeVisible()
  await expect(page.getByText(/Available off days:/).first()).toBeVisible()
  await dateInputs.first().fill(conflict!.offDayAlternatives[0])

  await activity.selectOption(CYCLING_ID)
  const resetDurations = new Map<string, number>()
  for (let index = 0; index < originalOptions.changeableBouts.length; index += 1) {
    const seconds = 600 + index
    resetDurations.set(originalOptions.changeableBouts[index].boutId, seconds)
    await minuteInputs.nth(index).fill('10')
    await secondInputs.nth(index).fill(String(index))
  }
  const resetProjection = await preview(page)
  expect(resetProjection.revision.result.kind).toBe('revision_ready')
  if (resetProjection.revision.result.kind !== 'revision_ready') throw new Error('Expected a conditioning revision')
  expect(resetProjection.revision.result.replacements).not.toHaveLength(0)
  expect(resetProjection.revision.result.replacements.every(replacement => (
    replacement.priorModalityId === WALKING_ID
    && replacement.modalityId === CYCLING_ID
    && replacement.evidenceBoundary.kind === 'reset'
    && replacement.evidenceBoundary.reason === 'modality_changed'
  ))).toBe(true)
  await expect(page.getByRole('region', { name: 'Conditioning revision preview' })).toContainText(
    'Synthetic continuous walking → Synthetic stationary cycling',
  )
  await expect(page.getByText(/starts a new evidence window/)).toBeVisible()
  const resetReceipt = await acceptAndConfirmPersisted(page)
  expect(resetReceipt.evidenceBoundary).toBe('reset')
  expect(resetReceipt.programRevisionNumber).toBe(initial.assignment.revisionNumber + 1)

  await page.reload()
  await page.getByRole('tab', { name: 'Program', exact: true }).click()
  const afterReset = await readProgram(page.request, assignmentId)
  for (const [id, preserved] of protectedSessions) {
    expect(afterReset.sessions.find(session => session.sessionId === id)).toEqual(preserved)
  }
  for (const boutId of resetReceipt.affectedBoutIds) {
    const session = afterReset.sessions.find(candidate => candidate.sessionId === boutId)
    expect(session?.state).toBe('scheduled')
    expect(session?.planned).toMatchObject({
      kind: 'conditioning',
      label: 'Synthetic stationary cycling',
      durationSeconds: resetDurations.get(boutId),
    })
  }

  await page.getByText('Change conditioning activity or schedule', { exact: true }).click()
  const currentOptions = await readOptions(page.request, assignmentId)
  const currentForm = page.getByRole('form', { name: 'Edit future conditioning' })
  await expect(currentForm).toBeVisible()
  const currentDates = currentForm.getByRole('textbox', { name: 'Date', exact: true })
  const currentMinutes = currentForm.getByRole('textbox', { name: 'Minutes', exact: true })
  const currentSeconds = currentForm.getByRole('textbox', { name: 'Additional seconds', exact: true })
  for (let index = 0; index < currentOptions.changeableBouts.length; index += 1) {
    const duration = currentOptions.changeableBouts[index].acceptedDurationSeconds
    await expect(currentMinutes.nth(index)).toHaveValue(String(Math.floor(duration / 60)))
    await expect(currentSeconds.nth(index)).toHaveValue(String(duration % 60))
  }
  const scheduleBout = currentOptions.changeableBouts[0]
  await currentDates.first().fill(sameWeekStrengthDate(afterReset.sessions, scheduleBout.boutId))
  const scheduleConflict = await preview(page)
  expect(scheduleConflict.revision.result.kind).toBe('reschedule_required')
  if (scheduleConflict.revision.result.kind !== 'reschedule_required') throw new Error('Expected a schedule-only conflict')
  const scheduleResolution = scheduleConflict.revision.result.conflicts.find(item => item.sourceBoutId === scheduleBout.boutId)
  expect(scheduleResolution?.offDayAlternatives.length).toBeGreaterThan(0)
  const resolvedDate = scheduleResolution!.offDayAlternatives.find(date => date !== scheduleBout.scheduledLocalDate)
  expect(resolvedDate).toBeDefined()
  if (!resolvedDate) throw new Error('Expected a different available date for the schedule revision')
  await currentDates.first().fill(resolvedDate)
  const preservedProjection = await preview(page)
  expect(preservedProjection.revision.result.kind).toBe('revision_ready')
  if (preservedProjection.revision.result.kind !== 'revision_ready') throw new Error('Expected a schedule-only revision')
  expect(preservedProjection.revision.result.replacements).toHaveLength(currentOptions.changeableBouts.length)
  expect(preservedProjection.revision.result.replacements.filter(replacement => (
    replacement.scheduledLocalDate !== replacement.priorScheduledLocalDate
  ))).toHaveLength(1)
  expect(preservedProjection.revision.result.replacements.every(replacement => replacement.evidenceBoundary.kind === 'preserved')).toBe(true)
  expect(preservedProjection.revision.result.replacements.find(replacement => replacement.sourceBoutId === scheduleBout.boutId)).toMatchObject({
    sourceBoutId: scheduleBout.boutId,
    modalityId: CYCLING_ID,
    acceptedDurationSeconds: scheduleBout.acceptedDurationSeconds,
    scheduledLocalDate: resolvedDate,
    evidenceBoundary: { kind: 'preserved' },
  })
  await expect(page.getByText(/Comparable evidence remains connected/)).toBeVisible()
  const preservedReceipt = await acceptAndConfirmPersisted(page)
  expect(preservedReceipt.evidenceBoundary).toBe('preserved')
  expect(preservedReceipt.programRevisionNumber).toBe(resetReceipt.programRevisionNumber + 1)

  await page.reload()
  await page.getByRole('tab', { name: 'Program', exact: true }).click()
  const afterSchedule = await readProgram(page.request, assignmentId)
  for (const [id, preserved] of protectedSessions) {
    expect(afterSchedule.sessions.find(session => session.sessionId === id)).toEqual(preserved)
  }
  const rescheduled = afterSchedule.sessions.find(session => session.sessionId === scheduleBout.boutId)
  expect(rescheduled?.scheduledLocalDate).toBe(resolvedDate)
  expect(rescheduled?.planned).toMatchObject({
    kind: 'conditioning',
    label: 'Synthetic stationary cycling',
    durationSeconds: scheduleBout.acceptedDurationSeconds,
  })
})
