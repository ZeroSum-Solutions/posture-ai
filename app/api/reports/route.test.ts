import { describe, test, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import type { LegalResolution, LegalSnapshot } from '@/lib/legal/types'

const legalTest = vi.hoisted(() => {
  const snapshot: LegalSnapshot = {
    schemaVersion: 1,
    documentId: 'screening-notice-test-fixture-v1',
    kind: 'screening_notice',
    version: 'test-1',
    title: 'Screening Notice',
    effectiveAt: '2026-07-20T00:00:00.000Z',
    jurisdiction: 'US',
    locale: 'en-US',
    productScope: 'us_fitness_wellness_assessment_beta_v1',
    audience: 'subject',
    bodySha256: 'c'.repeat(64),
    text: 'Exact governed screening notice text.',
    sections: [{ id: 'notice', heading: null, paragraphs: ['Exact governed screening notice text.'] }],
    isFixture: true,
  }
  return {
    snapshot,
    resolution: { value: { ok: true, document: { id: snapshot.documentId } } as LegalResolution },
    snapshotSpy: vi.fn(() => snapshot),
  }
})

const testSpies = vi.hoisted(() => ({
  upload: vi.fn(async (path: string, body: unknown, options: unknown): Promise<{
    error: { message: string } | null
  }> => {
    void path
    void body
    void options
    return { error: null }
  }),
  remove: vi.fn(async () => ({ error: null as { message: string } | null })),
  reportInsert: vi.fn(),
  outboxInsert: vi.fn(),
  outboxDelete: vi.fn(),
  logEvent: vi.fn(),
  renderToBuffer: vi.fn(async (document: unknown) => {
    void document
    return Buffer.from('%PDF-1.4\n%mock')
  }),
  clinicalEnabled: { value: true },
}))

// Per-table result for the authed server client. supabase-js resolves to
// { data, error } and does NOT throw on DB errors.
const serverTables: Record<string, { data: unknown; error: unknown }> = {}
const serverTableQueues: Record<string, Array<{ data: unknown; error: unknown }>> = {}
const reportsInsert: { data: unknown; error: unknown } = {
  data: { status: 'created', report_id: 'r1' }, error: null,
}
const outboxWrite: { data: unknown; error: unknown } = { data: null, error: null }

function makeQuery(
  result: () => { data: unknown; error: unknown },
  onInsert?: (value: unknown) => void,
  onDelete?: () => void,
): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q, eq: () => q, neq: () => q, order: () => q, in: () => q,
    insert: (value: unknown) => { onInsert?.(value); return q },
    delete: () => { onDelete?.(); return q },
    single: async () => result(),
    maybeSingle: async () => result(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (onF: any, onR: any) => Promise.resolve(result()).then(onF, onR),
  }
  return q
}

const uploadSpy = testSpies.upload
const reportInsertSpy = testSpies.reportInsert
const outboxInsertSpy = testSpies.outboxInsert
const outboxDeleteSpy = testSpies.outboxDelete
const removeSpy = testSpies.remove
const renderToBufferSpy = testSpies.renderToBuffer

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => {
      const queued = serverTableQueues[t]?.shift()
      return makeQuery(() => queued ?? serverTables[t] ?? { data: null, error: null })
    },
  }),
  createSupabaseServiceClient: () => ({
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: testSpies.upload,
        remove: testSpies.remove,
      }),
    },
    from: (table: string) => makeQuery(
      () => table === 'privacy_storage_deletion_outbox'
        ? outboxWrite
        : { data: null, error: null },
      table === 'privacy_storage_deletion_outbox' ? testSpies.outboxInsert : undefined,
      table === 'privacy_storage_deletion_outbox' ? testSpies.outboxDelete : undefined,
    ),
    rpc: testSpies.reportInsert,
  }),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({
  logEvent: testSpies.logEvent,
  hashUser: () => 'user-hash',
  hashResource: () => 'resource-hash',
}))
vi.mock('@/lib/legal/runtime', () => ({
  resolveRuntimeLegalDocument: () => legalTest.resolution.value,
}))
vi.mock('@/lib/legal/policy', () => ({
  snapshotLegalDocument: legalTest.snapshotSpy,
}))
vi.mock('@/lib/clinical-content/runtime', () => ({
  clinicalContentAccess: () => ({
    mode: testSpies.clinicalEnabled.value ? 'test_fixture' : 'disabled',
    contentVersion: testSpies.clinicalEnabled.value ? 'clinical-content-test-fixture-v1' : null,
    inventorySha256: 'd'.repeat(64),
    surfaces: {
      recommendations: testSpies.clinicalEnabled.value,
      programs: testSpies.clinicalEnabled.value,
      workouts: testSpies.clinicalEnabled.value,
      knowledgeLinks: testSpies.clinicalEnabled.value,
    },
    approvedExerciseSlugs: [],
    approvedLinkIds: [],
    approvedReportCopyIds: [],
  }),
}))
vi.mock('@react-pdf/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  renderToBuffer: testSpies.renderToBuffer,
}))

