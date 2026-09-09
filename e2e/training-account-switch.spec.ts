import { expect, test, type Page } from '@playwright/test'
import { provisionLocalAthlete } from './helpers/athlete-auth'
import { totpCode } from '../scripts/testing/totp'

test.use({ storageState: { cookies: [], origins: [] } })

async function offlineActor(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const open = indexedDB.open('posture-ai-training-offline', 1)
    open.onerror = () => reject(new Error('Offline identity storage unavailable'))
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction('meta', 'readonly')
      const request = transaction.objectStore('meta').get('activeUser')
      request.onsuccess = () => resolve(request.result?.userId ?? null)
      request.onerror = () => reject(new Error('Offline identity could not be read'))
      transaction.oncomplete = () => database.close()
    }
  }))
}

async function signIn(page: Page, athlete: Awaited<ReturnType<typeof provisionLocalAthlete>>) {
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => url.pathname === '/train')
}

test('a direct sign-in as another athlete clears the previous account in the already-open tab', async ({ page, context }) => {
  test.setTimeout(90_000)
  const first = await provisionLocalAthlete()
  const second = await provisionLocalAthlete()
  await signIn(page, first)
  await page.getByLabel('Are you 18 or older?').selectOption('confirmed_18_plus')
  await page.getByRole('button', { name: 'Save answers', exact: true }).click()
  await expect(page.getByText('Answers saved. This did not create a training decision.')).toBeVisible()
  const before = await page.request.get('/api/training/eligibility/answers')
  expect(await before.json()).toMatchObject({ subjectId: first.subjectId, current: { revision: 1 } })
  await expect.poll(() => offlineActor(page)).not.toBeNull()
  const priorOfflineActor = await offlineActor(page)

  const otherTab = await context.newPage()
  // No intervening sign-out. Supabase must broadcast the actual different user.
  const previousTabNavigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() })
  await signIn(otherTab, second)
  await previousTabNavigated
  await expect(page.getByText('Answers saved. This did not create a training decision.')).toHaveCount(0)
  const after = await page.request.get('/api/training/eligibility/answers')
  expect(after.status()).toBe(200)
  expect(await after.json()).toMatchObject({ subjectId: second.subjectId, current: null })
  await expect.poll(() => offlineActor(page)).not.toBe(priorOfflineActor)
  expect(await offlineActor(page)).not.toBeNull()

  await page.goto('/train')
  await expect(page.getByRole('heading', { name: 'My training' })).toBeVisible()
  await expect(page.getByLabel('Are you 18 or older?')).toHaveValue('unknown')
  await otherTab.close()
})
