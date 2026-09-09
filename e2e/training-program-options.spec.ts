import { expect, test, type APIResponse, type Page, type Response, type TestInfo } from '@playwright/test'
import { AthleteTrainingProfileV1Schema } from '../lib/training/contracts/profile'

const responsiveWidths = [320, 390, 768, 1280, 1440] as const

type EquipmentOption = {
  equipmentId: string
  basis: 'barbell_total' | 'dumbbell_per_hand' | 'dumbbell_single_implement' | 'machine_stack'
  unit: 'kg' | 'lb'
}

type ExerciseOption = {
  exerciseVersionId: string
  label: string
  equipmentOptions: EquipmentOption[]
}

type ProgramOptions = {
  catalogVersion: string
  conditioningModes: { modalityId: string; label: string }[]
  exerciseOptions: ExerciseOption[]
}

type ProfileProjection = {
  current: {
    revision: number
    profile: Record<string, unknown> & { startingHistory: unknown[] }
  }
}

const basisLabels: Record<EquipmentOption['basis'], string> = {
  barbell_total: 'total including bar and collars',
  dumbbell_per_hand: 'per hand',
  dumbbell_single_implement: 'one dumbbell',
  machine_stack: 'stack setting',
}

async function body(response: APIResponse | Response): Promise<unknown> {
  const value: unknown = await response.json()
  expect(response.ok(), JSON.stringify(value)).toBeTruthy()
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  expect(Array.isArray(value)).toBe(false)
  return value as Record<string, unknown>
}

function parseProfileProjection(value: unknown, subjectId: string): ProfileProjection {
  const projection = asRecord(value)
  expect(projection.schemaVersion).toBe('training-profile-projection.v1')
  expect(projection.subjectId).toBe(subjectId)
  const current = asRecord(projection.current)
  expect(Number.isInteger(current.revision)).toBe(true)
  const profile = asRecord(current.profile)
  expect(Array.isArray(profile.startingHistory)).toBe(true)
  return {
    current: {
      revision: current.revision as number,
      profile: profile as ProfileProjection['current']['profile'],
    },
  }
}

function parseProgramOptions(
  value: unknown,
  subjectId: string,
  profileRevision: number,
): ProgramOptions {
  const options = asRecord(value)
  expect(options.schemaVersion).toBe('training-program-options.v1')
  expect(options.subjectId).toBe(subjectId)
  expect(options.profileRevision).toBe(profileRevision)
  expect(typeof options.catalogVersion).toBe('string')
  expect(Array.isArray(options.conditioningModes)).toBe(true)
  expect(Array.isArray(options.exerciseOptions)).toBe(true)
  const conditioningModes = (options.conditioningModes as unknown[]).map(value => {
    const mode = asRecord(value)
    expect(typeof mode.modalityId).toBe('string')
    expect(typeof mode.label).toBe('string')
    return { modalityId: mode.modalityId as string, label: mode.label as string }
  })
  const exerciseOptions = (options.exerciseOptions as unknown[]).map(value => {
    const exercise = asRecord(value)
    expect(typeof exercise.exerciseVersionId).toBe('string')
    expect(typeof exercise.label).toBe('string')
    expect(Array.isArray(exercise.equipmentOptions)).toBe(true)
    const equipmentOptions = (exercise.equipmentOptions as unknown[]).map(value => {
      const equipment = asRecord(value)
      expect(typeof equipment.equipmentId).toBe('string')
      expect(['barbell_total', 'dumbbell_per_hand', 'dumbbell_single_implement', 'machine_stack'])
        .toContain(equipment.basis)
      expect(['kg', 'lb']).toContain(equipment.unit)
      return equipment as EquipmentOption
    })
    return {
      exerciseVersionId: exercise.exerciseVersionId as string,
      label: exercise.label as string,
      equipmentOptions,
    }
  })
  return { catalogVersion: options.catalogVersion as string, conditioningModes, exerciseOptions }
}

async function openConditioningSample(page: Page) {
  await page.getByRole('combobox', { name: 'Sample program', exact: true }).selectOption('conditioning')
  const setupResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/training/simulation/setup'
      && new URL(response.url()).searchParams.get('catalog') === 'conditioning'
  ))
  const optionsResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/training/programs/options'
  ))
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  const setup = asRecord(await body(await setupResponsePromise))
  expect(typeof setup.subjectId).toBe('string')
  return {
    subjectId: setup.subjectId as string,
    optionsResponsePromise,
  }
}

async function assertProgramOptionsViewport(
  page: Page,
  width: (typeof responsiveWidths)[number],
  testInfo: TestInfo,
  entryText: string,
) {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
  await expect(page.getByRole('combobox', {
    name: 'Preferred conditioning activity',
    exact: true,
  })).toBeVisible()
  const history = page.getByRole('region', { name: 'Recent working sets', exact: true })
  await expect(history).toContainText(entryText)
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  await page.screenshot({
    path: testInfo.outputPath(`training-program-options-${width}.png`),
    fullPage: true,
  })
}

