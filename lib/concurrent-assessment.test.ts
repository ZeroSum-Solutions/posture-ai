import { describe, it, expect, vi } from 'vitest'
import { assessPosture, testLandmarksFrames } from '@posture-ai/engine'
import type { PoseFrame } from '@posture-ai/engine'

// ---------------------------------------------------------------------------
// Feature #41: Distinct concurrent assessment submissions do not cross-contaminate
// ---------------------------------------------------------------------------
// This test verifies that:
// 1. The posture scoring engine is pure/stateless (safe to call concurrently)
// 2. Intentionally distinct submissions generate distinct assessment IDs
// 3. Findings are always correctly associated with their own assessment_id
// 4. No shared mutable state exists in the handler logic
// ---------------------------------------------------------------------------

/**
 * Models the downstream scoring/write isolation of POST /api/assessments without
 * its HTTP, validation, or submission-id replay layer. Same-key idempotency and
 * payload-conflict behavior are covered by app/api/assessments/route.test.ts.
 */
async function simulateAssessmentHandler(opts: {
  clientId: string
  practitionerId: string
  db: MockDb
  frames: PoseFrame[]
}): Promise<{ id: string; status: string; findingIds: string[] }> {
  const { clientId, practitionerId, db, frames } = opts

  // Step 1: Create assessment (Postgres gen_random_uuid() is simulated by db.insertAssessment)
  const assessment = await db.insertAssessment({ client_id: clientId, practitioner_id: practitionerId, status: 'processing' })
  const assessmentId = assessment.id  // <-- local variable, not shared

  // Step 2: Run scoring engine (pure function, no side effects)
  const result = assessPosture(frames)

  // Step 3: Insert findings, each bound to THIS assessment's ID
  const findingsToInsert = result.findings.map(f => ({
    assessment_id: assessmentId,          // <-- each finding uses local assessmentId
    practitioner_id: practitionerId,
    imbalance_key: f.key,
    region: f.region,
    label: f.label,
    deviation: f.deviation,
    severity_pct: f.severityPct,
    zone: f.zone,
  }))
  const insertedFindings = await db.insertFindings(findingsToInsert)

  // Step 4: Update assessment to complete
  await db.updateAssessment(assessmentId, {
    status: 'complete',
    overall_score: result.overallScore,
    overall_grade: result.overallGrade,
    overall_percentile: null,
  })

  return { id: assessmentId, status: 'complete', findingIds: insertedFindings.map(f => f.id) }
}

// ---------------------------------------------------------------------------
// Mock DB: Simulates Postgres UUID generation behaviour
// ---------------------------------------------------------------------------
class MockDb {
  private assessments: Map<string, Record<string, unknown>> = new Map()
  private findings: Map<string, Record<string, unknown>> = new Map()
  private idCounter = 0

  private nextId(): string {
    // Use crypto-style IDs to simulate gen_random_uuid()
    return `00000000-0000-4000-${String(++this.idCounter).padStart(4, '0')}-000000000001`
  }

  async insertAssessment(data: Record<string, unknown>) {
    const id = this.nextId()
    this.assessments.set(id, { ...data, id })
    return { id }
  }

  async insertFindings(findings: Record<string, unknown>[]) {
    return findings.map(f => {
      const id = this.nextId()
      this.findings.set(id, { ...f, id })
      return { ...f, id }
    })
  }

  async updateAssessment(id: string, data: Record<string, unknown>) {
    const existing = this.assessments.get(id)
    if (!existing) throw new Error(`Assessment ${id} not found`)
    this.assessments.set(id, { ...existing, ...data })
  }

