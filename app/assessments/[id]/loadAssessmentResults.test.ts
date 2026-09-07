import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  gate: null as Response | null,
  assessmentResult: { data: null, error: { code: 'PGRST116' } } as {
    data: Record<string, unknown> | null
    error: { code?: string; message?: string } | null
  },
  findingsResult: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
  capturesResult: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
  serverFrom: vi.fn(),
  serviceFrom: vi.fn(),
  assessmentEq: vi.fn(),
  findingsEq: vi.fn(),
  practitionerGate: vi.fn(),
  clinicalAccessForPractitioner: vi.fn(),
  logEvent: vi.fn(),
}))

const access = {
  mode: 'approved',
  reason: 'test',
  contentVersion: 'v1',
  surfaces: { recommendations: true, programs: true, workouts: true, knowledgeLinks: true },
  approvedExerciseSlugs: [] as string[],
  approvedLinkIds: [] as string[],
  approvedReportCopyIds: [] as string[],
}

function serverClient() {
  state.serverFrom.mockImplementation((table: string) => {
    if (table === 'assessments') {
      const query = {
        eq: state.assessmentEq,
        single: vi.fn(async () => state.assessmentResult),
      }
      state.assessmentEq.mockReturnValue(query)
      return { select: vi.fn(() => query) }
    }
    if (table === 'assessment_findings') {
      const query = {
        eq: state.findingsEq,
        order: vi.fn(async () => state.findingsResult),
      }
      state.findingsEq.mockReturnValue(query)
      return { select: vi.fn(() => query) }
    }
    throw new Error(`Unexpected server table: ${table}`)
  })
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: state.serverFrom,
  }
}

function serviceClient() {
  state.serviceFrom.mockImplementation((table: string) => {
    if (table !== 'captures') throw new Error(`Unexpected service table: ${table}`)
    return {
      select: vi.fn(() => ({
        eq: vi.fn(async () => state.capturesResult),
      })),
    }
  })
  return { from: state.serviceFrom }
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => serverClient(),
  createSupabaseServiceClient: () => serviceClient(),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({
  practitionerGate: state.practitionerGate,
}))
vi.mock('@/lib/log', () => ({
  logEvent: state.logEvent,
  hashUser: () => 'user-hash',
  hashResource: () => 'assessment-hash',
}))
vi.mock('@/lib/clinical-content/database', () => ({
  serverClinicalContentAccessForPractitioner: state.clinicalAccessForPractitioner,
}))
vi.mock('@/lib/clinical-content/catalog', () => ({
  approvedClinicalLinks: () => [],
}))
vi.mock('@/lib/clinical-content/surfaces', () => ({
  hasCompleteClinicalSurfaces: () => true,
}))
vi.mock('@/lib/program/clinicalProjection', () => ({
  buildClinicalProjection: () => ({
    program: { priorities: [], eligibleOrder: [] },
    exercises: [],
    sessionPreview: null,
  }),
}))

import { loadAssessmentResults, type AssessmentResultsPayload } from './loadAssessmentResults'

const assessment = {
  id: 'assessment-1',
  status: 'complete',
  overall_score: 12,
  overall_grade: 'A',
  scoring_engine_version: '2.1.0',
  tilt_corrected: false,
  level_verified: true,
  capture_stability: 0.98,
  assessed_at: '2026-07-02T00:00:00.000Z',
  priority_keys: [],
  capability: 'standard',
  exercise_swaps: {},
  practitioner_approved: false,
  practitioner_approved_at: null,
  notes: 'Follow-up screening',
  clients: { id: 'client-1', first_name: 'Ada', last_name: 'Lovelace' },
} satisfies AssessmentResultsPayload['assessment']

async function expectFailureStatus(status: number, message: string) {
  const result = await loadAssessmentResults('assessment-1')
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected loader failure')
  expect(result.response.status).toBe(status)
  expect(await result.response.json()).toEqual({ error: message })
}

describe('loadAssessmentResults authorization and read contracts', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.gate = null
    state.assessmentResult = { data: null, error: { code: 'PGRST116' } }
    state.findingsResult = { data: [], error: null }
    state.capturesResult = { data: [], error: null }
    state.serverFrom.mockReset()
    state.serviceFrom.mockReset()
    state.assessmentEq.mockReset()
    state.findingsEq.mockReset()
    state.practitionerGate.mockReset()
    state.practitionerGate.mockImplementation(async () => state.gate)
    state.clinicalAccessForPractitioner.mockReset()
    state.clinicalAccessForPractitioner.mockResolvedValue(access)
    state.logEvent.mockReset()
  })

  test('returns 401 before practitioner or assessment access when unauthenticated', async () => {
    state.user = null

    await expectFailureStatus(401, 'Unauthorized')

    expect(state.practitionerGate).not.toHaveBeenCalled()
    expect(state.serverFrom).not.toHaveBeenCalled()
  })

  test('returns the practitioner admission response before assessment access', async () => {
    state.gate = Response.json({ error: 'Forbidden' }, { status: 403 })

    await expectFailureStatus(403, 'Forbidden')

    expect(state.practitionerGate).toHaveBeenCalledWith(expect.anything(), state.user!.id)
    expect(state.serverFrom).not.toHaveBeenCalled()
    expect(state.clinicalAccessForPractitioner).not.toHaveBeenCalled()
  })

  test('returns 404 only after the practitioner-scoped assessment query has no row', async () => {
    await expectFailureStatus(404, 'Assessment not found')

    expect(state.assessmentEq).toHaveBeenNthCalledWith(1, 'id', 'assessment-1')
    expect(state.assessmentEq).toHaveBeenNthCalledWith(2, 'practitioner_id', state.user!.id)
  })

  test('returns 500 instead of an empty report when findings fail to load', async () => {
    state.assessmentResult = { data: assessment, error: null }
    state.findingsResult = { data: [], error: { message: 'database unavailable' } }

    await expectFailureStatus(500, 'Internal server error')

    expect(state.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      route: 'GET /api/assessments/[id]',
      status: 500,
      detailCode: 'findings_load_failed',
    }))
    expect(state.serviceFrom).not.toHaveBeenCalled()
  })

  test('returns 500 instead of an incomplete report when captures fail to load', async () => {
    state.assessmentResult = { data: assessment, error: null }
    state.capturesResult = { data: [], error: { message: 'captures unavailable' } }

    await expectFailureStatus(500, 'Internal server error')

    expect(state.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      route: 'GET /api/assessments/[id]',
      status: 500,
      detailCode: 'captures_load_failed',
    }))
  })

  test('returns the same complete payload consumed by the page and API route', async () => {
    state.assessmentResult = { data: assessment, error: null }

    const result = await loadAssessmentResults('assessment-1')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected loader success')
    expect(result.data).toEqual({
      assessment,
      findings: [],
      captures: [],
      clinical_content: {
        enabled: true,
        surfaces: access.surfaces,
        mode: access.mode,
        version: access.contentVersion,
        projection: {
          program: { priorities: [], eligibleOrder: [] },
          exercises: [],
          sessionPreview: null,
        },
      },
    })
    expect(state.clinicalAccessForPractitioner).toHaveBeenCalledWith(state.user!.id)
  })
})
