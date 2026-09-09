import { expect, test, type APIResponse, type Page, type Response, type TestInfo } from '@playwright/test'
import {
  AthleteTrainingProfileV1Schema,
  type AthleteTrainingProfileV1,
} from '../lib/training/contracts/profile'

const responsiveWidths = [320, 390, 768, 1280, 1440] as const

type ProfileProjection = {
  current: {
    revision: number
    profile: AthleteTrainingProfileV1
  }
}

async function body(response: APIResponse | Response): Promise<unknown> {
  const value: unknown = await response.json()
  expect(response.ok(), JSON.stringify(value)).toBeTruthy()
  return value
}

function parseProfileProjection(value: unknown): ProfileProjection {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  const current = (value as { current?: unknown }).current
  expect(current).toBeTruthy()
  expect(typeof current).toBe('object')
  const revision = (current as { revision?: unknown }).revision
  expect(Number.isInteger(revision)).toBe(true)
  const profile = AthleteTrainingProfileV1Schema.parse((current as { profile?: unknown }).profile)
  return { current: { revision: revision as number, profile } }
}

function nextEquipmentId(profile: AthleteTrainingProfileV1, prefix: string): string {
  let suffix = 1
  while (profile.equipmentInventory.some(item => item.equipmentId === `${prefix}-${suffix}`)) suffix += 1
  return `${prefix}-${suffix}`
}

async function assertEquipmentViewport(
  page: Page,
  width: (typeof responsiveWidths)[number],
  testInfo: TestInfo,
  barbellId: string,
  machineId: string,
) {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
  await expect(page.getByRole('region', { name: 'Strength program builder', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', {
    name: `Bar weight for ${barbellId} (kg)`,
    exact: true,
  })).toBeVisible()
  await expect(page.getByRole('textbox', {
    name: `Available stack weights for ${machineId} (lb)`,
    exact: true,
  })).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)

  const builderBounds = await page.getByRole('region', {
    name: 'Strength program builder',
    exact: true,
  }).boundingBox()
  expect(builderBounds).not.toBeNull()
  expect(builderBounds!.x).toBeGreaterThanOrEqual(0)
  expect(builderBounds!.x + builderBounds!.width).toBeLessThanOrEqual(width)
  await page.screenshot({
    path: testInfo.outputPath(`training-equipment-${width}.png`),
    fullPage: true,
  })
}