  getAllAssessments() { return Array.from(this.assessments.values()) }
  getAllFindings() { return Array.from(this.findings.values()) }
  getAssessmentById(id: string) { return this.assessments.get(id) }
  getFindingsForAssessment(assessmentId: string) {
    return Array.from(this.findings.values()).filter(f => f.assessment_id === assessmentId)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-test-uuid-001'
const PRACTITIONER_ID = 'practitioner-test-uuid-001'

describe('Feature #41: Distinct concurrent assessment submissions', () => {
  it('posture engine is pure — concurrent calls return identical deterministic results', async () => {
    const frames = testLandmarksFrames as PoseFrame[]

    // Call assessPosture concurrently 5 times
    const [r1, r2, r3, r4, r5] = await Promise.all([
      Promise.resolve(assessPosture(frames)),
      Promise.resolve(assessPosture(frames)),
      Promise.resolve(assessPosture(frames)),
      Promise.resolve(assessPosture(frames)),
      Promise.resolve(assessPosture(frames)),
    ])

    // All results should be identical (pure function, no global state)
    expect(r1.overallScore).toBe(r2.overallScore)
    expect(r1.overallScore).toBe(r3.overallScore)
    expect(r1.overallGrade).toBe(r2.overallGrade)
    expect(r1.findings.length).toBe(r2.findings.length)
    expect(r1.findings.map(f => f.key)).toEqual(r5.findings.map(f => f.key))
  })

  it('two concurrent submissions produce unique assessment IDs', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]

    // Fire two intentionally distinct submissions for the SAME client. In the
    // route these carry different submission_id values.
    const [result1, result2] = await Promise.all([
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
    ])

    // Both must complete successfully
    expect(result1.status).toBe('complete')
    expect(result2.status).toBe('complete')

    // IDs must be unique — no duplicate primary keys
    expect(result1.id).toBeDefined()
    expect(result2.id).toBeDefined()
    expect(result1.id).not.toBe(result2.id)
  })

  it('two concurrent submissions write distinct rows to the database', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]

    await Promise.all([
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
    ])

    const allAssessments = db.getAllAssessments()

    // Exactly 2 distinct assessment rows in DB
    expect(allAssessments).toHaveLength(2)

    // Both rows have different IDs
    const ids = allAssessments.map(a => a.id)
    expect(new Set(ids).size).toBe(2)

    // Both rows belong to the same client (concurrent, same client)
    expect(allAssessments.every(a => a.client_id === CLIENT_ID)).toBe(true)
  })

  it('each assessment findings are correctly associated with their own assessment_id', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]

    const [result1, result2] = await Promise.all([
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
    ])

    // Findings for assessment 1 must all have assessment_id = result1.id
    const findings1 = db.getFindingsForAssessment(result1.id)
    expect(findings1.length).toBeGreaterThan(0)
    expect(findings1.every(f => f.assessment_id === result1.id)).toBe(true)

    // Findings for assessment 2 must all have assessment_id = result2.id
    const findings2 = db.getFindingsForAssessment(result2.id)
    expect(findings2.length).toBeGreaterThan(0)
    expect(findings2.every(f => f.assessment_id === result2.id)).toBe(true)

    // No finding from assessment 1 should appear in assessment 2's findings
    const ids1 = new Set(findings1.map(f => f.id))
    const ids2 = new Set(findings2.map(f => f.id))
    const overlap = [...ids1].filter(id => ids2.has(id))
    expect(overlap).toHaveLength(0)
  })

  it('no assessment ends up stuck in "processing" status after completion', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]

    await Promise.all([
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
    ])

    const allAssessments = db.getAllAssessments()

    // No assessment stuck in processing
    const processingAssessments = allAssessments.filter(a => a.status === 'processing')
    expect(processingAssessments).toHaveLength(0)

    // All assessments completed successfully
    const completedAssessments = allAssessments.filter(a => a.status === 'complete')
    expect(completedAssessments).toHaveLength(2)
  })

  it('client assessment history shows 2 separate completed assessments', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]

    await Promise.all([
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
      simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames }),
    ])

    // Query client assessment history (same as what the UI would do)
    const clientHistory = db.getAllAssessments()
      .filter(a => a.client_id === CLIENT_ID && a.status === 'complete')

    expect(clientHistory).toHaveLength(2)

    // Each assessment has a valid overall_grade (proving scoring completed)
    expect(clientHistory.every(a => typeof a.overall_grade === 'string')).toBe(true)
    expect(clientHistory.every(a => typeof a.overall_score === 'number')).toBe(true)
  })

  it('higher concurrency (5 concurrent) — no ID collisions or finding cross-contamination', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]
    const N = 5

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames })
      )
    )

    // All N complete
    expect(results.every(r => r.status === 'complete')).toBe(true)

    // N distinct assessment IDs
    const uniqueIds = new Set(results.map(r => r.id))
    expect(uniqueIds.size).toBe(N)

    // Each assessment's findings only contain its own assessment_id
    for (const result of results) {
      const findings = db.getFindingsForAssessment(result.id)
      expect(findings.length).toBeGreaterThan(0)
      expect(findings.every(f => f.assessment_id === result.id)).toBe(true)
    }

    // Total findings = N * findings_per_assessment (no missing, no duplicates)
    const singleRunFindings = assessPosture(frames).findings.length
    expect(db.getAllFindings()).toHaveLength(N * singleRunFindings)
  })

  it('release load sanity (10 concurrent) — distinct rows, no cross-contamination, all complete', async () => {
    const db = new MockDb()
    const frames = testLandmarksFrames as PoseFrame[]
    const N = 10

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        simulateAssessmentHandler({ clientId: CLIENT_ID, practitionerId: PRACTITIONER_ID, db, frames })
      )
    )

    expect(results.every(r => r.status === 'complete')).toBe(true)
    expect(new Set(results.map(r => r.id)).size).toBe(N)
    for (const result of results) {
      const findings = db.getFindingsForAssessment(result.id)
      expect(findings.every(f => f.assessment_id === result.id)).toBe(true)
    }
    const singleRunFindings = assessPosture(frames).findings.length
    expect(db.getAllFindings()).toHaveLength(N * singleRunFindings)
  })
})
