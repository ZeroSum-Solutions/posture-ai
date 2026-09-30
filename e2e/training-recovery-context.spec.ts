import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

async function responseBody(response: APIResponse) {
  const data = await response.json()
  expect(response.ok(), JSON.stringify(data)).toBeTruthy()
  return data
}

async function expectResponsiveLayout(page: import('@playwright/test').Page) {
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)
  }
}

// The practice sample is shared by every spec that opens it, and several save
// (then restore) its profile, which advances the revision. Reopening the sample
// reports a fixed profileRevision of 1, so build from the current revision.
async function currentProfileRevision(request: APIRequestContext, subjectId: string): Promise<number> {
  const profile = await responseBody(await request.get(`/api/training/profile?subjectId=${encodeURIComponent(subjectId)}`))
  expect(Number.isInteger(profile.current.revision)).toBe(true)
  return profile.current.revision
}

async function createCompletedExercise(request: APIRequestContext) {
  const setup = await responseBody(await request.post('/api/training/simulation/setup'))
  const build = await responseBody(await request.post('/api/training/programs/builds', {
    data: {
      subjectId: setup.subjectId,
      profileRevision: await currentProfileRevision(request, setup.subjectId),
      cycleStartLocalDate: '2030-01-07',
    },
  }))
  expect(build.result.kind).toBe('draft_program')

  const conditioningBySlot = new Map<string, { boutId: string; acceptedDurationSeconds: number }>()
  for (const week of build.result.weeks) {
    for (const bout of week.conditioningBouts) {
      const weekday = new Date(`${bout.scheduledLocalDate}T12:00:00Z`).getUTCDay()
      const key = `${weekday}:${bout.modalityId}`
      if (!conditioningBySlot.has(key)) conditioningBySlot.set(key, {
        boutId: bout.boutId,
        acceptedDurationSeconds: bout.allowedDurationSeconds.minimum,
      })
    }
  }

  const accepted = await responseBody(await request.post(`/api/training/programs/builds/${build.buildId}/accept`, {
    data: {
      loadChoices: build.calibrations.map((offer: { calibration: { exerciseInstanceId: string } }) => ({
        exerciseInstanceId: offer.calibration.exerciseInstanceId,
        optionIndex: 0,
      })),
      conditioningChoices: [...conditioningBySlot.values()],
    },
  }))
  const published = await responseBody(await request.post('/api/training/programs/publish', {
    data: { draftId: accepted.draftId },
  }))
  const program = await responseBody(await request.get(`/api/training/programs/${published.assignmentId}`))
  const sessionId = program.program.sessions[0].sessionId as string
  await responseBody(await request.post(`/api/training/sessions/${sessionId}/start`, {
    data: { expectedRevision: 1 },
  }))

  let session = await responseBody(await request.get(`/api/training/sessions/${sessionId}`))
  const exercise = session.prescription.exercises[0]
  for (const setId of exercise.setIds) {
    await responseBody(await request.put(`/api/training/sessions/${sessionId}/sets/${setId}`, {
      data: {
        requestId: randomUUID(),
        expectedRevision: session.session.revision,
        actual: {
          quantity: exercise.acceptedInitialLoad.quantity,
          reps: exercise.repRange.minimum,
          rir: 3,
          side: exercise.progression.side,
          symptomState: 'none',
          occurredAt: new Date().toISOString(),
        },
      },
    }))
    session = await responseBody(await request.get(`/api/training/sessions/${sessionId}`))
  }
  await responseBody(await request.post(`/api/training/sessions/${sessionId}/complete`, {
    data: {
      requestId: randomUUID(),
      expectedRevision: session.session.revision,
      finishMode: 'finish_with_omissions',
    },
  }))
  return {
    sessionId,
    exerciseInstanceId: exercise.exerciseInstanceId as string,
    assignmentId: published.assignmentId as string,
  }
}

test('persists a recovery hold across a lost response and reload before explicit progression acceptance', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const fixture = await createCompletedExercise(request)
  const recoveryRequests: unknown[] = []
  let storedLostResponse: unknown = null
  let shouldLoseResponse = true
  await page.route('**/api/training/progression/proposals', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const payload = route.request().postDataJSON()
    if (!payload.recoveryContext) {
      await route.continue()
      return
    }
    recoveryRequests.push(payload)
    if (!shouldLoseResponse) {
      await route.continue()
      return
    }
    shouldLoseResponse = false
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    storedLostResponse = await response.json()
    await route.abort('connectionfailed')
  })

  await page.goto(`/workouts?training_session_id=${encodeURIComponent(fixture.sessionId)}`)
  const review = page.getByRole('button', { name: 'Review next target', exact: true }).first()
  await page.getByRole('button', { name: 'Add recovery check-in', exact: true }).first().click()
  await page.getByRole('combobox', { name: 'Fatigue', exact: true }).first().selectOption('concern_reported')
  await page.getByRole('combobox', { name: 'What would you like to review?', exact: true }).first().selectOption('hold')
  await expectResponsiveLayout(page)
  await review.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Recovery review is not confirmed' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry same recovery report', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Keep the current target', exact: true }).first()).toBeVisible()
  await expectResponsiveLayout(page)
  expect(recoveryRequests).toHaveLength(2)
  expect(recoveryRequests[1]).toEqual(recoveryRequests[0])
  expect(storedLostResponse).toMatchObject({
    result: {
      kind: 'recovery_review',
      requestBinding: {
        sessionId: fixture.sessionId,
        exerciseInstanceId: fixture.exerciseInstanceId,
      },
      review: { kind: 'hold' },
    },
  })

  await page.reload()
  await page.getByRole('button', { name: 'Review next target', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Keep the current target', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Review recorded performance with a new report', exact: true }).first().click()
  await expect(page.getByRole('combobox', { name: 'Fatigue', exact: true }).first()).toHaveValue('concern_reported')
  await expect(page.getByRole('combobox', { name: 'What would you like to review?', exact: true }).first()).toHaveValue('')
  await page.getByRole('button', { name: 'Review next target', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Suggested reps', exact: true }).first()).toBeVisible()

  const newReport = recoveryRequests.at(-1) as {
    recoveryContext?: { requestId?: string; context?: { choice?: string } }
  }
  const firstReport = recoveryRequests[0] as {
    recoveryContext: { requestId: string }
  }
  expect(newReport.recoveryContext?.requestId).not.toBe(firstReport.recoveryContext.requestId)
  expect(newReport.recoveryContext?.context).not.toHaveProperty('choice')

  const acceptanceResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
      && /\/api\/training\/progression\/proposals\/[^/]+\/accept$/.test(new URL(response.url()).pathname)
  ))
  await page.getByRole('button', { name: 'Accept suggestion', exact: true }).first().click()
  const acceptance = await acceptanceResponse
  expect(acceptance.ok()).toBe(true)
  expect(await acceptance.json()).toMatchObject({
    schemaVersion: 'training-progression-acceptance.v1',
    assignmentId: fixture.assignmentId,
  })
  await expect(page.getByText('Suggestion accepted for the next target.', { exact: true }).first()).toBeVisible()
})
