import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
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

test.describe('wizard consent recovery', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'Phone recovery flow; run once on mobile WebKit')

  test('repairs a legacy consent timestamp and continues with the selected client', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    const fullName = `E2E Legacy-${suffix}`
    const client = await createClient(page, 'E2E', `Legacy-${suffix}`, {
      dateOfBirth: '1990-01-01',
      remote: true,
    })

    const supabaseUrl = process.env.E2E_SUPABASE_URL
    const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl?.startsWith('http://127.0.0.1') || !serviceKey) {
      throw new Error('Wizard consent recovery requires the local Supabase service client')
    }
    const service = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Reproduce the legacy split-brain state: the client row says consent was
    // recorded, but the canonical consent event table has no valid record.
    const { error: stampError } = await service
      .from('clients')
      .update({ consent_recorded_at: '2026-01-01T00:00:00.000Z' })
      .eq('id', client.id)
    expect(stampError).toBeNull()

    // The client record must use the canonical event too; a legacy timestamp
    // must not hide every available way to repair consent.
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByRole('form', { name: 'Record in-person consent' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Send remote consent link' })).toBeVisible()

    await page.goto(`/assessments/new?client_id=${client.id}`)
    const nextButton = page.getByRole('button', { name: 'Next: Upload Views' })
    await expect(nextButton).toBeEnabled({ timeout: 10_000 })
    await nextButton.click()

    await expect(page.getByText('Subject consent is required before screening can begin.')).toBeVisible()
    const form = page.getByRole('form', { name: 'Record in-person consent' })
    await expect(form).toBeVisible()
    await form.getByLabel('Type full name to sign').fill(fullName)
    await form.getByLabel(/I confirm I have read and agree/).check()
    await form.getByRole('button', { name: 'Record Consent & Continue' }).click()

    // Successful consent must resume the same wizard instead of returning to
    // client selection or requiring another New Assessment round-trip.
    await expect(page.getByTestId('capture-disclaimer-dismiss')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(new RegExp(`/assessments/new\\?client_id=${client.id}`))

    const { data: records, error: recordError } = await service
      .from('consent_records')
      .select('kind, signer_name, signer_relationship')
      .eq('client_id', client.id)
    expect(recordError).toBeNull()
    expect(records).toEqual([
      expect.objectContaining({ kind: 'enrollment', signer_name: fullName, signer_relationship: 'self' }),
    ])
  })
})
