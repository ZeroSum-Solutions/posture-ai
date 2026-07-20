import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, type OverallGrade } from '@posture-ai/engine'
import { createClient } from './helpers'

function localService(): SupabaseClient {
  const supabaseUrl = process.env.E2E_SUPABASE_URL
  if (!supabaseUrl?.startsWith('http://127.0.0.1')) {
    throw new Error('Grade-display QA requires local Supabase at 127.0.0.1')
  }
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')
  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function createAssessment(page: Page): Promise<string> {
  const client = await createClient(page, 'E2E', `Grade-${randomUUID().slice(0, 8)}`)
  const response = await page.request.post('/api/assessments', {
    data: { client_id: client.id, submission_id: randomUUID(), test_mode: true },
  })
  expect(response.ok(), `assessment create failed: ${response.status()}`).toBeTruthy()
  return (await response.json()).id as string
}

async function setStoredGrade(
  service: SupabaseClient,
  assessmentId: string,
  score: number,
  grade: OverallGrade,
  scoringEngineVersion: string | null = ENGINE_VERSION,
): Promise<void> {
  const { data, error } = await service
    .from('assessments')
    .update({
      overall_score: score,
      overall_grade: grade,
      scoring_engine_version: scoringEngineVersion,
    })
    .eq('id', assessmentId)
    .select('id')
    .single()

  expect(error?.message).toBeUndefined()
  expect(data?.id).toBe(assessmentId)
}

test.describe('grade display contract', () => {
  test('score 14 and every grade transition agree in responsive web and PDF export', async ({ page }) => {
    const service = localService()
    const assessmentId = await createAssessment(page)

    const cases: Array<{ score: number; grade: OverallGrade; range: string; description: string }> = [
      { score: 0, grade: 'S', range: '0–3', description: 'Minimal deviation' },
      { score: 2, grade: 'S', range: '0–3', description: 'Minimal deviation' },
      { score: 3, grade: 'S', range: '0–3', description: 'Minimal deviation' },
      { score: 4, grade: 'A', range: '4–7', description: 'Low deviation' },
      { score: 6, grade: 'A', range: '4–7', description: 'Low deviation' },
      { score: 7, grade: 'A', range: '4–7', description: 'Low deviation' },
      { score: 8, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 14, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 19, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 20, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 21, grade: 'C', range: '21–55', description: 'Moderate deviation' },
      { score: 54, grade: 'C', range: '21–55', description: 'Moderate deviation' },
      { score: 55, grade: 'C', range: '21–55', description: 'Moderate deviation' },
      { score: 56, grade: 'D', range: '56–87', description: 'High deviation' },
      { score: 86, grade: 'D', range: '56–87', description: 'High deviation' },
      { score: 87, grade: 'D', range: '56–87', description: 'High deviation' },
      { score: 88, grade: 'E', range: '88–100', description: 'Very high deviation' },
      { score: 99, grade: 'E', range: '88–100', description: 'Very high deviation' },
      { score: 100, grade: 'E', range: '88–100', description: 'Very high deviation' },
    ]

    for (const fixture of cases) {
      await setStoredGrade(service, assessmentId, fixture.score, fixture.grade)
      await page.goto(`/assessments/${assessmentId}`)
      await expect(page.getByRole('img', {
        name: `Grade ${fixture.grade}: ${fixture.description}; deviation ${fixture.score} out of 100, lower is better`,
      })).toBeVisible()
      const selectedBand = page.locator('[aria-current="true"]')
      await expect(selectedBand).toContainText(fixture.grade)
      await expect(selectedBand).toContainText(fixture.range)
      await expect(selectedBand).toContainText(fixture.description)
    }

    await setStoredGrade(service, assessmentId, 14, 'B')
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/assessments/${assessmentId}`)
      await expect(page.getByRole('img', { name: /Grade B: Mild deviation; deviation 14/ })).toBeVisible()
      const hasHorizontalOverflow = await page.locator('html').evaluate(root => root.scrollWidth > root.clientWidth)
      expect(hasHorizontalOverflow, `grade summary overflowed at ${width}px`).toBe(false)
    }

    const approve = await page.request.patch(`/api/assessments/${assessmentId}/approve`, {
      data: { approved: true },
    })
    expect(approve.ok(), `approval failed: ${approve.status()}`).toBeTruthy()
    const report = await page.request.post('/api/reports', {
      data: { assessment_id: assessmentId, variant: 'practitioner' },
    })
    expect(report.ok(), `PDF export failed: ${report.status()}`).toBeTruthy()
    const reportBody = await report.json()
    expect(reportBody.signed_url).toBeTruthy()
    const pdf = await page.request.get(reportBody.signed_url)
    expect(pdf.ok()).toBeTruthy()
    expect(pdf.headers()['content-type']).toContain('application/pdf')
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
  })

  test('historical grades remain stored and do not receive the current scale', async ({ page }) => {
    const service = localService()
    const assessmentId = await createAssessment(page)
    await setStoredGrade(service, assessmentId, 14, 'D', '1.0.0')

    await page.goto(`/assessments/${assessmentId}`)
    await expect(page.getByRole('img', { name: /Grade D: Recorded screening grade; deviation 14/ })).toBeVisible()
    await expect(page.getByText(/current grade scale is not applied/i)).toBeVisible()
    await expect(page.getByText('Grade Reference')).toHaveCount(0)
  })
})
