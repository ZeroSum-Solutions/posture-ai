import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse, type Response } from '@playwright/test'
import { TrainingPreviousPerformanceV1Schema } from '../lib/training/contracts/previous-performance'
import { TrainingProgramRevisionV1Schema } from '../lib/training/contracts/program'
import {
  TrainingProgressionAcceptanceV1Schema,
  TrainingProgressionProjectionV1Schema,
} from '../lib/training/contracts/progression'
import type { TrainingSessionProjection } from '../app/workouts/_strength/TrainingSessionPlayer.gateway'
import {
  SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
  SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
} from '../lib/training/catalog/syntheticBodyweightAssistance'

async function body<T = Record<string, unknown>>(response: APIResponse | Response): Promise<T> {
  const data: unknown = await response.json()
  expect(response.ok(), JSON.stringify(data)).toBeTruthy()
  return data as T
}

async function recordCompletedSession(
  request: APIRequestContext,
  sessionId: string,
) {
  await body(await request.post(`/api/training/sessions/${sessionId}/start`, {
    data: { expectedRevision: 1 },
  }))
  let current = await body<TrainingSessionProjection>(
    await request.get(`/api/training/sessions/${sessionId}`),
  )
  if (!current.prescription || current.prescription.schemaVersion !== 'training-session-prescription.v1') {
    throw new Error('Expected a started strength prescription')
  }
  for (const exercise of current.prescription.exercises) {
    if (!exercise.progression) throw new Error('Expected immutable progression identity')
    for (const setId of exercise.setIds) {
      await body(await request.put(`/api/training/sessions/${sessionId}/sets/${setId}`, {
        data: {
          requestId: randomUUID(),
          expectedRevision: current.session.revision,
          actual: {
            quantity: exercise.acceptedInitialLoad.quantity,
            reps: exercise.repRange.minimum,
            rir: exercise.targetRir.maximum,
            side: exercise.progression.side,
            symptomState: 'none',
            occurredAt: new Date().toISOString(),
          },
        },
      }))
      current = await body<TrainingSessionProjection>(
        await request.get(`/api/training/sessions/${sessionId}`),
      )
      if (!current.prescription || current.prescription.schemaVersion !== 'training-session-prescription.v1') {
        throw new Error('Strength prescription became unavailable while logging')
      }
    }
  }
  await body(await request.post(`/api/training/sessions/${sessionId}/complete`, {
    data: {
      requestId: randomUUID(),
      expectedRevision: current.session.revision,
      finishMode: 'complete',
    },
  }))
  return body<TrainingSessionProjection>(await request.get(`/api/training/sessions/${sessionId}`))
}

