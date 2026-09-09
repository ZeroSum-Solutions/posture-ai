import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from './helpers'
import {
  grantPrivatePracticeRelationshipRevocation,
  readCoachAssignedProgramEvidence,
} from './helpers/training-coaching-relationship-fixture'
import { totpCode } from '../scripts/testing/totp'

const ALL_COACH_PERMISSIONS = [
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

type RelationshipProjection = {
  schemaVersion: 'training-coaching-relationship-list.v1'
  subjectId: string
  viewerRole: 'athlete' | 'coach'
  relationships: Array<{
    relationshipId: string
    status: 'active' | 'revoked'
    revision: number
    canRevoke: boolean
  }>
}

type RevocationReceipt = {
  schemaVersion: 'training-coaching-relationship-revocation.v1'
  requestId: string
  relationshipId: string
  subjectId: string
  status: 'revoked'
  revision: number
  affectedSessionIds: string[]
}

async function responseBody<T>(response: { ok(): boolean; status(): number; json(): Promise<unknown> }): Promise<T> {
  const body = await response.json()
  expect(response.ok(), `request failed (${response.status()}): ${JSON.stringify(body)}`).toBeTruthy()
  return body as T
}

async function acceptAthleteInvitation(
  browser: Browser,
  baseUrl: string,
  invitationUrl: string,
  password: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  await page.goto(invitationUrl)
  await expect(page.getByRole('heading', { name: 'Accept athlete invitation', exact: true })).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Continue to multi-factor setup', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa\?mode=athlete-invite/)
  const setupKey = await page.getByText('Or enter this setup key', { exact: true })
    .locator('xpath=following-sibling::p[1]').textContent()
  if (!setupKey) throw new Error('Athlete authenticator setup key was unavailable')
  await page.getByLabel('Authenticator code').fill(totpCode(setupKey.replace(/\s/g, '')))
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/train')
  return { context, page }
}

async function pendingEntries(page: Page, subjectId: string, sessionId: string) {
  return page.evaluate(({ subjectId: subject, sessionId: session }) => new Promise<Array<{
    requestId: string
    subjectId: string
    sessionId: string
  }>>((resolve, reject) => {
    const open = indexedDB.open('posture-ai-training-offline', 1)
    open.onerror = () => reject(new Error('Training offline database could not be opened'))
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction('entries', 'readonly')
      const request = transaction.objectStore('entries').getAll()
      request.onerror = () => reject(new Error('Training offline entries could not be read'))
      request.onsuccess = () => resolve(request.result
        .map(entry => entry?.envelope)
        .filter(envelope => envelope?.subjectId === subject && envelope?.sessionId === session)
        .map(envelope => ({
          requestId: envelope.requestId,
          subjectId: envelope.subjectId,
          sessionId: envelope.sessionId,
        })))
      transaction.oncomplete = () => database.close()
    }
  }), { subjectId, sessionId })
}

