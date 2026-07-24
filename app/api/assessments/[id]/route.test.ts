import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  access: {
    mode: 'approved',
    reason: 'test',
    contentVersion: 'v1',
    surfaces: { recommendations: true, programs: true, workouts: true, knowledgeLinks: true },
    approvedExerciseSlugs: [] as string[],
    approvedLinkIds: [] as string[],
    approvedReportCopyIds: [] as string[],
  },
  update: vi.fn(),
  loadAssessmentResults: vi.fn(),
}))

function serviceClient() {
  return {
    from: vi.fn(() => ({
      update: state.update.mockReturnValue({
        eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      }),
    })),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createSupabaseServiceClient: () => serviceClient(),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ logEvent: () => {}, hashUser: () => 'u', hashResource: () => 'r' }))
vi.mock('@/lib/clinical-content/runtime', () => ({ clinicalContentAccess: () => state.access }))
vi.mock('@/lib/clinical-content/database', () => ({
  verifyClinicalContentAccess: async (access: unknown) => access,
}))
vi.mock('@/app/assessments/[id]/loadAssessmentResults', () => ({
  loadAssessmentResults: state.loadAssessmentResults,
}))

import { GET, PATCH } from './route'

function invoke(body: Record<string, unknown> = { capability: 'standard' }) {
  return PATCH(
    new NextRequest('http://localhost/api/assessments/a1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'a1' }) },
  )
}

function invokeGet() {
  return GET(
    new NextRequest('http://localhost/api/assessments/a1'),
    { params: Promise.resolve({ id: 'a1' }) },
  )
}

describe('GET /api/assessments/[id] loader parity', () => {
  beforeEach(() => {
    state.loadAssessmentResults.mockReset()
  })

  test('serializes the successful loader payload without reshaping it', async () => {
    const payload = {
      assessment: { id: 'a1', status: 'complete' },
      findings: [{ id: 'finding-1' }],
      captures: [],
      clinical_content: { enabled: true, projection: { program: { priorities: [] } } },
    }
    state.loadAssessmentResults.mockResolvedValue({ ok: true, data: payload })

    const response = await invokeGet()

    expect(state.loadAssessmentResults).toHaveBeenCalledWith('a1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(payload)
  })

  test('returns the loader authorization or read failure unchanged', async () => {
    state.loadAssessmentResults.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Assessment not found' }, { status: 404 }),
    })

    const response = await invokeGet()

    expect(state.loadAssessmentResults).toHaveBeenCalledWith('a1')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Assessment not found' })
  })
})

describe('PATCH /api/assessments/[id] clinical surface gating', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.access.surfaces = { recommendations: true, programs: true, workouts: true, knowledgeLinks: true }
    state.update.mockClear()
  })

  test('accepts overrides when all four clinical surfaces are enabled', async () => {
    const response = await invoke()

    expect(response.status).toBe(200)
    expect(state.update).toHaveBeenCalledWith({ capability: 'standard' })
  })

  test('rejects overrides in a partial release even with programs enabled', async () => {
    // GET and the assessment page only expose overrides when ALL four surfaces
    // are on; a PATCH gated on programs alone writes invisible, inert state.
    state.access.surfaces = { recommendations: true, programs: true, workouts: true, knowledgeLinks: false }

    const response = await invoke()

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('clinical_content_disabled')
    expect(state.update).not.toHaveBeenCalled()
  })
})
