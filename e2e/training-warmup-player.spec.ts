import { expect, test } from '@playwright/test'
import { createAuthoredWarmupTrainingFixture } from './helpers/training-authored-warmup-fixture'

async function responseBody(response: {
  json(): Promise<unknown>
  ok(): boolean
}): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>
  expect(response.ok(), JSON.stringify(body)).toBeTruthy()
  return body
}

test('authored synthetic warm-ups survive real saves, corrections, reloads, and workspace history', async ({ page, request }) => {
  test.setTimeout(120_000)

  const fixture = await createAuthoredWarmupTrainingFixture(request)
  await page.goto(`/workouts?training_session_id=${encodeURIComponent(fixture.sessionId)}`)
  await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start session', exact: true }).click()

  const warmup = page.getByRole('group', { name: 'Warm-up 1', exact: true })
  await expect(warmup).toContainText(
    `Prescribed: ${fixture.prescribedWarmup.value} ${fixture.prescribedWarmup.unit}`,
  )
  await warmup.getByRole('textbox', { name: 'Load', exact: true }).fill('4.125')
  await warmup.getByRole('combobox', { name: 'Unit', exact: true }).selectOption('lb')
  await warmup.getByRole('spinbutton', { name: 'Reps', exact: true }).fill('6')
  await warmup.getByRole('combobox', { name: 'RIR', exact: true }).selectOption('3')

  const firstWarmupWrite = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith(
      `/api/training/sessions/${fixture.sessionId}/sets/${encodeURIComponent(fixture.warmupSetId)}`,
    ))
  await warmup.getByRole('button', { name: 'Save warm-up', exact: true }).click()
  const firstWarmupAck = await responseBody(await firstWarmupWrite)
  expect(firstWarmupAck).toMatchObject({
    schemaVersion: 'training-mutation-ack.v1',
    event: { eventType: 'set_actual_recorded', setId: fixture.warmupSetId, setKind: 'warmup' },
  })
  await expect(page.getByRole('button', {
    name: `Finish with ${fixture.totalWorkingSetCount} omissions`,
    exact: true,
  })).toBeVisible()

  await page.reload()
  const reloadedWarmup = page.getByRole('group', { name: 'Warm-up 1', exact: true })
  await expect(reloadedWarmup.getByRole('textbox', { name: 'Load', exact: true })).toHaveValue('4.125')
  await expect(reloadedWarmup.getByRole('combobox', { name: 'Unit', exact: true })).toHaveValue('lb')
  await expect(reloadedWarmup.getByRole('spinbutton', { name: 'Reps', exact: true })).toHaveValue('6')

  await reloadedWarmup.getByRole('textbox', { name: 'Load', exact: true }).fill('5.125')
  await reloadedWarmup.getByRole('spinbutton', { name: 'Reps', exact: true }).fill('7')
  const correctionWrite = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith(
      `/api/training/sessions/${fixture.sessionId}/sets/${encodeURIComponent(fixture.warmupSetId)}`,
    ))
  await reloadedWarmup.getByRole('button', { name: 'Correct saved warm-up', exact: true }).click()
  const correctionAck = await responseBody(await correctionWrite)
  expect(correctionAck).toMatchObject({
    schemaVersion: 'training-mutation-ack.v1',
    event: {
      eventType: 'set_actual_corrected',
      eventRevision: 2,
      setId: fixture.warmupSetId,
      setKind: 'warmup',
      workingSetOrdinal: null,
      quantity: { entered: { value: '5.125', unit: 'lb' } },
      reps: 7,
    },
  })

  await page.reload()
  const correctedWarmup = page.getByRole('group', { name: 'Warm-up 1', exact: true })
  await expect(correctedWarmup.getByRole('textbox', { name: 'Load', exact: true })).toHaveValue('5.125')
  await expect(correctedWarmup.getByRole('spinbutton', { name: 'Reps', exact: true })).toHaveValue('7')
  await expect(page.getByRole('button', {
    name: `Finish with ${fixture.totalWorkingSetCount} omissions`,
    exact: true,
  })).toBeVisible()

  const working = page.getByRole('group', { name: 'Set 1', exact: true }).first()
  await working.getByRole('textbox', { name: 'Load', exact: true }).fill('10.25')
  await working.getByRole('combobox', { name: 'Unit', exact: true }).selectOption('kg')
  await working.getByRole('spinbutton', { name: 'Reps', exact: true }).fill('8')
  await working.getByRole('combobox', { name: 'RIR', exact: true }).selectOption('3')
  const workingWrite = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith(
      `/api/training/sessions/${fixture.sessionId}/sets/${fixture.workingSetId}`,
    ))
  await working.getByRole('button', { name: 'Save set', exact: true }).click()
  const workingAck = await responseBody(await workingWrite)
  expect(workingAck).toMatchObject({
    event: {
      eventType: 'set_actual_recorded',
      setId: fixture.workingSetId,
      setKind: 'working',
      workingSetOrdinal: 1,
    },
  })
  await expect(page.getByRole('button', {
    name: `Finish with ${fixture.totalWorkingSetCount - 1} omissions`,
    exact: true,
  })).toBeVisible()

  await page.getByRole('button', {
    name: `Finish with ${fixture.totalWorkingSetCount - 1} omissions`,
    exact: true,
  }).click()
  await expect(page.getByText('This session is completed with omissions.', { exact: true })).toBeVisible()

  await page.goto(`/workouts?training_program_id=${encodeURIComponent(fixture.assignmentId)}`)
  await page.getByRole('tab', { name: 'Program', exact: true }).click()
  const planned = page.getByRole('region', { name: 'Planned', exact: true }).first()
  await expect(planned).toContainText(
    `Warm-up 1: ${fixture.prescribedWarmup.value} ${fixture.prescribedWarmup.unit}`,
  )

  await page.getByRole('tab', { name: 'History', exact: true }).click()
  const recorded = page.getByRole('region', { name: 'Recorded actual', exact: true }).first()
  await expect(recorded).toContainText(
    `1 of ${fixture.totalWorkingSetCount} prescribed working sets recorded · ${fixture.totalWorkingSetCount - 1} not recorded.`,
  )
  await expect(recorded).toContainText('Warm-up 1: 5.125 lb · 7 reps · RIR 3')
  await expect(recorded).toContainText('Set 1: 10.25 kg · 8 reps · RIR 3')

  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})
