// Pending DA-04 proof: local fixture needs exact athlete JWT claims before lifecycle verification.
// Intentionally outside Playwright discovery; original failure and source hashes retained in work/proof.
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from './helpers'
import {
  activateLocalPractitionerAal2,
  provisionLocalInvitedPractitioner,
} from './helpers/practitioner-auth'
import { attachStarterPracticeToAcceptedAthlete } from './helpers/training-coach-athlete-handoff-fixture'
import {
  expireExactSyntheticAssignment,
  readExactSubjectErasure,
  readExactSyntheticLifecycle,
} from './helpers/training-offline-lifecycle-fixture'
import { totpCode } from '../scripts/testing/totp'

const permissions = [
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

type OfflineSnapshot = {
  activeUser: string | null
  entries: Array<{
    status: 'pending' | 'conflict'
    envelope: {
      userId: string
      subjectId: string
      sessionId: string
      requestId: string
      mutation: { kind: string }
    }
  }>
}

type LifecycleSetup = {
  coach: { context: BrowserContext; page: Page }
  athlete: { context: BrowserContext; page: Page }
  clientId: string
  subjectId: string
  assignmentId: string
  sessionId: string
}

type PendingMutation = {
  requestId: string
  ownerUserId: string
  initialBody: unknown
  requestCount: () => number
  responses: Array<{ status: number; body: unknown; requestBody: unknown }>
}

function localSupabase() {
  const url = process.env.E2E_SUPABASE_URL
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Local Supabase E2E configuration is required')
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port !== '55421') {
    throw new Error('Offline lifecycle browser proof requires 127.0.0.1:55421')
  }
  return { url, anonKey, serviceRoleKey }
}

function testBaseUrl(testInfo: { project: { use: { baseURL?: string } } }): string {
  const value = testInfo.project.use.baseURL
  if (!value) throw new Error('Playwright base URL is required')
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '3100') {
    throw new Error('Offline lifecycle browser proof requires 127.0.0.1:3100')
  }
  return url.origin
}

async function responseBody<T>(response: {
  ok(): boolean
  status(): number
  json(): Promise<unknown>
}): Promise<T> {
  const body = await response.json()
  expect(response.ok(), `request failed (${response.status()}): ${JSON.stringify(body)}`).toBeTruthy()
  return body as T
}

