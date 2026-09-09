import { expect, test } from '@playwright/test'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient, selectClientInWizard } from './helpers'

test('a completed scan with unusable capture evidence reaches honest results', async ({ page }) => {
  const url = process.env.E2E_SUPABASE_URL
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('This fault-injection check requires the isolated local test database.')
  }
  const service = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const name = `Unavailable${Date.now().toString().slice(-7)}`
  await createClient(page, 'E2E', name)
  let assessmentId = ''
  await page.route('**/api/assessments', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const body = await response.json() as { id: string; status: string }
    expect(body.status).toBe('complete')
    assessmentId = body.id
    // Corrupt only this newly created synthetic fixture before the wizard polls.
    // The real read boundary must reject its evidence; status remains complete.
    const { data, error } = await service.from('captures').update({ pose_frame: {} }).eq('assessment_id', assessmentId).select('id')
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThan(0)
    await route.fulfill({ response })
  })
  await page.goto('/assessments/new?testMode=1')
  await selectClientInWizard(page, `E2E ${name}`)
  await page.getByRole('button', { name: 'Run Test Analysis' }).click()
  await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe(`/assessments/${assessmentId}`)
  const result = await page.request.get(`/api/assessments/${assessmentId}`)
  expect(result.ok()).toBe(true)
  const payload = await result.json()
  expect(payload.screening_context.scanUse).toBe('unavailable')
  expect(payload.findings.length).toBeGreaterThan(0)
  expect(payload.findings.every((finding: { deviation: unknown; severity_pct: unknown; confidence: unknown }) =>
    finding.deviation === null && finding.severity_pct === null && finding.confidence === null)).toBe(true)
  await expect(page.getByText('This screening is unavailable for corrective report or program use. Scan-independent general training remains available.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Running Test Analysis...' })).toHaveCount(0)
})