import { POST } from './route'

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/reports', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const approvedAssessment = {
  id: 'a1', client_id: 'c1', status: 'complete',
  overall_score: 14, overall_grade: 'B', assessed_at: '2026-01-01T00:00:00Z',
  practitioner_approved: true, priority_keys: null, capability: null,
  exercise_swaps: null, scoring_engine_version: 'v1',
  clients: { id: 'c1', first_name: 'Jane', last_name: 'Doe' },
}

describe('POST /api/reports', () => {
  beforeEach(() => {
    uploadSpy.mockClear()
    removeSpy.mockReset().mockResolvedValue({ error: null })
    reportInsertSpy.mockReset().mockImplementation(async () => reportsInsert)
    outboxInsertSpy.mockClear()
    outboxDeleteSpy.mockClear()
    testSpies.logEvent.mockClear()
    renderToBufferSpy.mockClear()
    legalTest.snapshotSpy.mockClear()
    legalTest.resolution.value = { ok: true, document: { id: legalTest.snapshot.documentId } } as LegalResolution
    for (const key of Object.keys(serverTableQueues)) delete serverTableQueues[key]
    serverTables.assessments = { data: approvedAssessment, error: null }
    serverTables.assessment_findings = { data: [], error: null }
    serverTables.imbalance_definitions = { data: [], error: null }
    serverTables.practitioners = { data: { display_name: 'Dr X', practice_name: 'Clinic' }, error: null }
    reportsInsert.data = { status: 'created', report_id: 'r1' }
    reportsInsert.error = null
    outboxWrite.data = null
    outboxWrite.error = null
    testSpies.clinicalEnabled.value = true
  })

  test('denies direct client-program export while assessment-only', async () => {
    testSpies.clinicalEnabled.value = false

    const res = await POST(req({ assessment_id: 'a1', variant: 'client' }))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'clinical_content_disabled' })
    expect(renderToBufferSpy).not.toHaveBeenCalled()
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('assessment-only practitioner export contains no recommendation DTOs', async () => {
    testSpies.clinicalEnabled.value = false
    serverTables.assessment_findings = { data: [{
      id: 'f1', imbalance_key: 'forward_head_posture', region: 'head_shoulders', label: 'Forward Head',
      deviation: 4, unit: 'deg', direction: 'Forward', severity_pct: 20, zone: 'warning',
      view_used: 'side', confidence: 0.9,
    }], error: null }

    const res = await POST(req({ assessment_id: 'a1', variant: 'practitioner' }))

    expect(res.status).toBe(200)
    const document = renderToBufferSpy.mock.calls[0]?.[0] as { props: Record<string, unknown> }
    expect(document.props.exercises).toEqual([])
    expect(document.props.findings).toEqual([
      expect.objectContaining({ causes_text: '', tight_muscles: [], weak_muscles: [] }),
    ])
    expect(reportInsertSpy).toHaveBeenCalledWith('finalize_report_upload_v2', expect.objectContaining({
      p_report_scope: 'assessment_only',
      p_clinical_content_version: null,
      p_clinical_inventory_sha256: null,
    }))
  })

  test('returns 500 (and does NOT upload a PDF) when the findings read errors — a failed read must not become a clean "zero issues" report', async () => {
    serverTables.assessment_findings = { data: null, error: { message: 'connection reset' } }
    const res = await POST(req({ assessment_id: 'a1' }))
    expect(res.status).toBe(500)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('returns a stable 503 without rendering or storing when the screening notice is unavailable', async () => {
    legalTest.resolution.value = {
      ok: false,
      code: 'no_eligible_document',
      message: 'No approved screening notice.',
    }

    const res = await POST(req({ assessment_id: 'a1' }))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'The screening notice is unavailable.',
      code: 'legal_unavailable',
    })
    expect(renderToBufferSpy).not.toHaveBeenCalled()
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(reportInsertSpy).not.toHaveBeenCalled()
  })

  test.each(['practitioner', 'client'] as const)(
    'passes the exact legal snapshot to the %s PDF and stores immutable provenance',
    async (variant) => {
      const res = await POST(req({ assessment_id: 'a1', variant }))

      expect(res.status).toBe(200)
      const document = renderToBufferSpy.mock.calls[0]?.[0] as { props: Record<string, unknown> }
      expect(document.props.legalNotice).toBe(legalTest.snapshot)
      expect(reportInsertSpy).toHaveBeenCalledWith('finalize_report_upload_v2', expect.objectContaining({
        p_document_id: legalTest.snapshot.documentId,
        p_document_version: legalTest.snapshot.version,
        p_document_body_sha256: legalTest.snapshot.bodySha256,
        p_document_effective_at: legalTest.snapshot.effectiveAt,
        p_jurisdiction: legalTest.snapshot.jurisdiction,
        p_product_scope: legalTest.snapshot.productScope,
      }))
      const [storagePath, , options] = uploadSpy.mock.calls[0]!
      const contentHash = createHash('sha256').update(Buffer.from('%PDF-1.4\n%mock')).digest('hex')
      expect(storagePath).toMatch(new RegExp(`^u1/a1/${variant}/${contentHash}-[0-9a-f-]{36}\\.pdf$`))
      expect(options).toMatchObject({ contentType: 'application/pdf', upsert: false })
    },
  )

  test('never reuses a storage object when the same report is generated twice', async () => {
    expect((await POST(req({ assessment_id: 'a1', variant: 'client' }))).status).toBe(200)
    expect((await POST(req({ assessment_id: 'a1', variant: 'client' }))).status).toBe(200)

    const paths = uploadSpy.mock.calls.map(([path]) => path)
    expect(paths).toHaveLength(2)
    expect(paths[0]).not.toBe(paths[1])
    expect(uploadSpy.mock.calls.every(([, , options]) => (
      options as { upsert?: boolean }
    ).upsert === false)).toBe(true)
  })

  test('does not upload when the durable cleanup intent cannot be persisted first', async () => {
    outboxWrite.error = { message: 'database unavailable' }

    const res = await POST(req({ assessment_id: 'a1' }))

    expect(res.status).toBe(500)
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(reportInsertSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(testSpies.logEvent.mock.calls)).not.toContain('database unavailable')
  })

  test('retains the durable intent when an upload error may be commit-ambiguous', async () => {
    uploadSpy.mockResolvedValueOnce({ error: { message: 'provider response lost after write' } })

    const res = await POST(req({ assessment_id: 'a1' }))

    expect(res.status).toBe(500)
    expect(outboxInsertSpy).toHaveBeenCalledOnce()
    expect(outboxDeleteSpy).not.toHaveBeenCalled()
    expect(reportInsertSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(testSpies.logEvent.mock.calls)).not.toContain('response lost')
  })

  test('retains the pre-upload cleanup intent when finalization cannot be confirmed', async () => {
    reportsInsert.data = null
    reportsInsert.error = { message: 'client was erased' }

    const res = await POST(req({ assessment_id: 'a1' }))

    expect(res.status).toBe(500)
    expect(removeSpy).not.toHaveBeenCalled()
    expect(outboxInsertSpy).toHaveBeenCalledOnce()
    expect(outboxDeleteSpy).not.toHaveBeenCalled()
  })

  test('creates durable cleanup before upload and never logs a raw ambiguous provider failure', async () => {
    reportsInsert.data = null
    reportsInsert.error = { message: 'provider included regulated data' }

    const res = await POST(req({ assessment_id: 'a1' }))

    expect(res.status).toBe(500)
    expect(outboxInsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      deletion_receipt_id: null,
      source_code: 'report_insert_compensation',
      bucket: 'posture-reports',
      object_path: expect.stringMatching(/^u1\/a1\/practitioner\//),
      next_attempt_at: expect.any(String),
    }))
    expect(outboxInsertSpy.mock.invocationCallOrder[0]).toBeLessThan(uploadSpy.mock.invocationCallOrder[0])
    expect(outboxDeleteSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(testSpies.logEvent.mock.calls)).not.toContain('provider included regulated data')
  })

  test('does not throw (returns 200) when an imbalance_definitions muscle list is malformed JSON', async () => {
    serverTables.assessment_findings = {
      data: [{ id: 'f1', imbalance_key: 'trunk_lean', region: 'spine', label: 'Trunk Lean',
        deviation: '5', direction: 'Forward', severity_pct: '40', zone: 'warning',
        unit: 'deg', view_used: 'side', confidence: '0.9' }],
      error: null,
    }
    serverTables.imbalance_definitions = {
      data: [{ key: 'trunk_lean', causes_text: '', tight_muscles: 'not-json', weak_muscles: '[]' }],
      error: null,
    }
    const res = await POST(req({ assessment_id: 'a1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).signed_url).toBe('/api/reports/r1/download')
  })

  test('rejects a comparison assessment that is not earlier than the current assessment', async () => {
    serverTableQueues.assessments = [
      { data: approvedAssessment, error: null },
      { data: { ...approvedAssessment, id: 'future', assessed_at: '2026-02-01T00:00:00Z' }, error: null },
    ]

    const res = await POST(req({ assessment_id: 'a1', compared_to_assessment_id: 'future', variant: 'client' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('must be earlier')
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('accepts an earlier comparison assessment within the same JavaScript millisecond', async () => {
    serverTableQueues.assessments = [
      { data: { ...approvedAssessment, assessed_at: '2026-01-01T00:00:00.123789Z' }, error: null },
      { data: { ...approvedAssessment, id: 'prior', assessed_at: '2026-01-01T00:00:00.123456Z' }, error: null },
    ]
    serverTableQueues.assessment_findings = [
      { data: [], error: null },
      { data: [], error: null },
    ]

    const res = await POST(req({ assessment_id: 'a1', compared_to_assessment_id: 'prior', variant: 'client' }))
    expect(res.status).toBe(200)
  })

  test.each([
    ['missing prior version', 'v1', null],
    ['missing current version', null, 'v1'],
    ['both versions missing', null, null],
    ['different versions', 'v2', 'v1'],
  ])('fails closed for %s in a client PDF response', async (_name, currentVersion, priorVersion) => {
    const current = { ...approvedAssessment, scoring_engine_version: currentVersion }
    const prior = {
      ...approvedAssessment,
      id: 'prior',
      assessed_at: '2025-12-01T00:00:00Z',
      scoring_engine_version: priorVersion,
      overall_score: 90,
      overall_grade: 'E',
    }
    const currentFinding = [{
      id: 'current-finding', imbalance_key: 'trunk_lean', region: 'spine', label: 'Trunk Lean',
      deviation: '1', direction: 'Forward', severity_pct: '10', zone: 'warning', unit: 'deg',
      view_used: 'side', confidence: '0.9',
    }]
    const priorFinding = [{
      id: 'prior-finding', imbalance_key: 'trunk_lean', deviation: '9', severity_pct: '90',
      zone: 'danger', unit: 'deg',
    }]
    serverTableQueues.assessments = [
      { data: current, error: null },
      { data: prior, error: null },
    ]
    serverTableQueues.assessment_findings = [
      { data: currentFinding, error: null },
      { data: priorFinding, error: null },
    ]

    const res = await POST(req({ assessment_id: 'a1', compared_to_assessment_id: 'prior', variant: 'client' }))
    expect(res.status).toBe(200)
    expect((await res.json()).comparison_overall).toBe('not_comparable')
  })

  test('returns within_tolerance for a one-point same-version grade-boundary crossing', async () => {
    serverTableQueues.assessments = [
      { data: { ...approvedAssessment, overall_score: 20, overall_grade: 'B' }, error: null },
      { data: { ...approvedAssessment, id: 'prior', overall_score: 21, overall_grade: 'C', assessed_at: '2025-12-01T00:00:00Z' }, error: null },
    ]
    serverTableQueues.assessment_findings = [
      { data: [], error: null },
      { data: [], error: null },
    ]

    const res = await POST(req({ assessment_id: 'a1', compared_to_assessment_id: 'prior', variant: 'client' }))
    expect(res.status).toBe(200)
    expect((await res.json()).comparison_overall).toBe('within_tolerance')
  })
})
