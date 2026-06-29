import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// The authoritative capture gate lives in POST /api/assessments: a valid subject
// consent + the age policy must hold before anything is persisted/scored
// (BIPA pre-capture consent; COPPA/minor: under-13 blocked, 13–17 needs a
// guardian-signed consent). Tested at the API for precision. Chromium only — it's
// project-agnostic, so running it once avoids doubling assessment rate-limit use.
test.describe('capture consent + age gate', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API-level gate; run once on chromium')

  const year = new Date().getFullYear()
  const dob = (ageYears: number) => `${year - ageYears}-06-15`
  const tag = () => randomUUID().slice(0, 8)
  const assess = (page: Page, clientId: string) =>
    page.request.post('/api/assessments', { data: { client_id: clientId, test_mode: true } })

  test('adult with consent can be assessed', async ({ page }) => {
    const c = await createClient(page, 'E2E', `Adult-${tag()}`, { dateOfBirth: dob(30) })
    const res = await assess(page, c.id)
    expect(res.ok(), `expected 200, got ${res.status()}`).toBeTruthy()
  })

  test('under-13 is blocked even with consent', async ({ page }) => {
    const c = await createClient(page, 'E2E', `Child-${tag()}`, { dateOfBirth: dob(8) })
    const res = await assess(page, c.id)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toMatch(/under 13/i)
  })

  test('minor 13–17 with only self consent is blocked (guardian required)', async ({ page }) => {
    const c = await createClient(page, 'E2E', `Teen-${tag()}`, { dateOfBirth: dob(15), signerRelationship: 'self' })
    const res = await assess(page, c.id)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toMatch(/guardian/i)
  })

  test('minor 13–17 with guardian consent is allowed', async ({ page }) => {
    const c = await createClient(page, 'E2E', `TeenOk-${tag()}`, { dateOfBirth: dob(15), signerRelationship: 'legal_guardian' })
    const res = await assess(page, c.id)
    expect(res.ok(), `expected 200, got ${res.status()}`).toBeTruthy()
  })

  test('a client without consent (remote pending) is blocked', async ({ page }) => {
    const c = await createClient(page, 'E2E', `NoConsent-${tag()}`, { dateOfBirth: dob(30), remote: true })
    const res = await assess(page, c.id)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toMatch(/consent/i)
  })

  test('remote consent link records consent (single-use) and unlocks capture', async ({ page }) => {
    const c = await createClient(page, 'E2E', `Remote-${tag()}`, { dateOfBirth: dob(30), remote: true })

    // Remote-pending → blocked until consent arrives.
    expect((await assess(page, c.id)).status()).toBe(403)

    // Practitioner mints the remote link.
    const link = await page.request.post('/api/consent/link', { data: { client_id: c.id } })
    expect(link.ok(), `link failed: ${link.status()}`).toBeTruthy()
    const token = String((await link.json()).url).split('/consent/')[1]

    // Subject completes it (public endpoint).
    const respond = await page.request.post('/api/consent/respond', {
      data: { token, signer_name: 'Adult Subject', signer_relationship: 'self' },
    })
    expect(respond.ok(), `respond failed: ${respond.status()}`).toBeTruthy()

    // Single-use: a second submission with the same token is rejected.
    const again = await page.request.post('/api/consent/respond', {
      data: { token, signer_name: 'Adult Subject', signer_relationship: 'self' },
    })
    expect(again.status()).toBe(410)

    // Capture is now allowed.
    expect((await assess(page, c.id)).ok()).toBeTruthy()
  })
})
