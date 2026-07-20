import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const testState = vi.hoisted(() => ({
  resolution: { value: { ok: true, document: { id: 'screening-notice-v1' } } as Record<string, unknown> },
  legalNotice: {
    schemaVersion: 1 as const,
    documentId: 'screening-notice-v1',
    kind: 'screening_notice' as const,
    version: '2026-07-20',
    title: 'Screening Notice',
    effectiveAt: '2026-07-20T00:00:00.000Z',
    jurisdiction: 'US',
    locale: 'en-US',
    productScope: 'us_fitness_wellness_assessment_beta_v1',
    audience: 'public' as const,
    bodySha256: 'ad48aaa235c910cc56721c4e5c0ccc17d476e8207df0f73db8129a6cabb85ce7',
    text: 'Screening Notice\n\nExact governed workout notice.',
    sections: [{ id: 'notice', heading: null, paragraphs: ['Exact governed workout notice.'] }],
    isFixture: true,
  },
  build: vi.fn(),
  snapshot: vi.fn(),
  workoutInsert: vi.fn(),
  runInsert: vi.fn(),
}))

const assessmentId = '11111111-1111-4111-8111-111111111111'
const assessment = {
  id: assessmentId,
  client_id: 'client-1',
  overall_grade: 'B',
  capability: 'standard',
  priority_keys: null,
  exercise_swaps: null,
  practitioner_approved: true,
}
const legacySnapshot = {
  version: 1 as const,
  week: 1 as const,
  capability: 'standard' as const,
  priorities: [],
  items: [],
  estimatedDurationSec: 720,
  disclaimer: 'Legacy screening notice.',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serviceQuery(table: string): any {
  let insertValue: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    delete: () => q,
    insert: (value: unknown) => {
      insertValue = value
      if (table === 'workout_sessions') testState.workoutInsert(value)
      if (table === 'session_runs') testState.runInsert(value)
      return q
    },
    maybeSingle: async () => table === 'assessments'
      ? { data: assessment, error: null }
      : { data: null, error: null },
    single: async () => table === 'workout_sessions'
      ? { data: { id: 'session-1' }, error: null }
      : { data: insertValue, error: null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (onF: any, onR: any) => Promise.resolve(
      table === 'assessment_findings'
        ? { data: [], error: null }
        : { data: insertValue, error: null },
    ).then(onF, onR),
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'practitioner-1' } } }) },
  }),
  createSupabaseServiceClient: () => ({ from: serviceQuery }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({
  logEvent: vi.fn(),
  hashUser: () => 'user-hash',
  hashIp: () => null,
}))
vi.mock('@/lib/workout/buildSessionFromAssessment', () => ({
  buildSessionFromAssessment: testState.build,
}))
vi.mock('@/lib/legal/runtime', () => ({
  resolveRuntimeLegalDocument: () => testState.resolution.value,
}))
vi.mock('@/lib/legal/policy', () => ({
  snapshotLegalDocument: testState.snapshot,
}))

import { POST } from './route'

function request() {
  return new NextRequest('http://localhost/api/workouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assessment_id: assessmentId, week: 1 }),
  })
}

describe('POST /api/workouts', () => {
  beforeEach(() => {
    testState.build.mockReset().mockReturnValue(legacySnapshot)
    testState.snapshot.mockReset().mockReturnValue(testState.legalNotice)
    testState.workoutInsert.mockReset()
    testState.runInsert.mockReset()
    testState.resolution.value = { ok: true, document: { id: 'screening-notice-v1' } }
  })

  test('returns a stable 503 without generating or storing when the screening notice is unavailable', async () => {
    testState.resolution.value = {
      ok: false,
      code: 'no_eligible_document',
      message: 'No approved screening notice.',
    }

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'The screening notice is unavailable.',
      code: 'legal_unavailable',
    })
    expect(testState.build).not.toHaveBeenCalled()
    expect(testState.workoutInsert).not.toHaveBeenCalled()
    expect(testState.runInsert).not.toHaveBeenCalled()
  })

  test('stores a governed v2 snapshot and matching scalar provenance', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(testState.workoutInsert).toHaveBeenCalledWith(expect.objectContaining({
      program_snapshot: {
        version: 2,
        week: 1,
        capability: 'standard',
        priorities: [],
        items: [],
        estimatedDurationSec: 720,
        legalNotice: testState.legalNotice,
      },
      legal_document_id: testState.legalNotice.documentId,
      legal_document_version: testState.legalNotice.version,
      legal_document_body_sha256: testState.legalNotice.bodySha256,
      legal_document_effective_at: testState.legalNotice.effectiveAt,
      legal_jurisdiction: testState.legalNotice.jurisdiction,
      legal_product_scope: testState.legalNotice.productScope,
      legal_provenance_state: 'governed',
    }))
    expect(testState.runInsert).toHaveBeenCalledOnce()
  })
})