test('saves and reloads exact barbell and machine inventory in the original sample builder', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/workouts')
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true, level: 1 })).toBeVisible()

  const setupResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/training/simulation/setup'
      && new URL(response.url()).search === ''
  ))
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  const setupResponse = await setupResponsePromise
  const setup = await body(setupResponse) as { subjectId?: unknown }
  expect(typeof setup.subjectId).toBe('string')

  const profileUrl = `/api/training/profile?subjectId=${encodeURIComponent(setup.subjectId as string)}`
  const original = parseProfileProjection(await body(await request.get(profileUrl)))
  const barbellId = nextEquipmentId(original.current.profile, 'barbell')
  const profileWithBarbell = {
    ...original.current.profile,
    equipmentInventory: [
      ...original.current.profile.equipmentInventory,
      {
        kind: 'barbell' as const,
        equipmentId: barbellId,
        unit: original.current.profile.preferredLoadUnit,
        barWeight: '',
        collarsTotalWeight: '0',
        plates: [],
      },
    ],
  }
  const machineId = nextEquipmentId(profileWithBarbell, 'machine')
  let savedRevision: number | null = null

  try {
    await expect(page.getByText(`Profile revision ${original.current.revision}`, { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Equipment', exact: true }).click()

    await page.getByRole('button', { name: 'Add barbell setup', exact: true }).click()
    await page.getByRole('combobox', { name: `Unit for ${barbellId}`, exact: true }).selectOption('kg')
    await page.getByRole('textbox', { name: `Bar weight for ${barbellId} (kg)`, exact: true }).fill('20.00')
    await page.getByRole('textbox', { name: `Collars total weight for ${barbellId} (kg)`, exact: true }).fill('0.50')
    await page.getByRole('button', { name: `Add plate denomination for ${barbellId}`, exact: true }).click()
    await page.getByRole('textbox', { name: `Plate weight 1 for ${barbellId} (kg)`, exact: true }).fill('1.25')
    await page.getByRole('spinbutton', { name: `Plate count 1 for ${barbellId}`, exact: true }).fill('4')
    await page.getByRole('button', { name: `Add plate denomination for ${barbellId}`, exact: true }).click()
    await page.getByRole('textbox', { name: `Plate weight 2 for ${barbellId} (kg)`, exact: true }).fill('0.50')
    await page.getByRole('spinbutton', { name: `Plate count 2 for ${barbellId}`, exact: true }).fill('2')

    await page.getByRole('button', { name: 'Add machine stack', exact: true }).click()
    await page.getByRole('combobox', { name: `Unit for ${machineId}`, exact: true }).selectOption('lb')
    await page.getByRole('textbox', { name: `Available stack weights for ${machineId} (lb)`, exact: true })
      .fill('10, 12.5, 15.00')

    const saveResponsePromise = page.waitForResponse(response => (
      response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === '/api/training/profile'
        && new URL(response.url()).searchParams.get('subjectId') === setup.subjectId
    ))
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    const saved = parseProfileProjection(await body(await saveResponsePromise))
    savedRevision = saved.current.revision
    expect(saved.current.revision).toBe(original.current.revision + 1)
    expect(saved.current.profile.equipmentInventory).toEqual([
      ...original.current.profile.equipmentInventory,
      {
        kind: 'barbell',
        equipmentId: barbellId,
        unit: 'kg',
        barWeight: '20.00',
        collarsTotalWeight: '0.50',
        plates: [
          { value: '1.25', count: 4 },
          { value: '0.50', count: 2 },
        ],
      },
      {
        kind: 'machine',
        equipmentId: machineId,
        unit: 'lb',
        stackLoads: ['10', '12.5', '15.00'],
      },
    ])

    await page.reload()
    await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
    await expect(page.getByText(`Profile revision ${savedRevision}`, { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Equipment', exact: true }).click()
    await expect(page.getByRole('combobox', { name: `Unit for ${barbellId}`, exact: true })).toHaveValue('kg')
    await expect(page.getByRole('textbox', { name: `Bar weight for ${barbellId} (kg)`, exact: true })).toHaveValue('20.00')
    await expect(page.getByRole('textbox', { name: `Collars total weight for ${barbellId} (kg)`, exact: true })).toHaveValue('0.50')
    await expect(page.getByRole('textbox', { name: `Plate weight 1 for ${barbellId} (kg)`, exact: true })).toHaveValue('1.25')
    await expect(page.getByRole('spinbutton', { name: `Plate count 1 for ${barbellId}`, exact: true })).toHaveValue('4')
    await expect(page.getByRole('textbox', { name: `Plate weight 2 for ${barbellId} (kg)`, exact: true })).toHaveValue('0.50')
    await expect(page.getByRole('spinbutton', { name: `Plate count 2 for ${barbellId}`, exact: true })).toHaveValue('2')
    await expect(page.getByRole('combobox', { name: `Unit for ${machineId}`, exact: true })).toHaveValue('lb')
    await expect(page.getByRole('textbox', { name: `Available stack weights for ${machineId} (lb)`, exact: true }))
      .toHaveValue('10, 12.5, 15.00')

    for (const width of responsiveWidths) {
      await assertEquipmentViewport(page, width, testInfo, barbellId, machineId)
    }
  } finally {
    if (savedRevision !== null) {
      const restored = await request.patch(profileUrl, {
        data: {
          expectedRevision: savedRevision,
          profile: original.current.profile,
        },
      })
      await body(restored)
    }
  }
})
