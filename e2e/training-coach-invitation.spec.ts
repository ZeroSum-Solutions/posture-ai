import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createClient } from './helpers'
import { totpCode } from '../scripts/testing/totp'

const PERMISSION_LABELS = [
  'Read athlete identity',
  'Read the client connection',
  'Read training profile',
  'Edit training profile',
  'Publish assigned programs',
  'Read training sessions',
  'Correct session logs',
  'Finish training sessions',
  'Read session history',
  'End the coaching connection',
] as const

const EXPECTED_PERMISSIONS = [
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

test('coach prepares a private invitation and the athlete accepts it with MFA', async ({ browser, page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          ;(window as typeof window & { __copiedInvitationLink?: string }).__copiedInvitationLink = value
        },
      },
    })
  })
  const token = randomUUID().slice(0, 8)
  const client = await createClient(page, 'Invite', `Athlete-${token}`)
  const athleteEmail = `coach-invite-${randomUUID()}@fixtures.invalid`
  const athletePassword = `LocalAthlete-${randomUUID()}!`

  await page.goto('/workouts')
  await page.getByLabel('Build strength program for').selectOption(client.id)
  await expect(page.getByText('Athlete setup required', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Invite athlete', exact: true }).click()
  await page.getByLabel('Athlete email').fill(athleteEmail)
  for (const label of PERMISSION_LABELS) await page.getByRole('checkbox', { name: label }).check()

  const attempts: unknown[] = []
  await page.route('**/api/training/coaching/invitations', async route => {
    attempts.push(route.request().postDataJSON())
    if (attempts.length === 1) {
      const committed = await route.fetch()
      expect(committed.status()).toBe(201)
      await route.abort('connectionreset')
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Prepare invitation', exact: true }).click()
  await expect(page.getByText(/The invitation may have been prepared/)).toBeVisible()
  await page.getByRole('button', { name: 'Retry same invitation request', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Invitation ready', exact: true })).toBeVisible()
  await expect(page.getByText(/No message was sent automatically/)).toBeVisible()
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toEqual(attempts[0])
  expect(attempts[0]).toMatchObject({
    clientId: client.id,
    email: athleteEmail,
    permissions: EXPECTED_PERMISSIONS,
  })
  expect(attempts[0]).toEqual(expect.objectContaining({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) }))

  const invitationLink = await page.getByLabel('Invitation link').inputValue()
  const invitationUrl = new URL(invitationLink)
  expect(invitationUrl.origin).toBe('http://127.0.0.1:3100')
  expect(invitationUrl.pathname).toBe('/auth/confirm')
  expect(invitationUrl.searchParams.get('type')).toBe('recovery')
  expect(invitationUrl.searchParams.get('next')).toBe('athlete-invite')
  expect(invitationUrl.searchParams.get('token_hash')).toBeTruthy()
  await page.getByRole('button', { name: 'Copy invitation link', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Invitation link copied.')
  expect(await page.evaluate(() => (
    window as typeof window & { __copiedInvitationLink?: string }
  ).__copiedInvitationLink)).toBe(invitationLink)

  const athleteContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: { cookies: [], origins: [] },
  })
  try {
    const athletePage = await athleteContext.newPage()
    await athletePage.goto(invitationLink)
    await expect(athletePage.getByRole('heading', { name: 'Accept athlete invitation', exact: true })).toBeVisible()
    await athletePage.getByLabel('Password', { exact: true }).fill(athletePassword)
    await athletePage.getByLabel('Confirm password', { exact: true }).fill(athletePassword)
    await athletePage.getByRole('button', { name: 'Continue to multi-factor setup', exact: true }).click()
    await athletePage.waitForURL(/\/auth\/mfa\?mode=athlete-invite/)
    await expect(athletePage.getByRole('heading', { name: 'Connect an authenticator app', exact: true })).toBeVisible()
    const setupKey = await athletePage.getByText('Or enter this setup key', { exact: true })
      .locator('xpath=following-sibling::p[1]').textContent()
    if (!setupKey) throw new Error('Authenticator setup key was unavailable')
    await athletePage.getByLabel('Authenticator code').fill(totpCode(setupKey.replace(/\s/g, '')))
    await athletePage.getByRole('button', { name: 'Verify and continue', exact: true }).click()
    await athletePage.waitForURL(url => url.pathname === '/train')
    await expect(athletePage.getByRole('heading', { name: 'My training', exact: true })).toBeVisible()
  } finally {
    await athleteContext.close()
  }

  await page.goto('/workouts')
  await page.getByLabel('Build strength program for').selectOption(client.id)
  await expect(page.getByText('Profile revision 0', { exact: true })).toBeVisible()
  await expect(page.getByText('Athlete setup required', { exact: true })).toHaveCount(0)
  const projectionResponse = await page.request.get(
    `/api/training/profile?clientId=${encodeURIComponent(client.id)}`,
  )
  expect(projectionResponse.status()).toBe(200)
  const projection = await projectionResponse.json()
  expect(projection).toMatchObject({
    clientId: client.id,
    subjectId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    current: null,
  })
  expect(projection.permissions).toEqual(expect.arrayContaining([...EXPECTED_PERMISSIONS]))
  expect(projection.permissions).toHaveLength(EXPECTED_PERMISSIONS.length)
})
