import { describe, test, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Per-table result for the authed server client. supabase-js resolves to
// { data, error } and does NOT throw on DB errors.
const serverTables: Record<string, { data: unknown; error: unknown }> = {}
const serverTableQueues: Record<string, Array<{ data: unknown; error: unknown }>> = {}
const reportsInsert: { data: unknown; error: unknown } = { data: { id: 'r1' }, error: null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuery(result: () => { data: unknown; error: unknown }): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q, eq: () => q, neq: () => q, order: () => q, in: () => q, insert: () => q,
    single: async () => result(),
    maybeSingle: async () => result(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (onF: any, onR: any) => Promise.resolve(result()).then(onF, onR),
  }
  return q
}

const uploadSpy = vi.fn(async () => ({ error: null }))

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
        upload: uploadSpy,
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed' }, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from: () => makeQuery(() => reportsInsert),
  }),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@react-pdf/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  renderToBuffer: async () => Buffer.from('%PDF-1.4\n%mock'),
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
    for (const key of Object.keys(serverTableQueues)) delete serverTableQueues[key]
    serverTables.assessments = { data: approvedAssessment, error: null }
    serverTables.assessment_findings = { data: [], error: null }
    serverTables.imbalance_definitions = { data: [], error: null }
    serverTables.practitioners = { data: { display_name: 'Dr X', practice_name: 'Clinic' }, error: null }
  })

  test('returns 500 (and does NOT upload a PDF) when the findings read errors — a failed read must not become a clean "zero issues" report', async () => {
    serverTables.assessment_findings = { data: null, error: { message: 'connection reset' } }
    const res = await POST(req({ assessment_id: 'a1' }))
    expect(res.status).toBe(500)
    expect(uploadSpy).not.toHaveBeenCalled()
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
