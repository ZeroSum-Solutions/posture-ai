import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from './helpers'
import {
  attachStarterPracticeToAcceptedAthlete,
} from './helpers/training-coach-athlete-handoff-fixture'
import { readCoachAssignedProgramEvidence } from './helpers/training-coaching-relationship-fixture'
import { totpCode } from '../scripts/testing/totp'

const permissionLabels = [
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

async function responseBody<T>(response: {
  ok(): boolean
  status(): number
  json(): Promise<unknown>
}): Promise<T> {
  const body = await response.json()
  expect(response.ok(), `request failed (${response.status()}): ${JSON.stringify(body)}`).toBeTruthy()
  return body as T
}

async function acceptInvitationWithMfa(input: {
  browser: Browser
  baseUrl: string
  invitationUrl: string
  password: string
}): Promise<{ context: BrowserContext; page: Page }> {
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
  await expect(page.getByRole('heading', { name: 'My training', exact: true })).toBeVisible()
  return { context, page }
}

test('coach hands a real invited athlete a private program, the athlete logs it, and revocation preserves history', async ({ browser, page }) => {
  test.setTimeout(180_000)
  const token = randomUUID().replaceAll('-', '')
  const athleteEmail = `simulation+${token}@fixtures.invalid`
  const athletePassword = `LocalHandoff-${randomUUID()}!`

  await page.goto('/workouts')
  const client = await createClient(page, 'Handoff', `Athlete-${token.slice(0, 8)}`)
  await page.goto('/workouts')
  await page.getByLabel('Build strength program for').selectOption(client.id)
  await expect(page.getByText('Athlete setup required', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Invite athlete', exact: true }).click()
  await page.getByLabel('Athlete email').fill(athleteEmail)
  for (const label of permissionLabels) {
    await page.getByRole('checkbox', { name: label, exact: true }).check()
  }
  await page.getByRole('button', { name: 'Prepare invitation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Invitation ready', exact: true })).toBeVisible()
  await expect(page.getByText(/No message was sent automatically/)).toBeVisible()
  const invitationUrl = await page.getByLabel('Invitation link', { exact: true }).inputValue()

  const athlete = await acceptInvitationWithMfa({
    browser,
    baseUrl: new URL(page.url()).origin,
    invitationUrl,
    password: athletePassword,
  })
  try {
    const relationships = await responseBody<RelationshipProjection>(
      await athlete.page.request.get('/api/training/coaching/relationships'),
    )
    expect(relationships).toMatchObject({
      viewerRole: 'athlete',
      relationships: [{ status: 'active', canRevoke: true }],
    })
    expect(relationships.relationships).toHaveLength(1)

    const fixture = await attachStarterPracticeToAcceptedAthlete({
      subjectId: relationships.subjectId,
      clientId: client.id,
      athleteEmail,
    })
    expect(fixture.relationship_id).toBe(relationships.relationships[0].relationshipId)

    await page.goto('/workouts')
    const setupResponse = page.waitForResponse(response => (
      response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/training/simulation/setup'
    ))
    await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
    const setup = await responseBody<{ subjectId: string; profileRevision: number }>(await setupResponse)
    expect(setup).toEqual({ subjectId: relationships.subjectId, profileRevision: 1 })
    await expect(page.getByText('Practice data · Simulation', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('Profile revision 1', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
    await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
    await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
    await expect(page.getByRole('heading', { name: '8-week draft', exact: true })).toBeVisible()
    await expect(page.getByText('Practice data · Simulation', { exact: true }).last()).toBeVisible()

    const publicationResponse = page.waitForResponse(response => (
      response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/training/programs/publish'
    ))
    await page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
    const publication = await responseBody<{ assignmentId: string }>(await publicationResponse)
    await expect(page.getByText('Starting targets accepted and program created.', { exact: true })).toBeVisible()
    const coachSessionHref = await page.getByRole('link', { name: 'Open first strength session', exact: true }).getAttribute('href')
    if (!coachSessionHref) throw new Error('First coach-authored strength session was unavailable')
    const firstSessionId = new URL(coachSessionHref, page.url()).searchParams.get('training_session_id')
    if (!firstSessionId) throw new Error('First coach-authored session identifier was unavailable')

    await athlete.page.goto(`/train?training_session_id=${encodeURIComponent(firstSessionId)}`)
    await expect(athlete.page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible()
    await expect(athlete.page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
    await athlete.page.getByRole('button', { name: 'Start session', exact: true }).click()
    const firstSet = athlete.page.getByRole('group', { name: 'Set 1', exact: true }).first()
    await firstSet.getByRole('combobox', { name: 'RIR', exact: true }).selectOption('3')
    await firstSet.getByRole('button', { name: 'Save set', exact: true }).click()
    await expect(firstSet.getByRole('button', { name: 'Set saved', exact: true })).toBeVisible()
    await athlete.page.getByRole('button', { name: /Finish with \d+ omissions?/ }).click()
    await expect(athlete.page.getByText(/session is completed with omissions/i)).toBeVisible()

    const beforeRevocation = await readCoachAssignedProgramEvidence(
      fixture.relationship_id,
      publication.assignmentId,
    )
    expect(beforeRevocation).toMatchObject({
      subject_id: relationships.subjectId,
      program_mode: 'coach_assigned',
      assignment_status: 'active',
      relationship_status: 'active',
      program_revision_count: 1,
    })
    expect(beforeRevocation.session_states[firstSessionId]).toBe('completed_with_omissions')
    expect(beforeRevocation.set_event_count).toBeGreaterThan(0)

    await page.goto('/workouts')
    await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
    await expect(page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'End coaching connection', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'End this coaching connection?', exact: true })
    await expect(dialog).toContainText('Existing planned sessions and training history stay available')
    await dialog.getByRole('button', { name: 'End connection and coach access', exact: true }).click()
    await expect(page.getByText('Coaching access has ended. The athlete’s training history is preserved.', { exact: true })).toBeVisible()

    const afterRevocation = await readCoachAssignedProgramEvidence(
      fixture.relationship_id,
      publication.assignmentId,
    )
    expect(afterRevocation).toMatchObject({
      assignment_id: beforeRevocation.assignment_id,
      subject_id: beforeRevocation.subject_id,
      owning_practitioner_id: beforeRevocation.owning_practitioner_id,
      program_mode: 'coach_assigned',
      assignment_status: 'ended',
      relationship_status: 'revoked',
      program_revision_count: beforeRevocation.program_revision_count,
      set_event_count: beforeRevocation.set_event_count,
    })
    expect(afterRevocation.session_states[firstSessionId]).toBe('completed_with_omissions')

    const deniedProfile = await page.request.get(
      `/api/training/profile?subjectId=${encodeURIComponent(relationships.subjectId)}`,
    )
    expect(deniedProfile.status()).toBe(403)
    const deniedProgram = await page.request.get(
      `/api/training/programs/${encodeURIComponent(publication.assignmentId)}`,
    )
    expect(deniedProgram.status()).toBe(404)

    const athleteProgram = await athlete.page.request.get(
      `/api/training/programs/${encodeURIComponent(publication.assignmentId)}`,
    )
    expect(athleteProgram.status()).toBe(200)
    await athlete.page.reload()
    await expect(athlete.page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
    await expect(athlete.page.getByText(/session is completed with omissions/i)).toBeVisible()
    await expect(athlete.page.getByRole('group', { name: 'Set 1', exact: true }).first()
      .getByRole('button', { name: 'Set saved', exact: true })).toBeVisible()
  } finally {
    await athlete.context.close()
  }
})
