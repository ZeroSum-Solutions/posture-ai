import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { ManualRecalibrationAcceptanceV1Schema, ManualRecalibrationProposalProjectionV1Schema } from '../lib/training/contracts/manual-recalibration-persistence'
import { TrainingProgramRevisionV1Schema } from '../lib/training/contracts/program'
import { expireExactUnacceptedCalibrationProposal } from './helpers/training-calibration-proposal-expiry'

async function body(response: Pick<APIResponse, 'json' | 'ok'>) {
  const result = await response.json()
  expect(response.ok(), JSON.stringify(result)).toBeTruthy()
  return result
}

async function completedSource(request: APIRequestContext, variant: 'starter' | 'bodyweight-assistance') {
  const setup = await body(await request.post(`/api/training/simulation/setup${variant === 'starter' ? '' : '?catalog=bodyweight-assistance'}`))
  const build = await body(await request.post('/api/training/programs/builds', { data: {
    subjectId: setup.subjectId, profileRevision: setup.profileRevision, cycleStartLocalDate: '2030-01-07',
  } }))
  expect(build.result.kind).toBe('draft_program')
  const conditioning = new Map<string, { boutId: string; acceptedDurationSeconds: number }>()
  for (const week of build.result.weeks) for (const bout of week.conditioningBouts) {
    const key = `${new Date(`${bout.scheduledLocalDate}T12:00:00Z`).getUTCDay()}:${bout.modalityId}`
    if (!conditioning.has(key)) conditioning.set(key, { boutId: bout.boutId, acceptedDurationSeconds: bout.allowedDurationSeconds.minimum })
  }
  const accepted = await body(await request.post(`/api/training/programs/builds/${build.buildId}/accept`, { data: {
    loadChoices: build.calibrations.map((item: { calibration: { exerciseInstanceId: string; loadBasis: string; options: unknown[] } }) => ({
      exerciseInstanceId: item.calibration.exerciseInstanceId,
      optionIndex: item.calibration.options.length > 1 ? 1 : 0,
    })),
    conditioningChoices: [...conditioning.values()],
  } }))
  const published = await body(await request.post('/api/training/programs/publish', { data: { draftId: accepted.draftId } }))
  const stored = await body(await request.get(`/api/training/programs/${published.assignmentId}`))
  const program = TrainingProgramRevisionV1Schema.parse(stored.program)
  const sessionId = program.sessions[0].sessionId
  await body(await request.post(`/api/training/sessions/${sessionId}/start`, { data: { expectedRevision: 1 } }))
  let source = await body(await request.get(`/api/training/sessions/${sessionId}`))
  const exercise = source.prescription.exercises.find((item: { acceptedInitialLoad: { loadBasis: string } }) => (
    item.acceptedInitialLoad.loadBasis === (variant === 'starter' ? 'dumbbell_single_implement' : 'machine_assistance')
  ))
  expect(exercise).toBeTruthy()
  for (const setId of exercise.setIds) {
    await body(await request.put(`/api/training/sessions/${sessionId}/sets/${setId}`, { data: {
      requestId: randomUUID(), expectedRevision: source.session.revision,
      actual: {
        quantity: exercise.acceptedInitialLoad.quantity, reps: exercise.repRange.minimum,
        rir: '6_plus', side: exercise.progression.side,
        symptomState: 'none', occurredAt: new Date().toISOString(),
      },
    } }))
    source = await body(await request.get(`/api/training/sessions/${sessionId}`))
  }
  await body(await request.post(`/api/training/sessions/${sessionId}/complete`, { data: {
    requestId: randomUUID(), expectedRevision: source.session.revision, finishMode: 'finish_with_omissions',
  } }))
  return { sessionId, exercise, program, assignmentId: published.assignmentId as string, sourcePrescription: source.prescription }
}

