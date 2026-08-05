import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, type OverallGrade } from '@posture-ai/engine'
import { createClient } from './helpers'

type GradeCase = {
  score: number
  grade: OverallGrade
  range: string
  description: string
}

// Keep the boundary matrix split into bounded groups. Each case performs a
// database write plus a full route load, so give each group an explicit 60s
// ceiling on saturated CI runners without changing or retrying any assertion.
const GRADE_CASE_GROUPS: ReadonlyArray<{ label: string; cases: readonly GradeCase[] }> = [
  {
    label: 'S and A',
    cases: [
      { score: 0, grade: 'S', range: '0–3', description: 'Minimal deviation' },
      { score: 2, grade: 'S', range: '0–3', description: 'Minimal deviation' },
      { score: 3, grade: 'S', range: '0–3', description: 'Minimal deviation' },
      { score: 4, grade: 'A', range: '4–7', description: 'Low deviation' },
      { score: 6, grade: 'A', range: '4–7', description: 'Low deviation' },
      { score: 7, grade: 'A', range: '4–7', description: 'Low deviation' },
    ],
  },
  {
    label: 'B and C',
    cases: [
      { score: 8, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 14, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 19, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 20, grade: 'B', range: '8–20', description: 'Mild deviation' },
      { score: 21, grade: 'C', range: '21–55', description: 'Moderate deviation' },
      { score: 54, grade: 'C', range: '21–55', description: 'Moderate deviation' },
      { score: 55, grade: 'C', range: '21–55', description: 'Moderate deviation' },
    ],
  },
  {
    label: 'D and E',
    cases: [
      { score: 56, grade: 'D', range: '56–87', description: 'High deviation' },
      { score: 86, grade: 'D', range: '56–87', description: 'High deviation' },
      { score: 87, grade: 'D', range: '56–87', description: 'High deviation' },
      { score: 88, grade: 'E', range: '88–100', description: 'Very high deviation' },
      { score: 99, grade: 'E', range: '88–100', description: 'Very high deviation' },
      { score: 100, grade: 'E', range: '88–100', description: 'Very high deviation' },
    ],
  },
]

// The band a grade rolls up to on-screen (components/array/severity.ts
// bandFromGrade): S, A, B -> maintain; C -> monitor; D, E -> review. The
// display label for each band (reviewModel.ts GRADE_RAIL_STOPS) is
// Maintain / Monitor / Review -- this is what GradeRail's accessible
// description names, not the finer-grained per-grade description.
const BAND_LABEL_BY_GRADE: Record<OverallGrade, string> = {
  S: 'Maintain',
  A: 'Maintain',
  B: 'Maintain',
  C: 'Monitor',
  D: 'Review',
  E: 'Review',
}

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

/**
 * The "Report, share & compare" disclosure is collapsed by default on the
 * clinical results page and hosts ReviewDock -- anything that needs to read
 * dock content has to open it first.
 */
async function openReportDisclosure(page: Page): Promise<void> {
  await page.getByText('Report, share & compare', { exact: true }).click()
}

/**
 * GradeRail (app/assessments/[id]/GradeRail.tsx) states the grade, deviation
 * score and its band as a screen-reader-only paragraph built by
 * reviewModel.ts's buildRail(): "Deviation score N out of 100, grade G, in
 * <band>." That block is only mounted when the current scoring scale applies
 * to the stored grade (GradeRail's `scaleApplies` prop) -- it is entirely
 * absent for a historical grade, so this must only be used for current-scale
 * cases.
 */
async function expectRailDescription(page: Page, fixture: GradeCase): Promise<void> {
  const pattern = new RegExp(
    `Deviation score ${fixture.score} out of 100, grade ${fixture.grade}, in ${BAND_LABEL_BY_GRADE[fixture.grade]}\\.`,
  )
  await expect(page.getByText(pattern)).toBeAttached()
}

/**
 * ReviewDock (app/assessments/[id]/ReviewDock.tsx) is the other place the
 * grade is stated: an `aria-label="Grade G, deviation N out of 100"` readout
 * plus the grade's description as visible text. Its props do not depend on
 * whether the current scale applies, so -- unlike GradeRail's description --
 * it renders identically for current and historical scans, and is the only
 * surface carrying the description text for a historical one.
 */
async function expectDockGrade(
  page: Page,
  fixture: { grade: string; score: number; description: string },
): Promise<void> {
  await openReportDisclosure(page)
  const dock = page.getByTestId('review-dock')
  await expect(
    dock.locator(`[aria-label="Grade ${fixture.grade}, deviation ${fixture.score} out of 100"]`),
  ).toBeVisible()
  await expect(dock.getByText(fixture.description, { exact: true })).toBeVisible()
}

async function expectStoredGradeCases(
  page: Page,
  service: SupabaseClient,
  assessmentId: string,
  cases: readonly GradeCase[],
): Promise<void> {
  for (const fixture of cases) {
    await setStoredGrade(service, assessmentId, fixture.score, fixture.grade)
    await page.goto(`/assessments/${assessmentId}`)
    await expectRailDescription(page, fixture)
    await expectDockGrade(page, fixture)

    // The redesign briefly dropped the per-grade numeric range that
    // GradeSummary's BandTable used to carry, leaving the deviation score with
    // nothing to be read against -- which /DESIGN.md forbids ("a measurement is
    // always shown with its reference range, never alone"). GradeRail now
    // renders it beside the score, so this is asserted, not soft-flagged.
    //
    // Scoped to the rail rather than the dock on purpose: the range qualifies
    // the readout it sits next to, and GradeRail only draws it when the current
    // scale applies to this scan -- which is the guarantee the historical-grade
    // case below depends on.
    await expect(
      page.getByText(fixture.range, { exact: true }),
      `grade ${fixture.grade}'s range "${fixture.range}" is not rendered beside the deviation score`,
    ).toBeVisible()
  }
}

test.describe('grade display contract', () => {
  for (const group of GRADE_CASE_GROUPS) {
    test(`${group.label} grade boundaries agree with the current display contract`, async ({ page }) => {
      test.setTimeout(60_000)
      const service = localService()
      const assessmentId = await createAssessment(page)
      await expectStoredGradeCases(page, service, assessmentId, group.cases)
    })
  }

  test('score 14 agrees in responsive web and PDF export', async ({ page }) => {
    const service = localService()
    const assessmentId = await createAssessment(page)
    await setStoredGrade(service, assessmentId, 14, 'B')
    const fixture: GradeCase = { score: 14, grade: 'B', range: '8–20', description: 'Mild deviation' }
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/assessments/${assessmentId}`)
      await expectRailDescription(page, fixture)
      const hasHorizontalOverflow = await page.locator('html').evaluate(root => root.scrollWidth > root.clientWidth)
      expect(hasHorizontalOverflow, `grade summary overflowed at ${width}px`).toBe(false)
    }
    await expectDockGrade(page, fixture)

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
    // GradeRail's screen-reader description is only mounted when the current
    // scale applies (see expectRailDescription's doc comment); for a
    // historical grade the grade/score/description contract is verified via
    // ReviewDock instead, whose props do not depend on scaleApplies.
    await expectDockGrade(page, { grade: 'D', score: 14, description: 'Recorded screening grade' })
    await expect(page.getByText(/current grade scale is not applied/i)).toBeVisible()
    await expect(page.getByText('Grade Reference')).toHaveCount(0)
  })
})
