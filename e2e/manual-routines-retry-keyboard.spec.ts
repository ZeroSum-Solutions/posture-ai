import { expect, test, type Browser, type Page } from '@playwright/test'
import { provisionLocalAthlete } from './helpers/athlete-auth'
import { totpCode } from '../scripts/testing/totp'

const exerciseId = 'wger:65d12ecf-54b8-466d-a412-e55c396cad69'
const exerciseName = 'Dumbbell Romanian Deadlift'

test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(page: Page, athlete: Awaited<ReturnType<typeof provisionLocalAthlete>>) {
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/train')
}

async function freshSignedInPage(
  browser: Browser,
  baseURL: string,
  athlete: Awaited<ReturnType<typeof provisionLocalAthlete>>,
) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await signIn(page, athlete)
  return { context, page }
}

async function reachByKeyboard(page: Page, target: ReturnType<Page['locator']>, browserName: string, limit = 80) {
  const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press(key)
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute('aria-label') ?? await target.textContent() ?? 'target'}`)
}

async function replaceFocusedText(page: Page, value: string) {
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(value)
}

test('lost manual-routine create response retries one envelope and the saved routine remains keyboard operable in a fresh context', async ({ browser, browserName, page }) => {
  test.setTimeout(120_000)
  const athlete = await provisionLocalAthlete()
  await signIn(page, athlete)

  const createBodies: string[] = []
  let committedRoutineId: string | null = null
  await page.route('**/api/training/manual-routines', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postData()
    if (!body) throw new Error('Manual-routine create request had no body')
    createBodies.push(body)
    if (createBodies.length !== 1) return route.continue()

    const committed = await route.fetch()
    expect(committed.status()).toBe(201)
    const projection = await committed.json() as { routine?: { routineId?: unknown } }
    expect(typeof projection.routine?.routineId).toBe('string')
    committedRoutineId = String(projection.routine?.routineId)
    await route.abort('connectionreset')
  })

  await page.goto(`/workouts/manual/new?exercise=${encodeURIComponent(exerciseId)}`)
  await page.locator('body').press('Home')
  const title = page.getByRole('textbox', { name: 'Routine name', exact: true })
  await reachByKeyboard(page, title, browserName)
  await page.keyboard.insertText('Keyboard retry routine')
  const sets = page.getByRole('spinbutton', { name: `Sets for ${exerciseName}`, exact: true })
  await reachByKeyboard(page, sets, browserName)
  await page.keyboard.insertText('3')
  const reps = page.getByRole('spinbutton', { name: `Reps for ${exerciseName}`, exact: true })
  await reachByKeyboard(page, reps, browserName)
  await page.keyboard.insertText('8')
  const load = page.getByRole('textbox', { name: `Load for ${exerciseName}`, exact: true })
  await reachByKeyboard(page, load, browserName)
  await page.keyboard.insertText('12.125')
  const save = page.getByRole('button', { name: 'Save routine', exact: true })
  await reachByKeyboard(page, save, browserName)
  await page.keyboard.press('Enter')

  await expect(page.getByText('The save may already have completed. Keep this draft unchanged and retry the original save.', { exact: true })).toBeVisible()
  await expect(title).toBeDisabled()
  const retry = page.getByRole('button', { name: 'Retry original save', exact: true })
  await reachByKeyboard(page, retry, browserName)
  await page.keyboard.press('Enter')

  await expect.poll(() => createBodies.length).toBe(2)
  expect(createBodies[1]).toBe(createBodies[0])
  const firstEnvelope = JSON.parse(createBodies[0]) as { requestId?: unknown; subjectId?: unknown }
  const retriedEnvelope = JSON.parse(createBodies[1]) as { requestId?: unknown; subjectId?: unknown }
  expect(firstEnvelope.requestId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(retriedEnvelope).toEqual(firstEnvelope)
  expect(firstEnvelope.subjectId).toBe(athlete.subjectId)
  expect(committedRoutineId).not.toBeNull()
  await page.waitForURL(url => url.pathname === `/workouts/manual/${committedRoutineId}`)
  await expect(page.getByRole('heading', { name: 'Keyboard retry routine', exact: true })).toBeVisible()

  const listResponse = await page.request.get(`/api/training/manual-routines?subjectId=${athlete.subjectId}&limit=100`)
  expect(listResponse.status()).toBe(200)
  const list = await listResponse.json() as { routines?: Array<{ routineId: string }> }
  expect(list.routines?.map(routine => routine.routineId)).toEqual([committedRoutineId])

  const second = await freshSignedInPage(browser, new URL(page.url()).origin, athlete)
  try {
    await second.page.goto(`/workouts/manual/${committedRoutineId}`)
    await expect(second.page.getByRole('heading', { name: 'Keyboard retry routine', exact: true })).toBeVisible()
    await expect(second.page.getByText('3 sets × 8 reps · 12.125 kg', { exact: true })).toBeVisible()

    await second.page.locator('body').press('Home')
    const finish = second.page.getByRole('button', { name: 'Finish viewing routine', exact: true })
    await reachByKeyboard(second.page, finish, browserName)
    await second.page.keyboard.press('Enter')
    await expect(second.page.getByText('You reached the end of this routine. No workout completion was recorded.', { exact: true })).toBeVisible()

    const edit = second.page.getByRole('button', { name: 'Edit routine', exact: true })
    await reachByKeyboard(second.page, edit, browserName)
    await second.page.keyboard.press('Enter')
    const editedLoad = second.page.getByRole('textbox', { name: `Load for ${exerciseName}`, exact: true })
    await reachByKeyboard(second.page, editedLoad, browserName)
    await replaceFocusedText(second.page, '12.375')
    const saveChanges = second.page.getByRole('button', { name: 'Save changes', exact: true })
    await reachByKeyboard(second.page, saveChanges, browserName)
    await second.page.keyboard.press('Enter')
    await expect(second.page.getByText('3 sets × 8 reps · 12.375 kg', { exact: true })).toBeVisible()

    const archive = second.page.getByRole('button', { name: 'Archive routine', exact: true })
    await reachByKeyboard(second.page, archive, browserName)
    await second.page.keyboard.press('Enter')
    await second.page.waitForURL(url => url.pathname === '/workouts/manual')
    const archivedResponse = await second.page.request.get(`/api/training/manual-routines/${committedRoutineId}`)
    expect(archivedResponse.status()).toBe(200)
    expect((await archivedResponse.json()).routine).toMatchObject({ routineId: committedRoutineId, revision: 3, status: 'archived' })
  } finally {
    await second.context.close()
  }
})
