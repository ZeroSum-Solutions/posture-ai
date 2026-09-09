import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from './helpers'
import { attachStarterPracticeToAcceptedAthlete } from './helpers/training-coach-athlete-handoff-fixture'
import { TrainingLaunchMediaProjectionV1Schema } from '../lib/training/media/contract'
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

type MediaPhase = 'blocked_video' | 'invalid_video' | 'invalid_poster' | 'expires_while_open'

type SessionResponse = {
  schemaVersion: 'training-session-projection.v1'
  session: { id: string; revision: number }
  prescription: {
    schemaVersion: 'training-session-prescription.v1'
    catalogVersion: string
    catalogOrigin: {
      kind: 'synthetic_fixture'
      source: 'server_fixture'
      fixtureId: string
      fixtureHash: string
      label: string
    }
    exercises: Array<{ exerciseInstanceId: string; exerciseVersionId: string }>
  }
  exerciseDisplay: Record<string, {
    label: string
    textInstruction: string | null
    mediaStatus: string
    media?: unknown
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

function assertSyntheticSession(value: unknown, sessionId: string): asserts value is SessionResponse {
  const candidate = value as Partial<SessionResponse>
  if (candidate.schemaVersion !== 'training-session-projection.v1'
    || candidate.session?.id !== sessionId
    || candidate.prescription?.schemaVersion !== 'training-session-prescription.v1'
    || candidate.prescription.catalogOrigin?.kind !== 'synthetic_fixture'
    || !Array.isArray(candidate.prescription.exercises)
    || typeof candidate.exerciseDisplay !== 'object'
    || candidate.exerciseDisplay === null) {
    throw new Error('Expected an exact synthetic strength-session projection')
  }
}

function syntheticMedia(
  response: SessionResponse,
  phase: MediaPhase,
) {
  const exercise = response.prescription.exercises[0]
  if (!exercise) throw new Error('Synthetic session has no exercise')
  const origin = response.prescription.catalogOrigin
  const binding = {
    catalogVersion: response.prescription.catalogVersion,
    catalogOrigin: origin,
    exerciseVersionId: exercise.exerciseVersionId,
  }
  const assets = phase === 'blocked_video' || phase === 'invalid_video'
    ? {
      video: {
        path: phase === 'blocked_video'
          ? '/training-media-e2e/demonstration.webm'
          : '/training-media-e2e/invalid.webm',
        mimeType: 'video/webm' as const,
        width: 640,
        height: 480,
      },
      poster: {
        path: '/training-media-e2e/poster.svg',
        alt: 'Synthetic exercise setup and movement positions.',
        width: 640,
        height: 480,
      },
    }
    : {
      poster: {
        path: phase === 'invalid_poster'
          ? '/training-media-e2e/invalid.webp'
          : '/training-media-e2e/poster.svg',
        alt: 'Synthetic exercise setup and movement positions.',
        width: 640,
        height: 480,
      },
    }
  return {
    exercise,
    projection: TrainingLaunchMediaProjectionV1Schema.parse({
      schemaVersion: 'training-launch-media-projection.v1',
      status: 'available',
      binding,
      review: {
        kind: 'synthetic_fixture',
        fixtureId: origin.fixtureId,
        fixtureHash: origin.fixtureHash,
      },
      source: {
        rightsRecordId: 'fixture:rights:training-media-e2e',
        provider: 'Posture AI browser fixture',
        assetId: 'fixture:asset:training-media-e2e',
        sourcePageUrl: 'https://example.invalid/posture-ai/synthetic-media',
        author: 'Synthetic browser fixture',
        license: {
          identifier: 'TEST-ONLY',
          name: 'Synthetic test fixture only',
          url: 'https://example.invalid/posture-ai/synthetic-license',
        },
      },
      assets,
      expiresAt: phase === 'expires_while_open'
        ? new Date(Date.now() + 3_000).toISOString()
        : null,
    }),
  }
}

test('launch exercise media falls back through poster and instructions and expires while the athlete session stays open', async ({ browser, page }) => {
  test.setTimeout(180_000)
  const token = randomUUID().replaceAll('-', '')
  const athleteEmail = `simulation+${token}@fixtures.invalid`
  const athletePassword = `LocalMedia-${randomUUID()}!`

  await page.goto('/workouts')
  const client = await createClient(page, 'Media', `Athlete-${token.slice(0, 8)}`)
  const invitation = await responseBody<{ invitationUrl: string }>(
    await page.request.post('/api/training/coaching/invitations', {
      data: {
        requestId: randomUUID(),
        clientId: client.id,
        email: athleteEmail,
        permissions: [...permissions],
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

    const scheduled = await responseBody<SessionResponse>(
      await athlete.page.request.get(`/api/training/sessions/${encodeURIComponent(sessionId)}`),
    )
    const started = await athlete.page.request.post(
      `/api/training/sessions/${encodeURIComponent(sessionId)}/start`,
      { data: { expectedRevision: scheduled.session.revision } },
    )
    expect(started.ok(), `session start failed: ${started.status()}`).toBeTruthy()

    let phase: MediaPhase = 'blocked_video'
    let instruction = ''
    await athlete.page.route('**/training-media-e2e/demonstration.webm', route => route.abort('failed'))
    await athlete.page.route('**/training-media-e2e/invalid.webm', route => route.fulfill({
      status: 200,
      contentType: 'video/webm',
      body: 'not-a-video',
    }))
    await athlete.page.route('**/training-media-e2e/poster.svg', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d8d4cb"/><circle cx="320" cy="180" r="60" fill="#45423d"/><path d="M320 240v120M250 290h140M280 440l40-80 40 80" stroke="#45423d" stroke-width="24" fill="none"/></svg>',
    }))
    await athlete.page.route('**/training-media-e2e/invalid.webp', route => route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: 'not-an-image',
    }))
    await athlete.page.route('**/api/training/sessions/**', async route => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET'
        || url.pathname !== `/api/training/sessions/${sessionId}`) {
        await route.continue()
        return
      }
      const upstream = await route.fetch()
      const body: unknown = await upstream.json()
      assertSyntheticSession(body, sessionId)
      const injected = syntheticMedia(body, phase)
      const display = body.exerciseDisplay[injected.exercise.exerciseInstanceId]
      if (!display?.textInstruction) throw new Error('Version-bound written instruction was unavailable')
      instruction = display.textInstruction
      display.media = injected.projection
      await route.fulfill({ response: upstream, json: body })
    })

    await athlete.page.goto(`/train?training_session_id=${encodeURIComponent(sessionId)}`)
    await expect(athlete.page.getByText('Practice data · Simulation', { exact: true })).toBeVisible()
    await expect(athlete.page.getByText('Practice media · Simulation', { exact: true }).first()).toBeVisible()
    await expect(athlete.page.getByText(instruction, { exact: true }).first()).toBeVisible()
    const mediaBlock = athlete.page.getByText(instruction, { exact: true }).first().locator('..')
    const video = mediaBlock.getByLabel('Exercise demonstration', { exact: true })
    await expect(video).toBeVisible()
    const failedVideo = athlete.page.waitForEvent('requestfailed', request => (
      new URL(request.url()).pathname === '/training-media-e2e/demonstration.webm'
    ))
    // preload="none" is deliberate; this programmatic load is fault injection,
    // not evidence that a person operated native video controls.
    await video.evaluate(element => (element as HTMLVideoElement).load())
    await failedVideo
    const poster = mediaBlock.getByRole('img', {
      name: 'Synthetic exercise setup and movement positions.',
      exact: true,
    }).first()
    await expect(poster).toBeVisible()
    await expect(poster).toHaveAttribute('src', '/training-media-e2e/poster.svg')
    await expect.poll(() => poster.evaluate(image => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    await expect(athlete.page.getByText(instruction, { exact: true }).first()).toBeVisible()

    phase = 'invalid_video'
    await athlete.page.reload()
    await expect(video).toBeVisible()
    const invalidVideoResponse = athlete.page.waitForResponse(response => (
      new URL(response.url()).pathname === '/training-media-e2e/invalid.webm'
    ))
    // A completed HTTP 200 response with invalid WebM bytes exercises native
    // decode failure separately from the blocked-request case above.
    await video.evaluate(element => (element as HTMLVideoElement).load())
    const invalidVideo = await invalidVideoResponse
    expect(invalidVideo.status()).toBe(200)
    expect(invalidVideo.headers()['content-type']).toContain('video/webm')
    await expect(poster).toBeVisible()
    await expect(poster).toHaveAttribute('src', '/training-media-e2e/poster.svg')
    await expect.poll(() => poster.evaluate(image => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    await expect(athlete.page.getByText(instruction, { exact: true }).first()).toBeVisible()

    phase = 'invalid_poster'
    await athlete.page.reload()
    await expect(mediaBlock.getByRole('status').filter({ hasText: /could not load/i })).toBeVisible()
    await expect(mediaBlock.locator('video, img')).toHaveCount(0)
    await expect(athlete.page.getByText(instruction, { exact: true }).first()).toBeVisible()
    await expect(athlete.page.getByRole('button', { name: 'Save set', exact: true }).first()).toBeVisible()

    phase = 'expires_while_open'
    await athlete.page.reload()
    const expiringPoster = mediaBlock.getByRole('img', {
      name: 'Synthetic exercise setup and movement positions.',
      exact: true,
    }).first()
    await expect(expiringPoster).toBeVisible()
    await expect(athlete.page.getByText(instruction, { exact: true }).first()).toBeVisible()
    await expect(mediaBlock.getByRole('status').filter({ hasText: /media has expired/i }))
      .toBeVisible({ timeout: 8_000 })
    await expect(mediaBlock.locator('video, img')).toHaveCount(0)
    await expect(athlete.page.getByText(instruction, { exact: true }).first()).toBeVisible()
    await expect(athlete.page.getByRole('button', { name: 'Save set', exact: true }).first()).toBeVisible()
  } finally {
    await athlete.context.close()
  }
})