async function createFreshPractitioner(browser: Browser, baseUrl: string) {
  const config = localSupabase()
  const email = `offline-lifecycle-coach+${randomUUID()}@postureai.test`
  const password = `LocalOffline-${randomUUID()}!`
  const options = { auth: { autoRefreshToken: false, persistSession: false } }
  const admin = createSupabaseClient(config.url, config.serviceRoleKey, options)
  await provisionLocalInvitedPractitioner({
    admin,
    supabaseUrl: config.url,
    email,
    password,
    displayName: 'Offline lifecycle coach',
  })
  const fixtureClient = createSupabaseClient(config.url, config.anonKey, options)
  const { error: signInError } = await fixtureClient.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  const secret = await activateLocalPractitionerAal2(fixtureClient)
  await fixtureClient.auth.signOut({ scope: 'global' })

  const context = await browser.newContext({ baseURL: baseUrl, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('/auth/sign-in?next=/workouts')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/auth/'))
  if (page.url().includes('/onboarding')) {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Accept and Continue' }).click()
    await page.waitForURL(url => !url.pathname.startsWith('/onboarding'))
  }
  return { context, page }
}

async function acceptAthleteInvitation(input: {
  browser: Browser
  baseUrl: string
  invitationUrl: string
  password: string
}) {
  const context = await input.browser.newContext({
    baseURL: input.baseUrl,
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  await page.goto(input.invitationUrl)
  await expect(page.getByRole('heading', { name: 'Accept athlete invitation', exact: true })).toBeVisible()
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
  const relationships = await responseBody<{ subjectId: string }>(
    await page.request.get('/api/training/coaching/relationships'),
  )
  return { context, page, subjectId: relationships.subjectId }
}

async function setupCoachAssignedSession(
  browser: Browser,
  baseUrl: string,
  label: string,
): Promise<LifecycleSetup> {
  const coach = await createFreshPractitioner(browser, baseUrl)
  try {
    await coach.page.goto('/workouts')
    const token = randomUUID().replaceAll('-', '')
    const client = await createClient(coach.page, label, `Athlete-${token.slice(0, 8)}`)
    const athleteEmail = `simulation+${token}@fixtures.invalid`
    const athletePassword = `LocalLifecycle-${randomUUID()}!`
    const invitation = await responseBody<{ invitationUrl: string }>(
      await coach.page.request.post('/api/training/coaching/invitations', {
        data: {
          requestId: randomUUID(),
          clientId: client.id,
          email: athleteEmail,
          permissions: [...permissions],
        },
      }),
    )
    const athlete = await acceptAthleteInvitation({
      browser,
      baseUrl,
      invitationUrl: invitation.invitationUrl,
      password: athletePassword,
    })
    try {
      await attachStarterPracticeToAcceptedAthlete({
        subjectId: athlete.subjectId,
        clientId: client.id,
        athleteEmail,
      })

      await coach.page.goto('/workouts')
      await coach.page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
      await expect(coach.page.getByText('Practice data · Simulation', { exact: true }).last()).toBeVisible()
      await coach.page.getByRole('tab', { name: 'Schedule', exact: true }).click()
      await coach.page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
      await coach.page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
      await expect(coach.page.getByRole('heading', { name: '8-week draft', exact: true })).toBeVisible()
      const publishResponse = coach.page.waitForResponse(response => (
        response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/training/programs/publish'
      ))
      await coach.page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
      const publication = await responseBody<{ assignmentId: string }>(await publishResponse)
      const sessionHref = await coach.page.getByRole('link', { name: 'Open first strength session', exact: true })
        .getAttribute('href')
      if (!sessionHref) throw new Error('First coach-assigned session was unavailable')
      const sessionId = new URL(sessionHref, baseUrl).searchParams.get('training_session_id')
      if (!sessionId) throw new Error('First coach-assigned session identifier was unavailable')

      await athlete.page.goto(`/train?training_session_id=${encodeURIComponent(sessionId)}`)
      await expect(athlete.page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
      await athlete.page.getByRole('button', { name: 'Start session', exact: true }).click()
      await expect(athlete.page.getByRole('group', { name: 'Set 1', exact: true }).first()).toBeVisible()

      return {
        coach,
        athlete,
        clientId: client.id,
        subjectId: athlete.subjectId,
        assignmentId: publication.assignmentId,
        sessionId,
      }
    } catch (error) {
      await athlete.context.close()
      throw error
    }
  } catch (error) {
    await coach.context.close()
    throw error
  }
}

async function offlineSnapshot(page: Page): Promise<OfflineSnapshot> {
  return page.evaluate(() => new Promise<OfflineSnapshot>((resolve, reject) => {
    const open = indexedDB.open('posture-ai-training-offline', 1)
    open.onerror = () => reject(new Error('Offline training storage unavailable'))
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction(['meta', 'entries'], 'readonly')
      const active = transaction.objectStore('meta').get('activeUser')
      const entries = transaction.objectStore('entries').getAll()
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline training storage read failed'))
      transaction.oncomplete = () => {
        database.close()
        resolve({
          activeUser: (active.result as { userId?: string } | undefined)?.userId ?? null,
          entries: entries.result as OfflineSnapshot['entries'],
        })
      }
    }
  }))
}

async function createPendingSetMutation(setup: LifecycleSetup): Promise<PendingMutation> {
  const { page } = setup.athlete
  const requests: Array<{ requestId?: string }> = []
  const responses: Array<{ status: number; body: unknown; requestBody: unknown }> = []
  page.on('request', request => {
    if (request.method() !== 'PUT'
      || !new URL(request.url()).pathname.startsWith(`/api/training/sessions/${setup.sessionId}/sets/`)) return
    requests.push(request.postDataJSON() as { requestId?: string })
  })
  page.on('response', async response => {
    const request = response.request()
    if (request.method() !== 'PUT'
      || !new URL(request.url()).pathname.startsWith(`/api/training/sessions/${setup.sessionId}/sets/`)) return
    responses.push({
      status: response.status(),
      body: await response.json().catch(() => null),
      requestBody: request.postDataJSON(),
    })
  })
  await page.route('**/api/training/sessions/*/sets/*', route => route.abort('connectionreset'))
  const set = page.getByRole('group', { name: 'Set 1', exact: true }).first()
  await set.getByRole('button', { name: 'Save set', exact: true }).click()
  await expect(page.getByText('1 pending change on this device.', { exact: true })).toBeVisible()
  const snapshot = await offlineSnapshot(page)
  expect(snapshot.entries).toHaveLength(1)
  expect(snapshot.entries[0]).toMatchObject({
    status: 'pending',
    envelope: {
      userId: snapshot.activeUser,
      subjectId: setup.subjectId,
      sessionId: setup.sessionId,
      mutation: { kind: 'set_actual' },
    },
  })
  const requestId = snapshot.entries[0].envelope.requestId
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(requests).toEqual([expect.objectContaining({ requestId })])
  if (!snapshot.activeUser) throw new Error('Offline queue did not retain its authenticated owner')
  const initialBody = requests[0]
  await page.unroute('**/api/training/sessions/*/sets/*')
  return {
    requestId,
    ownerUserId: snapshot.activeUser,
    initialBody,
    requestCount: () => requests.length,
    responses,
  }
}

async function replayAndExpectPurge(
  setup: LifecycleSetup,
  pending: PendingMutation,
  expectedCode: string,
  expectedActiveUser: string | null = pending.ownerUserId,
) {
  const beforeReplay = pending.requestCount()
  await setup.athlete.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => offlineSnapshot(setup.athlete.page)).toMatchObject({
    activeUser: expectedActiveUser,
    entries: [],
  })
  await expect(setup.athlete.page.getByText(
    'Access to this pending change ended. The affected offline queue was cleared.',
    { exact: true },
  )).toBeVisible()
  await expect.poll(() => pending.responses).toContainEqual({
    status: 403,
    body: expect.objectContaining({ error: expectedCode }),
    requestBody: pending.initialBody,
  })
  expect(pending.requestCount()).toBe(beforeReplay + 1)
  await setup.athlete.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await setup.athlete.page.waitForTimeout(500)
  expect(pending.requestCount()).toBe(beforeReplay + 1)
}

test.describe.serial('pending training changes across terminal lifecycle events', () => {
  test('assignment expiry denies exact replay, clears the session queue, and creates no actual', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const setup = await setupCoachAssignedSession(browser, testBaseUrl(testInfo), 'Expiry')
    try {
      const pending = await createPendingSetMutation(setup)
      const before = await readExactSyntheticLifecycle({ ...setup, requestId: pending.requestId })
      expect(before).toMatchObject({
        assignment_status: 'active',
        session_state: 'in_progress',
        set_event_count: 0,
        mutation_receipt_count: 0,
        lifecycle_denial: null,
      })
      await expireExactSyntheticAssignment({
        ...setup,
        requestId: pending.requestId,
        expectedAssignmentRevision: before.assignment_revision,
        expectedSessionRevision: before.session_revision,
      })
      await replayAndExpectPurge(setup, pending, 'assignment_expired')
      const after = await readExactSyntheticLifecycle({ ...setup, requestId: pending.requestId })
      expect(after).toMatchObject({
        assignment_status: 'ended',
        session_state: 'in_progress',
        session_revision: before.session_revision,
        prescription_count: before.prescription_count,
        set_event_count: 0,
        mutation_receipt_count: 0,
        lifecycle_denial: 'assignment_expired',
      })
    } finally {
      await setup.athlete.context.close()
      await setup.coach.context.close()
    }
  })

  test('linked-client erasure denies replay while preserving the planned session evidence', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const setup = await setupCoachAssignedSession(browser, testBaseUrl(testInfo), 'Linked-erasure')
    try {
      const pending = await createPendingSetMutation(setup)
      const before = await readExactSyntheticLifecycle({ ...setup, requestId: pending.requestId })
      expect(before).toMatchObject({
        assignment_status: 'active',
        relationship_status: 'active',
        client_deleted: false,
        session_state: 'in_progress',
        set_event_count: 0,
        mutation_receipt_count: 0,
      })

      await setup.coach.page.goto(`/clients/${encodeURIComponent(setup.clientId)}`)
      await setup.coach.page.getByRole('tab', { name: 'Details', exact: true }).click()
      const erasure = setup.coach.page.getByRole('form', { name: 'Permanently erase client', exact: true })
      await erasure.getByLabel('Type ERASE to confirm', { exact: true }).fill('ERASE')
      await erasure.getByRole('button', { name: 'Permanently erase', exact: true }).click()
      await expect(setup.coach.page).toHaveURL(/\/clients\?erasure=complete/)

      const erased = await readExactSyntheticLifecycle({ ...setup, requestId: pending.requestId })
      expect(erased).toMatchObject({
        assignment_status: 'ended',
        relationship_status: 'revoked',
        client_deleted: true,
        session_state: before.session_state,
        session_revision: before.session_revision,
        prescription_count: before.prescription_count,
        set_event_count: 0,
        mutation_receipt_count: 0,
        lifecycle_denial: 'relationship_revoked',
      })
      await replayAndExpectPurge(setup, pending, 'relationship_revoked')
      const after = await readExactSyntheticLifecycle({ ...setup, requestId: pending.requestId })
      expect(after).toEqual(erased)
    } finally {
      await setup.athlete.context.close()
      await setup.coach.context.close()
    }
  })

  test('committed subject erasure makes pending replay terminal and cannot resurrect the set', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const setup = await setupCoachAssignedSession(browser, testBaseUrl(testInfo), 'Subject-erasure')
    try {
      const pending = await createPendingSetMutation(setup)
      const before = await readExactSyntheticLifecycle({ ...setup, requestId: pending.requestId })
      expect(before).toMatchObject({
        assignment_status: 'active',
        relationship_status: 'active',
        session_state: 'in_progress',
        set_event_count: 0,
        mutation_receipt_count: 0,
        lifecycle_denial: null,
      })
      const erasurePage = await setup.athlete.context.newPage()
      await erasurePage.goto('/train/privacy')
      await erasurePage.getByRole('checkbox').check()
      await erasurePage.getByLabel('Type ERASE MY TRAINING to confirm', { exact: true })
        .fill('ERASE MY TRAINING')
      const erasureAttempts: unknown[] = []
      const committedState: {
        receipt: { requestId: string; subjectId: string; status: string } | null
      } = { receipt: null }
      await erasurePage.route('**/api/training/privacy/erase', async route => {
        erasureAttempts.push(route.request().postDataJSON())
        if (erasureAttempts.length === 1) {
          const committed = await route.fetch()
          expect(committed.status()).toBe(200)
          committedState.receipt = await committed.json() as NonNullable<typeof committedState.receipt>
          await route.abort('connectionreset')
          return
        }
        await route.continue()
      })
      await erasurePage.getByRole('button', { name: 'Permanently erase my training', exact: true }).click()
      await expect(erasurePage.getByRole('button', { name: 'Retry permanent erasure', exact: true })).toBeVisible()
      expect(committedState.receipt).toMatchObject({ subjectId: setup.subjectId, status: 'erased' })

      await replayAndExpectPurge(setup, pending, 'training_actor_required', null)
      const exactReceipt = committedState.receipt
      if (!exactReceipt) throw new Error('Committed subject-erasure receipt was unavailable')
      await readExactSubjectErasure({
        ownerUserId: pending.ownerUserId,
        subjectId: setup.subjectId,
        clientId: setup.clientId,
        erasureRequestId: exactReceipt.requestId,
        pendingRequestId: pending.requestId,
      })

      await erasurePage.getByRole('button', { name: 'Retry permanent erasure', exact: true }).click()
      await expect(erasurePage.getByRole('heading', { name: 'Training data erased', exact: true })).toBeVisible()
      expect(erasureAttempts).toHaveLength(2)
      expect(erasureAttempts[1]).toEqual(erasureAttempts[0])
      await expect.poll(() => offlineSnapshot(erasurePage)).toMatchObject({ activeUser: null, entries: [] })
      await readExactSubjectErasure({
        ownerUserId: pending.ownerUserId,
        subjectId: setup.subjectId,
        clientId: setup.clientId,
        erasureRequestId: exactReceipt.requestId,
        pendingRequestId: pending.requestId,
      })
      await erasurePage.close()
    } finally {
      await setup.athlete.context.close()
      await setup.coach.context.close()
    }
  })
})
