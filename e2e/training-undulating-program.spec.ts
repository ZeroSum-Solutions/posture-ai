import { test, expect, type APIResponse, type Response } from '@playwright/test'
import { AthleteTrainingProfileV1Schema } from '../lib/training/contracts/profile'
import { TrainingProgramRevisionV1Schema } from '../lib/training/contracts/program'

async function body(response: APIResponse | Response) {
  const value = await response.json()
  expect(response.ok(), JSON.stringify(value)).toBeTruthy()
  return value
}

test('saved intermediate profile produces independently accepted heavy and volume prescriptions', async ({ request }) => {
  test.setTimeout(120_000)
  const setup = await body(await request.post('/api/training/simulation/setup'))
  const profileUrl = `/api/training/profile?subjectId=${setup.subjectId}`
  const current = (await body(await request.get(profileUrl))).current
  const profile = AthleteTrainingProfileV1Schema.parse(current.profile)
  const savedProjection = await body(await request.patch(profileUrl, { data: {
    expectedRevision: current.revision,
    profile: { ...profile, experience: 'intermediate', strengthProgrammingStyle: 'intermediate_undulating', cycleLengthWeeks: 4, sessionTimeBudgetMinutes: 45 },
  } }))
  const saved = savedProjection.current
  try {
    expect(saved.profile.strengthProgrammingStyle).toBe('intermediate_undulating')
    const build = await body(await request.post('/api/training/programs/builds', { data: {
      subjectId: setup.subjectId, profileRevision: saved.revision, cycleStartLocalDate: '2026-09-14',
    } }))
    expect(build.result.strengthProgrammingStyle).toBe('intermediate_undulating')
    expect(build.result.strengthTemplate.provenance.kind).toBe('synthetic_fixture')
    expect(build.calibrations).toHaveLength(8)
    const loadChoices = build.calibrations.map((item: { exposureType: string; calibration: { exerciseInstanceId: string; options: unknown[] } }) => ({
      exerciseInstanceId: item.calibration.exerciseInstanceId,
      optionIndex: item.exposureType === 'volume' && item.calibration.options.length > 1 ? 1 : 0,
    }))
    const conditioning = new Map<string, { boutId: string; acceptedDurationSeconds: number }>()
    for (const week of build.result.weeks) for (const bout of week.conditioningBouts) {
      const key = `${bout.weekday}:${bout.modalityId}`
      if (!conditioning.has(key)) conditioning.set(key, { boutId: bout.boutId, acceptedDurationSeconds: 600 })
    }
    const selection = { loadChoices, conditioningChoices: [...conditioning.values()] }
    const accepted = await body(await request.post(`/api/training/programs/builds/${build.buildId}/accept`, { data: selection }))
    expect((await body(await request.post(`/api/training/programs/builds/${build.buildId}/accept`, { data: selection }))).draftId).toBe(accepted.draftId)
    const publication = await body(await request.post('/api/training/programs/publish', { data: { draftId: accepted.draftId } }))
    const loaded = await body(await request.get(`/api/training/programs/${publication.assignmentId}`))
    const program = TrainingProgramRevisionV1Schema.parse(loaded.program)
    expect(program.strengthTemplate).toEqual(build.result.strengthTemplate)
    expect(program.cycleLengthWeeks).toBe(4)
    for (const session of program.sessions) for (const exercise of session.exercises) {
      const track = exercise.progression?.exposureType
      expect(['heavy', 'volume']).toContain(track)
      expect(exercise.progression?.progressionSeriesId.endsWith(`:${track}`)).toBe(true)
      const offer = build.calibrations.find((item: { progressionSeriesId: string }) => item.progressionSeriesId === exercise.progression?.progressionSeriesId)
      const choice = loadChoices.find((item: { exerciseInstanceId: string }) => item.exerciseInstanceId === offer.calibration.exerciseInstanceId)
      expect(exercise.acceptedInitialLoad.quantity).toEqual(offer.calibration.options[choice.optionIndex].quantity)
      expect(exercise.repRange).toEqual(track === 'heavy' ? program.strengthTemplate?.heavy.repRange : program.strengthTemplate?.volume.repRange)
    }
    const first = program.sessions[0]
    await body(await request.post(`/api/training/sessions/${first.sessionId}/start`, { data: { expectedRevision: 1 } }))
    const started = await body(await request.get(`/api/training/sessions/${first.sessionId}`))
    expect(started.prescription.exercises).toEqual(first.exercises)
    expect(started.prescription.programRevisionNumber).toBe(program.revisionNumber)
  } finally {
    // The sample is reusable; restore only the profile revision this test wrote.
    await body(await request.patch(profileUrl, { data: { expectedRevision: saved.revision, profile } }))
  }

})

test('intermediate programming and separate load cards are usable at mobile and desktop widths', async ({ page, request }) => {
  test.setTimeout(90_000)
  const setup = await body(await request.post('/api/training/simulation/setup'))
  const profileUrl = `/api/training/profile?subjectId=${setup.subjectId}`
  const original = (await body(await request.get(profileUrl))).current
  let savedRevision: number | null = null
  try {
    await page.goto('/workouts')
    await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
    await page.getByRole('combobox', { name: 'Experience', exact: true }).selectOption('intermediate')
    await page.getByRole('combobox', { name: 'Strength programming', exact: true }).selectOption('intermediate_undulating')
    await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
    await page.getByRole('button', { name: '4 weeks Available', exact: true }).click()
    await page.getByRole('combobox', { name: 'Session time budget', exact: true }).selectOption('45')
    const save = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/api/training/profile')
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    savedRevision = (await body(await save)).current.revision
    await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
    await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
    await expect(page.getByRole('heading', { name: '4-week draft', exact: true })).toBeVisible()
    await expect(page.getByText('Heavy session · separate starting load and progression', { exact: true })).toHaveCount(4)
    await expect(page.getByText('Volume session · separate starting load and progression', { exact: true })).toHaveCount(4)
    const loads = page.getByRole('combobox', { name: 'Starting load', exact: true })
    await expect(loads).toHaveCount(8)
    await loads.first().selectOption('1')
    await expect(loads.first()).toHaveValue('1')
    await expect(loads.nth(1)).toHaveValue('0')
    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.width)
      await loads.last().scrollIntoViewIfNeeded()
      await expect(loads.last()).toBeVisible()
    }
  } finally {
    if (savedRevision !== null) await body(await request.patch(profileUrl, {
      data: { expectedRevision: savedRevision, profile: original.profile },
    }))
  }
})