test('saves and reloads a catalog-bound conditioning preference and exact recalled set', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/workouts')
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true, level: 1 })).toBeVisible()

  const opened = await openConditioningSample(page)
  const profileUrl = `/api/training/profile?subjectId=${encodeURIComponent(opened.subjectId)}`
  const original = parseProfileProjection(await body(await request.get(profileUrl)), opened.subjectId)
  const options = parseProgramOptions(
    await body(await opened.optionsResponsePromise),
    opened.subjectId,
    original.current.revision,
  )
  const cycling = options.conditioningModes.find(mode => mode.modalityId === 'synthetic-stationary-cycling.v1')
  expect(cycling).toEqual({
    modalityId: 'synthetic-stationary-cycling.v1',
    label: 'Synthetic stationary cycling',
  })
  const exercise = options.exerciseOptions.find(option => option.equipmentOptions.length > 0)
  expect(exercise).toBeTruthy()
  const equipment = exercise!.equipmentOptions[0]
  const equipmentLabel = `${equipment.equipmentId} · ${basisLabels[equipment.basis]} · ${equipment.unit}`
  const recalledEntryText = `${exercise!.label}: 4.125 ${equipment.unit} ${basisLabels[equipment.basis]} · 7 reps · recalled`
  let savedRevision: number | null = null

  try {
    await page.getByRole('tab', { name: 'Starting loads', exact: true }).click()
    await page.getByRole('combobox', {
      name: 'Preferred conditioning activity',
      exact: true,
    }).selectOption(cycling!.modalityId)
    const recent = page.getByRole('region', { name: 'Recent working sets', exact: true })
    await recent.getByRole('combobox', { name: 'Exercise', exact: true })
      .selectOption({ label: exercise!.label })
    await recent.getByRole('combobox', { name: 'Equipment', exact: true })
      .selectOption({ label: equipmentLabel })
    await recent.getByRole('textbox', { name: `Load (${equipment.unit})`, exact: true }).fill('4.125')
    await recent.getByRole('textbox', { name: 'Repetitions', exact: true }).fill('7')
    await recent.getByRole('button', { name: 'Add recent set', exact: true }).click()
    await expect(recent).toContainText(recalledEntryText)

    const saveResponsePromise = page.waitForResponse(response => (
      response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === '/api/training/profile'
        && new URL(response.url()).searchParams.get('subjectId') === opened.subjectId
    ))
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    const saved = parseProfileProjection(await body(await saveResponsePromise), opened.subjectId)
    savedRevision = saved.current.revision
    expect(saved.current.revision).toBe(original.current.revision + 1)
    expect(saved.current.profile.conditioningPreference).toEqual({
      schemaVersion: 'conditioning-preference.v1',
      catalogVersion: options.catalogVersion,
      preferredModalityIds: [cycling!.modalityId],
    })
    expect(saved.current.profile.startingHistory).toHaveLength(original.current.profile.startingHistory.length + 1)
    expect(saved.current.profile.startingHistory.at(-1)).toMatchObject({
      exerciseVersionId: exercise!.exerciseVersionId,
      performedAt: null,
      equipmentLoad: {
        equipmentId: equipment.equipmentId,
        basis: equipment.basis,
        quantity: { entered: { value: '4.125', unit: equipment.unit } },
      },
      reps: 7,
      source: { kind: 'recalled', sourceVersion: 'athlete-recall.v1' },
      progressionEvidenceEligible: false,
    })

    await page.reload()
    const reopened = await openConditioningSample(page)
    expect(reopened.subjectId).toBe(opened.subjectId)
    const reopenedOptions = parseProgramOptions(
      await body(await reopened.optionsResponsePromise),
      opened.subjectId,
      savedRevision,
    )
    expect(reopenedOptions.catalogVersion).toBe(options.catalogVersion)
    await expect(page.getByText(`Profile revision ${savedRevision}`, { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Starting loads', exact: true }).click()
    await expect(page.getByRole('combobox', {
      name: 'Preferred conditioning activity',
      exact: true,
    })).toHaveValue(cycling!.modalityId)
    await expect(page.getByRole('region', { name: 'Recent working sets', exact: true }))
      .toContainText(recalledEntryText)

    for (const width of responsiveWidths) {
      await assertProgramOptionsViewport(page, width, testInfo, recalledEntryText)
    }
    const buildResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/training/programs/builds')
    await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
    const builtResponse = await buildResponse
    expect(builtResponse.ok()).toBe(true)
    const built = await builtResponse.json()
    expect(built.result.kind).toBe('draft_program')
    expect(built.result.weeks).toHaveLength(AthleteTrainingProfileV1Schema.parse(saved.current.profile).cycleLengthWeeks)
    for (const week of built.result.weeks) {
      expect(week.conditioningBouts).toHaveLength(2)
      for (const bout of week.conditioningBouts) expect(bout.modalityId).toBe(cycling!.modalityId)
    }
  } finally {
    if (savedRevision !== null) {
      await body(await request.patch(profileUrl, {
        data: {
          expectedRevision: savedRevision,
          profile: original.current.profile,
        },
      }))
    }
  }
})
