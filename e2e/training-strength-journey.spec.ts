import { randomUUID } from 'node:crypto'
import { test, expect, type APIResponse } from '@playwright/test'
import { skipForProductionReadiness } from './production-readiness-skip'

async function body(response: APIResponse) {
  const data = await response.json()
  expect(response.ok(), JSON.stringify(data)).toBeTruthy()
  return data
}

// Uses the real locally provisioned AAL2 practitioner from auth.setup; requests
// retain its cookies and traverse the actual route, RLS and transaction boundary.
test('original application persists a complete strength and conditioning journey', async ({ request, browserName }, testInfo) => {
  skipForProductionReadiness(
    testInfo,
    browserName === 'webkit',
    {
      key: 'skip:training-strength-journey-api:mobile-webkit',
      source: 'e2e/training-strength-journey.spec.ts::strength and conditioning API journey project guard',
      scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
    },
    'API transaction coverage runs once in Chromium; responsive UI has separate browser checks.',
  )
  test.setTimeout(120_000)
  const setup = await body(await request.post('/api/training/simulation/setup'))
  // Reopening the same sample is not another identity creation and must not exhaust its quota.
  for (let reopen = 0; reopen < 5; reopen += 1) {
    expect(await body(await request.post('/api/training/simulation/setup'))).toEqual(setup)
  }
  // The practice sample is shared by every spec that opens it, and several save
  // (then restore) its profile, which advances the revision. Reopening the
  // sample reports a fixed profileRevision of 1, so build from the current one.
  const profile = await body(await request.get(`/api/training/profile?subjectId=${encodeURIComponent(setup.subjectId)}`))
  const build = await body(await request.post('/api/training/programs/builds', {
    data: { subjectId: setup.subjectId, profileRevision: profile.current.revision, cycleStartLocalDate: '2026-09-08' },
  }))
  expect(build.result.kind).toBe('draft_program')
  expect(build.buildId).toBeTruthy()
  expect(build.calibrations).toHaveLength(4)
  const conditioningByDay = new Map<string, { boutId: string; acceptedDurationSeconds: number }>()
  for (const week of build.result.weeks) {
    for (const bout of week.conditioningBouts) {
      const weekday = new Date(`${bout.scheduledLocalDate}T12:00:00Z`).getUTCDay()
      const key = `${weekday}:${bout.modalityId}`
      if (!conditioningByDay.has(key)) conditioningByDay.set(key, {
        boutId: bout.boutId, acceptedDurationSeconds: bout.allowedDurationSeconds.minimum,
      })
    }
  }
  const selections = {
    loadChoices: build.calibrations.map((offer: { calibration: { exerciseInstanceId: string } }) => ({
      exerciseInstanceId: offer.calibration.exerciseInstanceId, optionIndex: 0,
    })),
    conditioningChoices: [...conditioningByDay.values()],
  }
  const accepted = await body(await request.post(`/api/training/programs/builds/${build.buildId}/accept`, { data: selections }))
  const retryAccepted = await body(await request.post(`/api/training/programs/builds/${build.buildId}/accept`, { data: selections }))
  expect(retryAccepted.draftId).toBe(accepted.draftId)
  const published = await body(await request.post('/api/training/programs/publish', { data: { draftId: accepted.draftId } }))
  const program = await body(await request.get(`/api/training/programs/${published.assignmentId}`))
  expect(program.program.executionContext.kind).toBe('synthetic_simulation')
  expect(program.program.sessions.length).toBeGreaterThanOrEqual(16)
  expect(program.program.conditioningBouts.length).toBeGreaterThanOrEqual(16)

  const sessionId = program.program.sessions[0].sessionId
  const scheduled = await body(await request.get(`/api/training/sessions/${sessionId}`))
  expect(scheduled.prescription).toBeNull()
  expect(scheduled.session.completed_at).toBeNull()
  expect(scheduled.executionContext).toEqual(program.program.executionContext)
  await body(await request.post(`/api/training/sessions/${sessionId}/start`, { data: { expectedRevision: 1 } }))
  let current = await body(await request.get(`/api/training/sessions/${sessionId}`))
  expect(current.executionContext).toEqual(scheduled.executionContext)
  expect(Object.keys(current.exerciseDisplay)).toHaveLength(4)
  expect(current.currentActuals).toEqual([])
  expect(current.session.completed_at).toBeNull()
  for (const exercise of current.prescription.exercises) {
    const authored = program.program.sessions[0].exercises.find(
      (item: { exerciseInstanceId: string }) => item.exerciseInstanceId === exercise.exerciseInstanceId,
    )
    expect(exercise.progression).toEqual(authored.progression)
    expect(exercise.progression.progressionSeriesId).toBeTruthy()
  }
  // Business conflicts must return promptly, not enter database serialization retries.
  const unloggedFinish = await request.post(`/api/training/sessions/${sessionId}/complete`, {
    timeout: 15_000,
    data: { requestId: randomUUID(), expectedRevision: current.session.revision, finishMode: 'complete' },
  })
  expect(unloggedFinish.status()).toBe(409)
  expect(await unloggedFinish.json()).toEqual({ error: 'training_completion_incomplete', action: 'log_remaining_or_finish_with_omissions' })
  for (const exercise of current.prescription.exercises) {
    for (const setId of exercise.setIds) {
      const mutation = {
        requestId: randomUUID(), expectedRevision: current.session.revision,
        actual: {
          quantity: exercise.acceptedInitialLoad.quantity, reps: exercise.repRange.minimum, rir: 3,
          side: 'bilateral', symptomState: 'none', occurredAt: new Date().toISOString(),
        },
      }
      const saved = await body(await request.put(`/api/training/sessions/${sessionId}/sets/${setId}`, { data: mutation }))
      const retried = await body(await request.put(`/api/training/sessions/${sessionId}/sets/${setId}`, { data: mutation }))
      expect(retried).toEqual(saved)
      current = await body(await request.get(`/api/training/sessions/${sessionId}`))
      expect(current.session.state).toBe('in_progress')
    }
  }
  const completed = await body(await request.post(`/api/training/sessions/${sessionId}/complete`, {
    data: { requestId: randomUUID(), expectedRevision: current.session.revision, finishMode: 'complete' },
  }))
  expect(completed.state).toBe('completed')
  const finished = await body(await request.get(`/api/training/sessions/${sessionId}`))
  expect(finished.session.completed_at).toBeTruthy()
  expect(Date.parse(finished.session.completed_at)).toBeGreaterThanOrEqual(Date.parse(current.session.updated_at))
  expect(finished.prescription).toEqual(current.prescription)
  const progression = await body(await request.post('/api/training/progression/proposals', {
    data: { sessionId, exerciseInstanceId: finished.prescription.exercises[0].exerciseInstanceId },
  }))
  expect(progression.schemaVersion).toBe('training-progression-projection.v1')
  expect(progression.result.kind).toBe('proposal')
  expect(progression.result.decision.kind).toBe('rep_proposal')
  expect(progression.result.decision.proposal.targetReps).toEqual(finished.prescription.exercises[0].setIds.map((_: string, index: number) => finished.prescription.exercises[0].repRange.minimum + (index === 0 ? 1 : 0)))
  const progressionRequest = { requestId: randomUUID() }
  const progressionAccepted = await body(await request.post(`/api/training/progression/proposals/${progression.result.proposalId}/accept`, { data: progressionRequest }))
  expect(progressionAccepted.programRevisionNumber).toBe(2)
  expect(await body(await request.post(`/api/training/progression/proposals/${progression.result.proposalId}/accept`, { data: progressionRequest }))).toEqual(progressionAccepted)
  const progressedProgram = await body(await request.get(`/api/training/programs/${published.assignmentId}`))
  const nextExercise = progressedProgram.program.sessions.find((item: { sessionId: string }) => item.sessionId === progression.result.target.sessionId).exercises.find((item: { exerciseInstanceId: string }) => item.exerciseInstanceId === progression.result.target.exerciseInstanceId)
  expect(nextExercise.targetReps).toEqual(progression.result.decision.proposal.targetReps)
  expect((await body(await request.get(`/api/training/sessions/${sessionId}`))).prescription).toEqual(finished.prescription)

  const boutId = program.program.conditioningBouts[0].boutId
  await body(await request.post(`/api/training/sessions/${boutId}/start`, { data: { expectedRevision: 1 } }))
  const conditioning = await body(await request.get(`/api/training/sessions/${boutId}`))
  expect(conditioning.session.session_kind).toBe('conditioning')
  expect(conditioning.conditioningDisplay.label).toContain('walking')
  const actualDuration = conditioning.prescription.acceptedBout.acceptedDurationSeconds - 30
  const savedConditioning = await body(await request.put(`/api/training/sessions/${boutId}/conditioning`, {
    data: {
      requestId: randomUUID(), expectedRevision: conditioning.session.revision,
      actual: { durationSeconds: actualDuration, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: new Date().toISOString() },
    },
  }))
  expect(savedConditioning.conditioningEvent.durationSeconds).toBe(actualDuration)
  expect(savedConditioning.state).toBe('in_progress')
  await body(await request.post(`/api/training/sessions/${boutId}/complete`, {
    data: { requestId: randomUUID(), expectedRevision: savedConditioning.revision, finishMode: 'complete' },
  }))
  const resumed = await body(await request.get(`/api/training/programs?subjectId=${setup.subjectId}`))
  const savedProgram = resumed.programs.find((item: { id: string }) => item.id === published.assignmentId)
  expect(savedProgram.sessions.find((item: { id: string }) => item.id === sessionId).state).toBe('completed')
  expect(savedProgram.sessions.find((item: { id: string }) => item.id === boutId).state).toBe('completed')
})
