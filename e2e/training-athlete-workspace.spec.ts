import { expect, test } from '@playwright/test'
import { provisionLocalAthlete } from './helpers/athlete-auth'
import { totpCode } from '../scripts/testing/totp'

test.use({ storageState: { cookies: [], origins: [] } })

test('real athlete signs in, opens own workspace, and saves unanswered questionnaire values', async ({ page }) => {
  test.setTimeout(90_000)
  const athlete = await provisionLocalAthlete()
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => url.pathname === '/train')
  await expect(page.getByRole('heading', { name: 'My training' })).toBeVisible()
  await expect(page.getByText('Profile revision 0')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build practice draft' })).toHaveCount(0)

  const before = await page.request.get('/api/training/eligibility/answers')
  expect(before.status()).toBe(200)
  expect(await before.json()).toMatchObject({ subjectId: athlete.subjectId, current: null })
  const answers = {
    adultScope: 'confirmed_18_plus', currentActivity: 'unknown',
    knownConditions: { cardiovascular: 'unknown', metabolic: 'unknown', renal: 'unknown' },
    relevantSignsOrSymptoms: 'unknown', desiredIntensity: 'moderate', answerCertainty: 'uncertain',
    pregnancyPostpartumContext: 'prefer_not_to_say', requestedProgrammingScope: 'strength_or_general_fitness',
  }
  await page.getByLabel('Are you 18 or older?').selectOption('confirmed_18_plus')
  await page.getByLabel('Preferred training intensity').selectOption('moderate')
  await page.getByLabel('Pregnancy or postpartum context').selectOption('prefer_not_to_say')
  await page.getByLabel('What kind of programming are you looking for?').selectOption('strength_or_general_fitness')
  const saveResponse = page.waitForResponse(response => response.url().endsWith('/api/training/eligibility/answers') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save answers', exact: true }).click()
  const saved = await saveResponse
  expect(saved.status()).toBe(201)
  expect(await saved.json()).toMatchObject({ subjectId: athlete.subjectId, revision: 1, status: 'answers_saved', decisionCreated: false })
  await expect(page.getByText('Answers saved. This did not create a training decision.')).toBeVisible()
  const read = await page.request.get('/api/training/eligibility/answers')
  expect(await read.json()).toMatchObject({ subjectId: athlete.subjectId, current: { revision: 1, answers: { ...answers, origin: { kind: 'athlete_self_report' } } } })
  const stale = await page.request.post('/api/training/eligibility/answers', { data: { expectedRevision: 0, answers } })
  expect(stale.status()).toBe(409)
})