test('the athlete owner explicitly ends a coaching connection and the coach loses access', async ({ browser, page }) => {
  test.setTimeout(120_000)
  await page.goto('/workouts')
  const token = randomUUID().slice(0, 8)
  const client = await createClient(page, 'Relationship', `Owner-${token}`)
  const email = `relationship-owner-${randomUUID()}@fixtures.invalid`
  const password = `LocalRelationship-${randomUUID()}!`
  const prepared = await responseBody<{
    status: 'prepared'
    invitationUrl: string
  }>(await page.request.post('/api/training/coaching/invitations', {
    data: {
      requestId: randomUUID(),
      clientId: client.id,
      email,
      permissions: ALL_COACH_PERMISSIONS,
    },
  }))

  const athlete = await acceptAthleteInvitation(browser, new URL(page.url()).origin, prepared.invitationUrl, password)
  try {
    const projection = await responseBody<RelationshipProjection>(
      await athlete.page.request.get('/api/training/coaching/relationships'),
    )
    expect(projection.viewerRole).toBe('athlete')
    expect(projection.relationships).toHaveLength(1)
    expect(projection.relationships[0]).toMatchObject({ status: 'active', canRevoke: true })

    await expect(athlete.page.getByRole('heading', { name: 'Coaching connections', exact: true })).toBeVisible()
    await athlete.page.getByRole('button', { name: 'End coaching connection', exact: true }).click()
    const dialog = athlete.page.getByRole('alertdialog', { name: 'End this coaching connection?', exact: true })
    await expect(dialog).toContainText('does not create or convert a self-directed program')
    await dialog.getByRole('button', { name: 'End connection and coach access', exact: true }).click()
    await expect(athlete.page.getByText(/Coaching connection ended/)).toBeVisible()
    await expect(athlete.page.getByText('No active coaching connection.', { exact: true })).toBeVisible()

    const ownerProfile = await athlete.page.request.get(
      `/api/training/profile?subjectId=${encodeURIComponent(projection.subjectId)}`,
    )
    expect(ownerProfile.status()).toBe(200)
    const ownerRelationshipHistory = await responseBody<RelationshipProjection>(
      await athlete.page.request.get('/api/training/coaching/relationships'),
    )
    expect(ownerRelationshipHistory).toMatchObject({
      subjectId: projection.subjectId,
      viewerRole: 'athlete',
      relationships: [{
        relationshipId: projection.relationships[0].relationshipId,
        status: 'revoked',
        canRevoke: false,
      }],
    })
    const coachProfile = await page.request.get(`/api/training/profile?clientId=${encodeURIComponent(client.id)}`)
    expect(coachProfile.status()).toBe(403)
    const coachRelationships = await page.request.get(
      `/api/training/coaching/relationships?subjectId=${encodeURIComponent(projection.subjectId)}`,
    )
    const coachRelationshipHistory = await responseBody<RelationshipProjection>(coachRelationships)
    expect(coachRelationshipHistory).toMatchObject({
      subjectId: projection.subjectId,
      viewerRole: 'coach',
      relationships: [],
    })
  } finally {
    await athlete.context.close()
  }
})

