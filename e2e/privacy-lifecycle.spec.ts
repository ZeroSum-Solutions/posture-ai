import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers'
import { skipForProductionReadiness } from './production-readiness-skip'

function localService() {
  const url = process.env.E2E_SUPABASE_URL
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url?.startsWith('http://127.0.0.1') || !serviceKey) {
    throw new Error('Privacy lifecycle QA requires local Supabase')
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function createApprovedAssessment(page: Page, clientId: string) {
  const created = await page.request.post('/api/assessments', {
    data: { client_id: clientId, submission_id: randomUUID(), test_mode: true },
  })
  expect(created.ok(), `assessment create failed: ${created.status()}`).toBeTruthy()
  const assessmentId = (await created.json()).id as string
  const approved = await page.request.patch(`/api/assessments/${assessmentId}/approve`, {
    data: { approved: true },
  })
  expect(approved.ok(), `assessment approval failed: ${approved.status()}`).toBeTruthy()
  return assessmentId
}

test.describe('privacy lifecycle user QA', () => {
  test.beforeEach(({ browserName }, testInfo) => skipForProductionReadiness(
    testInfo,
    browserName !== 'webkit',
    {
      key: 'skip:privacy-lifecycle:desktop-chromium',
      source: 'e2e/privacy-lifecycle.spec.ts::privacy lifecycle user QA project guard',
      scope: { project: 'desktop-chromium', condition: 'browserName=chromium' },
    },
    'Phone lifecycle walkthrough; run once on mobile WebKit',
  ))

  test('grant → use → rotate/revoke → withdraw, then erase → minimized tombstone', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    const client = await createClient(page, 'Privacy', `Lifecycle-${suffix}`)
    const assessmentId = await createApprovedAssessment(page, client.id)

    const minted = await page.request.post('/api/workouts', {
      data: { assessment_id: assessmentId, share: true },
    })
    expect(minted.ok(), `share mint failed: ${minted.status()}`).toBeTruthy()
    const mintedBody = await minted.json() as { session_id: string; share_link: string }
    const firstToken = mintedBody.share_link.split('/s/')[1]
    expect((await page.request.get(`/api/workouts/token/${firstToken}`)).status()).toBe(200)

    await page.goto(`/clients/${client.id}`)
    await page.getByRole('button', { name: /Findings, comparison and details/ }).click()
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByRole('heading', { name: 'Privacy controls' })).toBeVisible()
    await expect(page.getByText('active', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Rotate' }).click()
    const newLink = page.getByLabel(/New link — copy it now/)
    await expect(newLink).toBeVisible()
    const rotatedToken = (await newLink.inputValue()).split('/s/')[1]
    expect((await page.request.get(`/api/workouts/token/${firstToken}`)).status()).toBe(404)
    expect((await page.request.get(`/api/workouts/token/${rotatedToken}`)).status()).toBe(200)

    await page.getByRole('button', { name: 'Revoke' }).click()
    await expect(page.getByText('revoked', { exact: true })).toBeVisible()
    expect((await page.request.get(`/api/workouts/token/${rotatedToken}`)).status()).toBe(404)

    // Revocation is terminal, so create a separate active share to prove that a
    // later consent withdrawal revokes every currently live credential.
    const withdrawalMint = await page.request.post('/api/workouts', {
      data: { assessment_id: assessmentId, share: true },
    })
    expect(withdrawalMint.ok(), `withdrawal share mint failed: ${withdrawalMint.status()}`).toBeTruthy()
    const withdrawalBody = await withdrawalMint.json() as { session_id: string; share_link: string }
    const withdrawalToken = withdrawalBody.share_link.split('/s/')[1]
    await page.reload()
    await page.getByRole('button', { name: /Findings, comparison and details/ }).click()
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByText('active', { exact: true })).toBeVisible()
    expect((await page.request.get(`/api/workouts/token/${withdrawalToken}`)).status()).toBe(200)

    const withdrawal = page.getByRole('form', { name: 'Withdraw consent' })
    await withdrawal.getByLabel('Withdrawal signer name').fill(`Privacy Lifecycle-${suffix}`)
    await withdrawal.getByRole('checkbox').check()
    await withdrawal.getByRole('button', { name: 'Withdraw consent' }).click()
    await expect(withdrawal).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rotate' }).last()).toBeDisabled()
    expect((await page.request.get(`/api/workouts/token/${withdrawalToken}`)).status()).toBe(404)

    const blockedRotation = await page.request.post('/api/workouts/shares', {
      data: { session_id: mintedBody.session_id },
    })
    expect(blockedRotation.status()).toBe(409)
    expect((await blockedRotation.json()).error).toMatch(/consent/i)

    const blockedMint = await page.request.post('/api/workouts', {
      data: { assessment_id: assessmentId, share: true },
    })
    expect(blockedMint.status()).toBe(409)
    expect((await blockedMint.json()).error).toMatch(/consent/i)

    const blockedAssessment = await page.request.post('/api/assessments', {
      data: { client_id: client.id, submission_id: randomUUID(), test_mode: true },
    })
    expect(blockedAssessment.status()).toBe(403)
    expect((await blockedAssessment.json()).error).toMatch(/consent/i)

    const service = localService()
    const { data: revocation, error: revocationError } = await service
      .from('consent_records')
      .select('kind, reason_code, signer_name, notes')
      .eq('client_id', client.id)
      .eq('kind', 'revocation')
      .single()
    expect(revocationError).toBeNull()
    expect(revocation).toMatchObject({
      kind: 'revocation',
      reason_code: 'subject_request',
      signer_name: `Privacy Lifecycle-${suffix}`,
      notes: null,
    })

    const eraseClient = await createClient(page, 'Privacy', `Erase-${suffix}`)
    await page.goto(`/clients/${eraseClient.id}`)
    await page.getByRole('button', { name: /Findings, comparison and details/ }).click()
    await page.getByRole('tab', { name: 'Details' }).click()
    const erasure = page.getByRole('form', { name: 'Permanently erase client' })
    await erasure.getByLabel('Type ERASE to confirm').fill('ERASE')
    await erasure.getByRole('button', { name: 'Permanently erase' }).click()
    await expect(page).toHaveURL(/\/clients\?erasure=complete/)

    const { data: tombstone, error: tombstoneError } = await service
      .from('clients')
      .select('first_name, last_name, date_of_birth, notes, deletion_reason, deletion_reason_code, deleted_at')
      .eq('id', eraseClient.id)
      .single()
    expect(tombstoneError).toBeNull()
    expect(tombstone).toMatchObject({
      first_name: 'REDACTED',
      last_name: 'REDACTED',
      date_of_birth: null,
      notes: null,
      deletion_reason: null,
      deletion_reason_code: 'subject_request',
    })
    expect(tombstone?.deleted_at).toBeTruthy()
  })
})
