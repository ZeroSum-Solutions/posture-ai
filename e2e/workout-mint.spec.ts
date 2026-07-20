import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// Human-in-the-loop gate for the guided workout player: a session may only be
// minted from an APPROVED assessment (mirror of the report-export gate). Also
// covers the public share-token surface returning a uniform 404 for a bad token.
// API-level; chromium only.
test.describe('workout mint approval gate', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API-level gate; run once on chromium')

  async function createCompleteAssessment(page: Page): Promise<string> {
    const c = await createClient(page, 'E2E', `Mint-${randomUUID().slice(0, 8)}`)
    const res = await page.request.post('/api/assessments', { data: { client_id: c.id, submission_id: randomUUID(), test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    return (await res.json()).id as string
  }

  test('minting a session is blocked until the practitioner approves', async ({ page }) => {
    const assessmentId = await createCompleteAssessment(page)

    // Unapproved → 403.
    const blocked = await page.request.post('/api/workouts', { data: { assessment_id: assessmentId } })
    expect(blocked.status(), 'unapproved mint must be blocked').toBe(403)
    expect((await blocked.json()).error).toMatch(/approv/i)

    // Approve, then a session mints.
    const approve = await page.request.patch(`/api/assessments/${assessmentId}/approve`, { data: { approved: true } })
    expect(approve.ok(), `approve failed: ${approve.status()}`).toBeTruthy()

    const after = await page.request.post('/api/workouts', { data: { assessment_id: assessmentId } })
    expect(after.status(), 'approval should clear the 403 mint gate').toBe(200)
    const body = await after.json()
    expect(body.session_id, 'mint should return a session id').toBeTruthy()
  })

  test('the public token route returns a uniform 404 for an unknown share token', async ({ page }) => {
    // No auth cookie needed; a random token must not resolve.
    const res = await page.request.get(`/api/workouts/token/${randomUUID()}${randomUUID()}`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toMatch(/not available/i)
    expect(res.headers()['cache-control'], 'PHI-bearing token response must be no-store').toContain('no-store')
  })

  test('a minted share token resolves to a redacted projection (no internal ids)', async ({ page }) => {
    const assessmentId = await createCompleteAssessment(page)
    await page.request.patch(`/api/assessments/${assessmentId}/approve`, { data: { approved: true } })

    const mint = await page.request.post('/api/workouts', { data: { assessment_id: assessmentId, share: true } })
    expect(mint.ok()).toBeTruthy()
    const shareLink = (await mint.json()).share_link as string
    expect(shareLink, 'share:true should return a share link').toBeTruthy()
    const token = shareLink.split('/s/')[1]

    // Public fetch with NO auth context — a fresh request context has no cookies.
    const pub = await page.request.get(`/api/workouts/token/${token}`)
    expect(pub.status(), 'a live approved token should resolve').toBe(200)
    const body = await pub.json()
    // Only the redacted projection is exposed.
    expect(Object.keys(body).sort()).toEqual(['clientFirstName', 'estimatedDurationSec', 'expiresAt', 'snapshot'])
    const raw = JSON.stringify(body)
    for (const internal of ['workout_session_id', 'practitioner_id', 'client_id', 'session_run_id']) {
      expect(raw, `${internal} must never reach the public client`).not.toContain(internal)
    }
  })
})
