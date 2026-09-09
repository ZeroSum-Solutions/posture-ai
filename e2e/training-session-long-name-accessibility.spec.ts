import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createClient } from './helpers'
import { attachStarterPracticeToAcceptedAthlete } from './helpers/training-coach-athlete-handoff-fixture'
import { totpCode } from '../scripts/testing/totp'

const longExerciseName = 'Synthetic two-dumbbell unsupported bent-over row'
const widths = [320, 390, 768, 1280, 1440] as const
const allCoachPermissions = [
  'subject:read',
  'client_link:read',
  'profile:read',
  'profile:write',
  'program:coach_publish',
  'session:read',
  'set_log:write',
  'session:complete',
  'history:read',
  'relationship:revoke',
] as const

async function responseBody<T>(response: {
  ok(): boolean
  status(): number
  json(): Promise<unknown>
}): Promise<T> {
  const body = await response.json()
  expect(response.ok(), `request failed (${response.status()}): ${JSON.stringify(body)}`).toBeTruthy()
  return body as T
}

async function acceptInvitation(input: {
  browser: Browser
  baseUrl: string
  invitationUrl: string
  password: string
}): Promise<{ context: BrowserContext; page: Page; subjectId: string }> {
  const context = await input.browser.newContext({
    baseURL: input.baseUrl,
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  await page.goto(input.invitationUrl)
  await page.getByLabel('Password', { exact: true }).fill(input.password)
  await page.getByLabel('Confirm password', { exact: true }).fill(input.password)
  await page.getByRole('button', { name: 'Continue to multi-factor setup', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa\?mode=athlete-invite/)
  const setupKey = await page.getByText('Or enter this setup key', { exact: true })
    .locator('xpath=following-sibling::p[1]').textContent()
  if (!setupKey) throw new Error('Athlete authenticator setup key was unavailable')
  await page.getByLabel('Authenticator code').fill(totpCode(setupKey.replace(/\s/g, '')))
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/train')
  const projection = await responseBody<{ subjectId: string }>(
    await page.request.get('/api/training/coaching/relationships'),
  )
  return { context, page, subjectId: projection.subjectId }
}

async function reachByKeyboard(page: Page, target: Locator, browserName: string, limit: number): Promise<void> {
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press(tab)
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error(`Keyboard focus did not reach ${await target.textContent() ?? 'the requested action'}`)
}

async function assertPersistentActionsKeyboardReachable(page: Page, browserName: string): Promise<void> {
  const primary = page.getByRole('navigation', { name: 'Primary', exact: true })
  const targets = [
    page.getByRole('link', { name: 'Back to my training', exact: true }),
    page.getByRole('button', { name: /Finish with \d+ omissions?/, exact: true }),
    page.getByRole('button', { name: 'Stop session', exact: true }),
    primary.getByRole('link', { name: 'Train', exact: true }),
    primary.getByRole('link', { name: 'Routines', exact: true }),
    primary.getByRole('link', { name: 'Exercises', exact: true }),
  ]
  await Promise.all(targets.map(target => expect(target).toBeVisible()))
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const remaining = new Set(targets.map((_, index) => index))
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let step = 0; step < 240 && remaining.size > 0; step += 1) {
    await page.keyboard.press(tab)
    for (const index of remaining) {
      if (await targets[index].evaluate(element => element === document.activeElement)) remaining.delete(index)
    }
  }
  expect([...remaining], 'keyboard traversal missed a persistent session or dock action').toEqual([])
}

async function assertLongNameFits(
  page: Page,
  width: number,
  browserName: string,
  testInfo: TestInfo,
): Promise<void> {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 })
  const heading = page.getByRole('heading', { name: longExerciseName, exact: true })
  await expect(heading).toBeVisible()
  const box = await heading.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  await assertPersistentActionsKeyboardReachable(page, browserName)
  await page.screenshot({ path: testInfo.outputPath(`long-session-name-${width}.png`), fullPage: true })
}

test('a long server-projected exercise name fits every target width and bottom actions remain keyboard reachable', async ({ browser, browserName, page }, testInfo) => {
  test.setTimeout(150_000)
  const token = randomUUID().replaceAll('-', '')
  const athleteEmail = `simulation+${token}@fixtures.invalid`
  const athletePassword = `LocalLongName-${randomUUID()}!`

  await page.goto('/workouts')
  const client = await createClient(page, 'Long-name', `Athlete-${token.slice(0, 8)}`)
  const invitation = await responseBody<{ invitationUrl: string }>(
    await page.request.post('/api/training/coaching/invitations', {
      data: {
        requestId: randomUUID(),
        clientId: client.id,
        email: athleteEmail,
        permissions: allCoachPermissions,
      },
    }),
  )
  const athlete = await acceptInvitation({
    browser,
    baseUrl: new URL(page.url()).origin,
    invitationUrl: invitation.invitationUrl,
    password: athletePassword,
  })
  try {
    await attachStarterPracticeToAcceptedAthlete({
      subjectId: athlete.subjectId,
      clientId: client.id,
      athleteEmail,
    })

    await page.goto('/workouts')
    await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
    await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
    await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
    await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
    await expect(page.getByRole('heading', { name: '8-week draft', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
    await expect(page.getByText('Starting targets accepted and program created.', { exact: true })).toBeVisible()
    const sessionHref = await page.getByRole('link', { name: 'Open first strength session', exact: true }).getAttribute('href')
    if (!sessionHref) throw new Error('First strength session was unavailable')
    const sessionId = new URL(sessionHref, page.url()).searchParams.get('training_session_id')
    if (!sessionId) throw new Error('First strength session identifier was unavailable')

    await athlete.page.goto(`/train?training_session_id=${encodeURIComponent(sessionId)}`)
    await expect(athlete.page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
    const start = athlete.page.getByRole('button', { name: 'Start session', exact: true })
    await athlete.page.locator('body').press('Home')
    await reachByKeyboard(athlete.page, start, browserName, 30)
    await expect(start).toBeFocused()
    await athlete.page.keyboard.press('Enter')

    for (const width of widths) await assertLongNameFits(athlete.page, width, browserName, testInfo)
  } finally {
    await athlete.context.close()
  }
})
