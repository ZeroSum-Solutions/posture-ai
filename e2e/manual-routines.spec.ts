import { expect, test } from '@playwright/test'
import { provisionLocalAthlete } from './helpers/athlete-auth'
import { totpCode } from '../scripts/testing/totp'

test.use({ storageState: { cookies: [], origins: [] } })

test('athlete selects a reference exercise and saves, reopens and edits a durable routine', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const athlete = await provisionLocalAthlete()
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => url.pathname === '/train')
  await page.goto('/exercises')
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await expect(navigation.locator('a[href="/train"]')).toBeVisible()
  await expect(navigation.locator('a[href="/clients"], a[href="/capture"]')).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('dumbbell romanian deadlift')
  await page.getByRole('button', { name: 'Add Dumbbell Romanian Deadlift to workout', exact: true }).click()
  await page.getByRole('link', { name: 'Continue to workout' }).click()
  await page.getByLabel('Routine name', { exact: true }).fill('My reference strength routine')
  await page.getByLabel('Sets for Dumbbell Romanian Deadlift', { exact: true }).fill('3')
  await page.getByLabel('Reps for Dumbbell Romanian Deadlift', { exact: true }).fill('8')
  await page.getByLabel('Load for Dumbbell Romanian Deadlift', { exact: true }).fill('12.125')
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/training/manual-routines') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save routine', exact: true }).click()
  const created = await createdResponse
  expect(created.status()).toBe(201)
  const { routine } = await created.json()
  expect(routine.subjectId).toBe(athlete.subjectId)
  expect(routine.items[0]).toMatchObject({ sets: 3, reps: 8, load: { value: '12.125', unit: 'kg' } })
  await page.waitForURL(url => url.pathname === `/workouts/manual/${routine.routineId}`)
  await expect(page.getByRole('heading', { name: 'My reference strength routine', exact: true })).toBeVisible()
  await expect(page.getByText('3 sets × 8 reps · 12.125 kg', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Source for Dumbbell Romanian Deadlift' })).toBeVisible()
  const image = page.getByRole('img', { name: 'Two views of a person holding one dumbbell in each hand: standing upright and hinging forward at the hips.' })
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`manual-routine-${width}.png`), fullPage: true })
  }
  await page.screenshot({ path: testInfo.outputPath('manual-routine.png'), fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: 'Edit routine', exact: true }).click()
  await page.getByLabel('Load for Dumbbell Romanian Deadlift', { exact: true }).fill('12.375')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('3 sets × 8 reps · 12.375 kg', { exact: true })).toBeVisible()
  const saved = await page.request.get(`/api/training/manual-routines/${routine.routineId}`)
  expect((await saved.json()).routine).toMatchObject({ revision: 2, items: [{ itemId: routine.items[0].itemId, load: { value: '12.375', unit: 'kg' } }] })
})


test('manual routine API preserves exact retries and rejects stale edits', async ({ page }) => {
  test.setTimeout(90_000)
  const athlete = await provisionLocalAthlete()
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => url.pathname === '/train')
  const input = {
    requestId: crypto.randomUUID(), subjectId: athlete.subjectId, title: 'Exact routine retry',
    items: [{ itemId: crypto.randomUUID(), referenceExerciseId: 'wger:65d12ecf-54b8-466d-a412-e55c396cad69', kind: 'strength', sets: 3, reps: 8, load: { value: '12.125', unit: 'kg' } }],
  }
  const first = await page.request.post('/api/training/manual-routines', { data: input })
  expect(first.status()).toBe(201)
  const original = await first.json()
  const retry = await page.request.post('/api/training/manual-routines', { data: input })
  expect(retry.status()).toBe(201)
  expect(await retry.json()).toEqual(original)
  const mismatched = await page.request.post('/api/training/manual-routines', { data: { ...input, title: 'Changed retry' } })
  expect(mismatched.status()).toBe(409)
  const path = `/api/training/manual-routines/${original.routine.routineId}`
  const edit = { expectedRevision: 1, title: 'Explicit correction', items: input.items }
  const updated = await page.request.patch(path, { data: edit })
  expect(updated.status()).toBe(200)
  expect((await updated.json()).routine.revision).toBe(2)
  const stale = await page.request.patch(path, { data: edit })
  expect(stale.status()).toBe(409)
  expect((await stale.json()).current.revision).toBe(2)
  const second = await page.request.post('/api/training/manual-routines', {
    data: { ...input, requestId: crypto.randomUUID(), title: 'Second saved routine' },
  })
  expect(second.status()).toBe(201)
  const secondRoutine = (await second.json()).routine
  const listPath = `/api/training/manual-routines?subjectId=${athlete.subjectId}&limit=1`
  const firstPageResponse = await page.request.get(listPath)
  expect(firstPageResponse.status()).toBe(200)
  const firstPage = await firstPageResponse.json()
  expect(firstPage.routines).toHaveLength(1)
  expect(firstPage.hasMore).toBe(true)
  expect(typeof firstPage.nextCursor).toBe('string')
  const secondPageResponse = await page.request.get(`${listPath}&cursor=${encodeURIComponent(firstPage.nextCursor)}`)
  expect(secondPageResponse.status()).toBe(200)
  const secondPage = await secondPageResponse.json()
  expect(secondPage.routines).toHaveLength(1)
  expect(secondPage.hasMore).toBe(false)
  expect(secondPage.nextCursor).toBeNull()
  expect(new Set([...firstPage.routines, ...secondPage.routines].map(routine => routine.routineId)))
    .toEqual(new Set([original.routine.routineId, secondRoutine.routineId]))
  const invalidCursor = await page.request.get(`${listPath}&cursor=invalid`)
  expect(invalidCursor.status()).toBe(400)
  const archived = await page.request.delete(path, { data: { expectedRevision: 2 } })
  expect(archived.status()).toBe(200)
  expect(await archived.json()).toMatchObject({ routineId: original.routine.routineId, status: 'archived' })
})