test('fixed practice fixture preserves bodyweight and assistance through rep-only progression and history', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/workouts')
  await page.getByRole('combobox', { name: 'Sample program', exact: true })
    .selectOption('bodyweight-assistance')
  const setupResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/simulation/setup'
    && new URL(response.url()).searchParams.get('catalog') === 'bodyweight-assistance'
  ))
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  expect((await setupResponse).ok()).toBe(true)
  await expect(page.getByRole('region', { name: 'Build a strength program', exact: true })
    .getByText('Practice Athlete', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
  await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: '8-week draft', exact: true })).toBeVisible()
  await expect(page.getByRole('option', {
    name: '0 kg · bodyweight only', exact: true,
  }).first()).toBeAttached()
  await expect(page.getByRole('option', {
    name: '10 kg · assistance from the machine', exact: true,
  })).toBeAttached()

  const programResponse = page.waitForResponse(response => (
    response.request().method() === 'GET'
    && /\/api\/training\/programs\/[^/]+$/.test(new URL(response.url()).pathname)
  ))
  await page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
  const stored = await programResponse
  expect(stored.ok()).toBe(true)
  const storedBody = await stored.json() as { program: unknown }
  const program = TrainingProgramRevisionV1Schema.parse(storedBody.program)
  const assignmentId = program.assignmentId
  expect(program.executionContext).toMatchObject({
    kind: 'synthetic_simulation',
    fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
    fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
    label: 'Practice data',
  })

  const first = program.sessions[0]
  const completed = await recordCompletedSession(page.request, first.sessionId)
  if (!completed.prescription || completed.prescription.schemaVersion !== 'training-session-prescription.v1') {
    throw new Error('Expected a completed strength prescription')
  }
  const bodyweight = completed.prescription.exercises.find(exercise => (
    exercise.acceptedInitialLoad.loadBasis === 'bodyweight_external'
  ))
  const assistance = completed.prescription.exercises.find(exercise => (
    exercise.acceptedInitialLoad.loadBasis === 'machine_assistance'
  ))
  if (!bodyweight || !assistance) throw new Error('Expected both dedicated load bases')
  expect(bodyweight.acceptedInitialLoad).toMatchObject({
    quantity: { entered: { value: '0', unit: 'kg' } },
    bodyweightAssistancePolicy: SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
  })
  expect(assistance.acceptedInitialLoad).toMatchObject({
    quantity: { entered: { value: '10', unit: 'kg' } },
    bodyweightAssistancePolicy: SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
  })

  await page.goto(`/workouts?training_session_id=${encodeURIComponent(first.sessionId)}`)
  await expect(page.getByText(/Prescribed: 0 kg added externally · bodyweight only/).first()).toBeVisible()
  await expect(page.getByText(/Prescribed: 10 kg assistance from the machine/)).toBeVisible()
  const proposalResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/training/progression/proposals'
  ))
  await page.getByRole('button', { name: 'Review next target', exact: true }).first().click()
  const proposalHttp = await proposalResponse
  expect(proposalHttp.ok()).toBe(true)
  const proposal = TrainingProgressionProjectionV1Schema.parse(await proposalHttp.json())
  expect(proposal.result).toMatchObject({
    kind: 'proposal',
    executionContext: program.executionContext,
    decision: {
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      kind: 'rep_proposal',
      reason: 'one_rep_progression',
      loadChange: 'none',
      preservedLoad: {
        loadBasis: 'bodyweight_external',
        externalLoad: bodyweight.acceptedInitialLoad.quantity,
      },
    },
  })
  await expect(page.getByText('Practice data · Simulation', { exact: true }).last()).toBeVisible()
  await expect(page.getByText(/Add one rep while keeping the same load setting\./)).toBeVisible()

  const acceptanceResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && /\/api\/training\/progression\/proposals\/[^/]+\/accept$/.test(new URL(response.url()).pathname)
  ))
  await page.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
  const acceptedResponse = await acceptanceResponse
  const accepted = TrainingProgressionAcceptanceV1Schema.parse(await body(acceptedResponse))
  const retry = await body(await page.request.post(acceptedResponse.url(), {
    data: acceptedResponse.request().postDataJSON(),
  }))
  expect(retry).toEqual(accepted)
  await expect(page.getByText('Suggestion accepted for the next target.', { exact: true })).toBeVisible()

  const assistanceProposalResponse = await page.request.post('/api/training/progression/proposals', {
    data: { sessionId: first.sessionId, exerciseInstanceId: assistance.exerciseInstanceId },
  })
  expect(assistanceProposalResponse.ok()).toBe(true)
  const assistanceProposal = TrainingProgressionProjectionV1Schema.parse(
    await assistanceProposalResponse.json(),
  )
  expect(assistanceProposal.result).toMatchObject({
    kind: 'proposal',
    executionContext: program.executionContext,
    decision: {
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      kind: 'rep_proposal',
      loadChange: 'none',
      preservedLoad: {
        loadBasis: 'machine_assistance',
        assistance: assistance.acceptedInitialLoad.quantity,
      },
    },
  })
  const assistanceAccepted = TrainingProgressionAcceptanceV1Schema.parse(await body(await page.request.post(
    `/api/training/progression/proposals/${assistanceProposal.result.proposalId}/accept`,
    { data: { requestId: randomUUID() } },
  )))

  const latestProgramResponse = await page.request.get(
    `/api/training/programs/${encodeURIComponent(assignmentId)}`,
  )
  const latestProgram = TrainingProgramRevisionV1Schema.parse(
    (await body<{ program: unknown }>(latestProgramResponse)).program,
  )
  expect(assistanceAccepted.targetSessionId).toBe(accepted.targetSessionId)
  await body(await page.request.post(
    `/api/training/sessions/${encodeURIComponent(accepted.targetSessionId)}/start`,
    { data: { expectedRevision: 1 } },
  ))

  for (const { completedExercise, acceptance } of [
    { completedExercise: bodyweight, acceptance: accepted },
    { completedExercise: assistance, acceptance: assistanceAccepted },
  ]) {
    const progression = completedExercise.progression
    if (!progression) throw new Error('Expected immutable progression identity')
    const targetSession = latestProgram.sessions.find(session => (
      session.sessionId === acceptance.targetSessionId
    ))
    const targetExercise = targetSession?.exercises.find(exercise => (
      exercise.exerciseInstanceId === acceptance.targetExerciseInstanceId
    ))
    expect(targetExercise?.progression).toMatchObject({
      progressionSeriesId: progression.progressionSeriesId,
      loadEpoch: progression.loadEpoch,
    })
    expect(targetExercise?.acceptedInitialLoad).toMatchObject({
      loadBasis: completedExercise.acceptedInitialLoad.loadBasis,
      quantity: completedExercise.acceptedInitialLoad.quantity,
      bodyweightAssistancePolicy:
        completedExercise.acceptedInitialLoad.bodyweightAssistancePolicy,
    })
    const historyResponse = await page.request.get(
      `/api/training/sessions/${encodeURIComponent(acceptance.targetSessionId)}`
      + `/exercises/${encodeURIComponent(acceptance.targetExerciseInstanceId)}/previous-performance`,
    )
    const history = TrainingPreviousPerformanceV1Schema.parse(await historyResponse.json())
    expect(history.result.kind).toBe('available')
    if (history.result.kind !== 'available') throw new Error('Expected comparable practice history')
    expect(history.result.source.bodyweightAssistancePolicy).toEqual(
      completedExercise.acceptedInitialLoad.bodyweightAssistancePolicy,
    )
    expect(history.result.sets.every(set => (
      set.load.basis === completedExercise.acceptedInitialLoad.loadBasis
      && set.load.quantity.entered.value
        === completedExercise.acceptedInitialLoad.quantity.entered.value
    ))).toBe(true)
  }
})
