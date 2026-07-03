import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// Professional-review gate: a report cannot be exported until a practitioner
// reviews and approves the assessment (exercises are suggestions, not an
// auto-generated prescription). Tested at the API; chromium only.
test.describe('report approval gate', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API-level gate; run once on chromium')

  async function createCompleteAssessmentFor(page: Page, clientId: string): Promise<string> {
    const res = await page.request.post('/api/assessments', { data: { client_id: clientId, test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    return (await res.json()).id as string
  }

  async function createCompleteAssessment(page: Page): Promise<string> {
    const c = await createClient(page, 'E2E', `Report-${randomUUID().slice(0, 8)}`)
    return createCompleteAssessmentFor(page, c.id)
  }

  test('export is blocked until the practitioner approves', async ({ page }) => {
    const assessmentId = await createCompleteAssessment(page)

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
})