for (const variant of ['starter', 'bodyweight-assistance'] as const) {
  test(`explicit ${variant} recalibration renews after reload, survives a lost receipt, and preserves history`, async ({ page }) => {
    test.setTimeout(120_000)
    const source = await completedSource(page.request, variant)
    await page.goto(`/workouts?training_session_id=${encodeURIComponent(source.sessionId)}`)
    const sourceIndex = source.program.sessions[0].exercises.findIndex(exercise => exercise.exerciseInstanceId === source.exercise.exerciseInstanceId)
    await page.getByRole('button', { name: 'Review next target', exact: true }).nth(sourceIndex).click()
    await expect(page.getByRole('heading', { name: 'Recalibrate before changing the target' })).toBeVisible()
    const offeredResponse = page.waitForResponse(response => response.url().endsWith('/api/training/manual-recalibrations/proposals'))
    await page.getByRole('button', { name: 'Review starting settings', exact: true }).click()
    const offered = ManualRecalibrationProposalProjectionV1Schema.parse(await body(await offeredResponse))
    expect(offered.offer.kind).toBe('options')
    if (offered.offer.kind !== 'options') throw new Error('Expected harder familiarization settings')
    if (!offered.proposalId) throw new Error('Expected stored harder familiarization proposal')
    await expireExactUnacceptedCalibrationProposal({
      family: 'manual',
      proposalId: offered.proposalId,
      subjectId: offered.offer.sourceBindings.subjectId,
      assignmentId: offered.offer.sourceBindings.assignmentId,
      offer: offered.offer,
    })

    await page.reload()
    await page.getByRole('button', { name: 'Review next target', exact: true }).nth(sourceIndex).click()
    await expect(page.getByRole('heading', { name: 'Recalibrate before changing the target' })).toBeVisible()
    const renewedResponse = page.waitForResponse(response => response.url().endsWith('/api/training/manual-recalibrations/proposals'))
    await page.getByRole('button', { name: 'Review starting settings', exact: true }).click()
    const renewed = ManualRecalibrationProposalProjectionV1Schema.parse(await body(await renewedResponse))
    expect(renewed.proposalId).toBe(offered.proposalId)
    expect(renewed.offer).toEqual(offered.offer)
    expect(renewed.offer.kind).toBe('options')
    if (renewed.offer.kind !== 'options') throw new Error('Expected renewed harder familiarization settings')
    const choice = renewed.offer.options[0]
    expect(choice.harderDirection).toBe(variant === 'starter' ? 'higher_resistance_or_external_load' : 'lower_machine_assistance')
    await page.getByRole('combobox', { name: 'New setting', exact: true }).selectOption(String(choice.optionIndex))
    if (choice.confirmation.outlierDisposition === 'greater_than_20_percent_acknowledgement_required') {
      await page.getByRole('checkbox', { name: 'I checked the unit and load basis for this change greater than 20%.' }).check()
    }
    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }

    const requests: unknown[] = []
    let firstReceipt: unknown = null
    await page.route('**/api/training/manual-recalibrations/proposals/*/accept', async route => {
      requests.push(route.request().postDataJSON())
      if (requests.length === 1) {
        const result = await route.fetch()
        expect(result.ok()).toBe(true)
        firstReceipt = await result.json()
        await route.abort('connectionfailed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Confirm new setting', exact: true }).click()
    await page.getByRole('button', { name: 'Retry the same selection', exact: true }).click()
    await expect(page.getByText(/New setting confirmed for future sessions/)).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    const receipt = ManualRecalibrationAcceptanceV1Schema.parse(firstReceipt)
    expect(receipt.selectedLoad.quantity).toEqual(choice.quantity)
    expect(receipt.sourceDecision).toEqual(renewed.offer.sourceBindings.sourceDecision)
    expect(receipt.outlierAcknowledged).toBe(choice.confirmation.outlierDisposition === 'greater_than_20_percent_acknowledgement_required')
    const latest = TrainingProgramRevisionV1Schema.parse((await body(await page.request.get(`/api/training/programs/${source.assignmentId}`))).program)
    const affected = new Set(receipt.affectedTargets.map(target => `${target.sessionId}:${target.exerciseInstanceId}`))
    for (const session of latest.sessions) for (const exercise of session.exercises) {
      if (affected.has(`${session.sessionId}:${exercise.exerciseInstanceId}`)) {
        if (!exercise.progression) throw new Error('Accepted familiarization lost its progression identity')
        expect(exercise.acceptedInitialLoad.quantity).toEqual(choice.quantity)
        expect(exercise.progression.progressionSeriesId).toBe(receipt.newProgressionSeriesId)
        expect(exercise.progression.loadEpoch).toBe(receipt.seriesIntent.nextLoadEpoch)
      } else {
        const prior = source.program.sessions.find(item => item.sessionId === session.sessionId)?.exercises.find(item => item.exerciseInstanceId === exercise.exerciseInstanceId)
        expect(exercise).toEqual(prior)
      }
    }
    const preserved = await body(await page.request.get(`/api/training/sessions/${source.sessionId}`))
    expect(preserved.prescription).toEqual(source.sourcePrescription)
  })
}
