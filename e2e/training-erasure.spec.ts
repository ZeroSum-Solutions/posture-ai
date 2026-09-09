import { expect, test } from '@playwright/test'
import { provisionLocalAthlete } from './helpers/athlete-auth'
import { totpCode } from '../scripts/testing/totp'

test.use({ storageState: { cookies: [], origins: [] } })

test('an isolated athlete confirms erasure and retries a lost receipt exactly', async ({ page }) => {
  const athlete = await provisionLocalAthlete()
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => url.pathname === '/train')
  const saved = await page.request.post('/api/training/manual-routines', { data: {
    requestId: crypto.randomUUID(), subjectId: athlete.subjectId, title: 'Local erasure fixture',
    items: [{ itemId: crypto.randomUUID(), referenceExerciseId: 'wger:65d12ecf-54b8-466d-a412-e55c396cad69', kind: 'strength', sets: 3, reps: 8, load: { value: '12.125', unit: 'kg' } }],
  } })
  expect(saved.status()).toBe(201)
  const { routine } = await saved.json()
  await page.getByRole('link', { name: 'Training data', exact: true }).click()
  const erase = page.getByRole('button', { name: 'Permanently erase my training', exact: true })
  await expect(erase).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByLabel('Type ERASE MY TRAINING to confirm').fill('ERASE MY TRAINING')
  const attempts: unknown[] = []
  await page.route('**/api/training/privacy/erase', async route => {
    attempts.push(route.request().postDataJSON())
    if (attempts.length === 1) {
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      expect(await committed.json()).toMatchObject({ status: 'erased', subjectId: athlete.subjectId })
      await route.abort('connectionreset')
    } else await route.continue()
  })
  await erase.click()
  await page.getByRole('button', { name: 'Retry permanent erasure', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Training data erased', exact: true })).toBeVisible()
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toEqual(attempts[0])
  const erasedRoutine = await page.request.get(`/api/training/manual-routines/${routine.routineId}`)
  expect([403, 404]).toContain(erasedRoutine.status())
})
