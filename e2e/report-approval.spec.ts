import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers'
import { skipForProductionReadiness } from './production-readiness-skip'

// Professional-review gate: a report cannot be exported until a practitioner
// reviews and approves the assessment (exercises are suggestions, not an
// auto-generated prescription). Tested at the API; chromium only.
test.describe('report approval gate', () => {
  test.beforeEach(({ browserName }, testInfo) => skipForProductionReadiness(
    testInfo,
    browserName !== 'chromium',
    {
      key: 'skip:report-approval:mobile-webkit',
      source: 'e2e/report-approval.spec.ts::report approval gate project guard',
      scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
    },
    'API-level gate; run once on chromium',
  ))

  async function createCompleteAssessmentFor(page: Page, clientId: string): Promise<string> {
    const res = await page.request.post('/api/assessments', { data: { client_id: clientId, submission_id: randomUUID(), test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    return (await res.json()).id as string
  }

  async function createCompleteAssessment(page: Page): Promise<string> {
    const c = await createClient(page, 'E2E', `Report-${randomUUID().slice(0, 8)}`)
    return createCompleteAssessmentFor(page, c.id)
  }

  async function patchAssessmentEngineVersion(assessmentId: string, version: string): Promise<void> {
    // Test-process env: run-e2e.mjs exports E2E_* (the NEXT_PUBLIC_* names only
    // exist inside the webServer process).
    const supabaseUrl = process.env.E2E_SUPABASE_URL
    if (!supabaseUrl?.startsWith('http://127.0.0.1')) {
      throw new Error('E2E engine-version patch requires local Supabase at 127.0.0.1')
    }
    const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')

    const service = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await service
      .from('assessments')
      .update({ scoring_engine_version: version })
      .eq('id', assessmentId)
      .select('id')
      .single()

    expect(error?.message).toBeUndefined()
    expect(data?.id).toBe(assessmentId)
  }

  test('export is blocked until the practitioner approves', async ({ page }) => {
    const assessmentId = await createCompleteAssessment(page)

    await page.goto(`/assessments/${assessmentId}`)
    // ReviewDock's controls (approve, PDF, share, compare) sit behind the
    // "Report, share & compare" disclosure, collapsed by default; the pinned
    // action bar carries its own always-visible sign-off/PDF pair separately.
    await page.getByRole('button', { name: 'Report, share & compare' }).click()
    await expect(page.getByTestId('review-dock')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve report' })).toBeVisible()
    // The pinned action bar's icon button ("Generate practitioner PDF") also
    // matches a case-insensitive substring search for "Practitioner PDF" —
    // that duplication is intentional (both the dock and the pinned bar carry
    // report/sign-off controls so they are reachable from anywhere on the
    // screen), so this must be an exact match to target the dock's control.
    await expect(page.getByRole('button', { name: 'Practitioner PDF', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Client report' })).toBeDisabled()

    for (const width of [320, 375, 414, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      const hasHorizontalOverflow = await page.locator('html').evaluate((root) => root.scrollWidth > root.clientWidth)
      expect(hasHorizontalOverflow, `review studio overflowed at ${width}px`).toBe(false)
    }

    // Unapproved → 403.
    const blocked = await page.request.post('/api/reports', {
      data: { assessment_id: assessmentId, variant: 'practitioner' },
    })
    expect(blocked.status()).toBe(403)
    expect((await blocked.json()).error).toMatch(/approv/i)

    // Approve, then the export gate is no longer the blocker.
    const approve = await page.request.patch(`/api/assessments/${assessmentId}/approve`, {
      data: { approved: true },
    })
    expect(approve.ok(), `approve failed: ${approve.status()}`).toBeTruthy()

    await page.reload()
    await page.getByRole('button', { name: 'Report, share & compare' }).click()
    await expect(page.getByRole('button', { name: 'Practitioner PDF', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Client report' })).toBeEnabled()

    const after = await page.request.post('/api/reports', {
      data: { assessment_id: assessmentId, variant: 'practitioner' },
    })
    expect(after.status(), 'approval should clear the 403 export gate').not.toBe(403)
  })

  test('a comparison report cannot mix two DIFFERENT clients (PHI boundary)', async ({ page }) => {
    const clientA = await createClient(page, 'E2E', `CmpA-${randomUUID().slice(0, 8)}`)
    const clientB = await createClient(page, 'E2E', `CmpB-${randomUUID().slice(0, 8)}`)
    const assessmentA = await createCompleteAssessmentFor(page, clientA.id)
    const assessmentB = await createCompleteAssessmentFor(page, clientB.id)
    for (const a of [assessmentA, assessmentB]) {
      await page.request.patch(`/api/assessments/${a}/approve`, { data: { approved: true } })
    }

    // Comparing client A's assessment against client B's must be rejected — never
    // render one client's history into another client's report.
    const crossClient = await page.request.post('/api/reports', {
      data: { assessment_id: assessmentA, compared_to_assessment_id: assessmentB, variant: 'practitioner' },
    })
    expect(crossClient.status(), 'cross-client comparison must be blocked').toBe(400)
    expect((await crossClient.json()).error).toMatch(/same client/i)
  })

  // The title is bound to the approved mobile-webkit skip in
  // docs/qa/production-readiness-manifest.json; keep it stable.
  test('a cross-version client comparison is flagged not-comparable', async ({ page }) => {
    const client = await createClient(page, 'E2E', `Version-${randomUUID().slice(0, 8)}`)
    const prior = await createCompleteAssessmentFor(page, client.id)
    const current = await createCompleteAssessmentFor(page, client.id)
    for (const a of [prior, current]) {
      await page.request.patch(`/api/assessments/${a}/approve`, { data: { approved: true } })
    }
    await patchAssessmentEngineVersion(prior, '1.3.0')

    // ScreeningContextV1 supports only the current engine version, so a prior
    // scan from another engine has no descriptive measurements. The route fails
    // closed before rendering: no PDF, no signed URL, no comparison claim.
    const report = await page.request.post('/api/reports', {
      data: { assessment_id: current, compared_to_assessment_id: prior, variant: 'client' },
    })
    expect(report.status(), 'cross-version comparison must be refused').toBe(422)
    const body = await report.json()
    expect(body.code).toBe('comparison_screening_context_unavailable')
    expect(body.signed_url).toBeUndefined()
  })
})