test('a permissioned coach retries one lost revocation receipt and clears only receipt-bound pending work', async ({ page }) => {
  test.setTimeout(120_000)
  const setup = await responseBody<{ subjectId: string; profileRevision: number }>(
    await page.request.post('/api/training/simulation/setup'),
  )
  const relationship = await grantPrivatePracticeRelationshipRevocation(setup.subjectId)

  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Coaching connections', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'End coaching connection', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
  await page.getByRole('button', { name: 'Build practice draft' }).click()
  await expect(page.getByRole('heading', { name: '8-week draft', exact: true })).toBeVisible()
  const publicationResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/training/programs/publish'
  ))
  await page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
  const publication = await responseBody<{ assignmentId: string }>(await publicationResponse)
  await expect(page.getByText('Starting targets accepted and program created.', { exact: true })).toBeVisible()

  const firstStrengthHref = await page.getByRole('link', { name: 'Open first strength session', exact: true }).getAttribute('href')
  if (!firstStrengthHref) throw new Error('First strength session link was unavailable')
  const firstSessionId = new URL(firstStrengthHref, page.url()).searchParams.get('training_session_id')
  if (!firstSessionId) throw new Error('First strength session identifier was unavailable')
  await page.goto(firstStrengthHref)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  const firstSet = page.getByRole('group', { name: 'Set 1', exact: true }).first()
  await firstSet.getByRole('button', { name: 'Save set', exact: true }).click()
  await expect(firstSet.getByRole('button', { name: 'Set saved', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Finish with \d+ omissions?/ }).click()
  await expect(page.getByText(/session is completed with omissions/i)).toBeVisible()

  const workspace = await responseBody<{ sessions: Array<{ sessionId: string; kind: string; state: string }> }>(
    await page.request.get(`/api/training/programs/${encodeURIComponent(publication.assignmentId)}/workspace?view=program`),
  )
  const nextStrength = workspace.sessions.find(session => session.kind === 'strength' && session.state === 'scheduled')
  if (!nextStrength) throw new Error('A second scheduled strength session was unavailable')
  const nextStrengthHref = `/workouts?training_session_id=${encodeURIComponent(nextStrength.sessionId)}`
  await page.goto(nextStrengthHref)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()

  const setRequests: unknown[] = []
  const setRequestUrls: string[] = []
  page.on('request', request => {
    if (request.method() === 'PUT' && /\/api\/training\/sessions\/[^/]+\/sets\/[^/]+$/.test(new URL(request.url()).pathname)) {
      setRequestUrls.push(request.url())
    }
  })
  await page.route('**/api/training/sessions/*/sets/*', route => {
    setRequests.push(route.request().postDataJSON())
    return route.abort('connectionreset')
  })
  await page.getByRole('group', { name: 'Set 1', exact: true }).first()
    .getByRole('button', { name: 'Save set', exact: true }).click()
  await expect(page.getByText('1 pending change on this device.', { exact: true })).toBeVisible()
  await expect.poll(() => pendingEntries(page, setup.subjectId, nextStrength.sessionId)).toHaveLength(1)

  const before = await readCoachAssignedProgramEvidence(relationship.relationship_id, publication.assignmentId)
  expect(before).toMatchObject({
    subject_id: setup.subjectId,
    program_mode: 'coach_assigned',
    assignment_status: 'active',
    relationship_status: 'active',
  })
  expect(before.session_states[firstSessionId]).toBe('completed_with_omissions')
  expect(before.session_states[nextStrength.sessionId]).toBe('in_progress')
  expect(before.set_event_count).toBeGreaterThan(0)

  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Coaching connections', exact: true })).toBeVisible()
  const revokeRequests: unknown[] = []
  let committedReceipt: RevocationReceipt | null = null
  await page.route(`**/api/training/coaching/relationships/${relationship.relationship_id}/revoke`, async route => {
    revokeRequests.push(route.request().postDataJSON())
    if (revokeRequests.length === 1) {
      const committed = await route.fetch()
      expect(committed.status()).toBe(200)
      committedReceipt = await committed.json() as RevocationReceipt
      await route.abort('connectionreset')
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'End coaching connection', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'End this coaching connection?', exact: true })
  await expect(dialog).toContainText('Existing planned sessions and training history stay available')
  await dialog.getByRole('button', { name: 'End connection and coach access', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry same revocation', exact: true })).toBeVisible()
  await expect.poll(() => pendingEntries(page, setup.subjectId, nextStrength.sessionId)).toHaveLength(1)

  const retryResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`/relationships/${relationship.relationship_id}/revoke`)
  ))
  await page.getByRole('button', { name: 'Retry same revocation', exact: true }).click()
  const retryReceipt = await responseBody<RevocationReceipt>(await retryResponse)
  await expect(page.getByText('Coaching access has ended. The athlete’s training history is preserved.', { exact: true })).toBeVisible()
  expect(revokeRequests).toHaveLength(2)
  expect(revokeRequests[1]).toEqual(revokeRequests[0])
  expect(retryReceipt).toEqual(committedReceipt)
  expect(retryReceipt.requestId).toBe((revokeRequests[0] as { requestId: string }).requestId)
  expect(retryReceipt.relationshipId).toBe(relationship.relationship_id)
  expect(retryReceipt.subjectId).toBe(setup.subjectId)
  expect(retryReceipt.affectedSessionIds).toContain(nextStrength.sessionId)
  await expect.poll(() => pendingEntries(page, setup.subjectId, nextStrength.sessionId)).toHaveLength(0)

  const requestsAfterCleanup = setRequestUrls.length
  await page.unroute('**/api/training/sessions/*/sets/*')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(500)
  expect(setRequestUrls).toHaveLength(requestsAfterCleanup)

  const after = await readCoachAssignedProgramEvidence(relationship.relationship_id, publication.assignmentId)
  expect(after).toMatchObject({
    assignment_id: before.assignment_id,
    subject_id: before.subject_id,
    owning_practitioner_id: before.owning_practitioner_id,
    program_mode: 'coach_assigned',
    assignment_status: 'ended',
    relationship_status: 'revoked',
    program_revision_count: before.program_revision_count,
    set_event_count: before.set_event_count,
  })
  expect(after.session_states[firstSessionId]).toBe('completed_with_omissions')
  expect(after.session_states[nextStrength.sessionId]).toBe('in_progress')
  const deniedProfile = await page.request.get(
    `/api/training/profile?subjectId=${encodeURIComponent(setup.subjectId)}`,
  )
  expect(deniedProfile.status()).toBe(403)
  const deniedProgram = await page.request.get(
    `/api/training/programs/${encodeURIComponent(publication.assignmentId)}`,
  )
  // The program read boundary intentionally makes an inaccessible assignment
  // indistinguishable from a missing one after RLS removes it from projection.
  expect(deniedProgram.status()).toBe(404)
})
