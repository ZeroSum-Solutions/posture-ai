import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import { DEFAULT_WORKOUT_PREFERENCES } from '@/lib/workout/personalize'

const state = vi.hoisted(() => ({
  build: vi.fn(),
  screen: vi.fn(),
  provider: vi.fn(),
  assessmentEq: vi.fn(),
  clinicalEnabled: true,
  approved: true,
  assessmentStatus: 'complete',
}))

const assessmentId = '11111111-1111-4111-8111-111111111111'
const candidate: SessionSnapshot = {
  version: 1,
  week: 1,
  capability: 'standard',
  disclaimer: 'Screening support only.',
  priorities: [{
    primaryKey: 'forward_head',
    label: 'Forward head',
    zone: 'warning',
    severityWord: 'moderate',
  }],
  items: [
    {
      index: 0,
      slug: 'neck-mobility',
      baseSlug: 'neck-mobility',
      name: 'Neck mobility',
      category: 'mobility',
      stepLabel: 'Loosen',
      priorityKey: 'forward_head',
      priorityLabel: 'Forward head',
      isIntegrative: false,
      instructions: 'Move slowly while keeping the ribs quiet and the shoulders relaxed.',
      timing: { kind: 'hold', sets: 2, secondsPerSet: 30, restSeconds: 10 },
    },
    {
      index: 1,
      slug: 'wall-slide',
      baseSlug: 'wall-slide',
      name: 'Wall slide',
      category: 'strengthen',
      stepLabel: 'Strengthen',
      priorityKey: 'forward_head',
      priorityLabel: 'Forward head',
      isIntegrative: false,
      instructions: 'Keep contact with the wall and move through a comfortable range.',
      timing: { kind: 'reps', sets: 2, repsPerSet: 8, restSeconds: 20 },
    },
  ],
  estimatedDurationSec: 178,
}

function queryFor(table: string) {
  const query = {
    select: () => query,
    eq: (field: string, value: string) => {
      if (table === 'assessments') state.assessmentEq(field, value)
      return query
    },
    maybeSingle: async () => table === 'assessments'
      ? {
          data: {
            id: assessmentId,
            client_id: '22222222-2222-4222-8222-222222222222',
            overall_grade: 'B',
            capability: 'standard',
            priority_keys: null,
            exercise_swaps: null,
            practitioner_approved: state.approved,
            status: state.assessmentStatus,
          },
          error: null,
        }
      : { data: null, error: null },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(
      table === 'assessment_findings'
        ? { data: [{ imbalance_key: 'forward_head' }], error: null }
        : { data: null, error: null },
    ).then(resolve),
  }
  return query
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '33333333-3333-4333-8333-333333333333' } } }) },
  }),
  createSupabaseServiceClient: () => ({ from: queryFor }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/clinical-content/database', () => ({
  serverClinicalContentAccessForPractitioner: async () => ({
    surfaces: { workouts: state.clinicalEnabled },
    approvedExerciseSlugs: ['neck-mobility', 'wall-slide'],
    approvedLinkIds: ['link:forward-head'],
    approvedReportCopyIds: ['report-copy:forward-head'],
  }),
}))
vi.mock('@/lib/workout/buildSessionFromAssessment', () => ({
  buildSessionFromAssessment: state.build,
}))
vi.mock('@/lib/training/screening/derivedUse', () => ({
  SCREENING_CAPTURE_SELECT: 'screening-captures',
  screenFindingsForDerivedUse: state.screen,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/workouts/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/workouts/preview', () => {
  beforeEach(() => {
    state.build.mockReset().mockReturnValue(candidate)
    state.screen.mockReset().mockImplementation((input: { findings: unknown[] }) => ({
      screeningContext: { version: 'screening-context-v1', scanUse: 'descriptive' },
      descriptiveFindings: input.findings,
    }))
    state.provider.mockReset()
    state.assessmentEq.mockReset()
    state.clinicalEnabled = true
    state.approved = true
    state.assessmentStatus = 'complete'
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('builds a deterministic preview from the owned stored assessment', async () => {
    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'scan',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      source: 'scan',
      name: 'Everyday balance',
      snapshot: { items: [{ slug: 'neck-mobility' }, { slug: 'wall-slide' }] },
    })
    expect(state.assessmentEq).toHaveBeenCalledWith('practitioner_id', '33333333-3333-4333-8333-333333333333')
    expect(state.build).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'standard' }),
      expect.any(Array),
      1,
      expect.objectContaining({ approvedExerciseSlugs: ['neck-mobility', 'wall-slide'] }),
    )
  })

  test('sends only bounded catalog data to AI and validates the returned slugs', async () => {
    vi.stubEnv('POSTURE_WORKOUT_OPENROUTER_API_KEY', 'unit-test-key')
    vi.stubEnv('POSTURE_WORKOUT_OPENROUTER_MODEL', 'unit-test-model')
    const provider = vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ slugs: ['wall-slide'] }) } }],
    }))
    vi.stubGlobal('fetch', provider)

    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'ai',
    }))
    const body = await response.json()

    expect(body.source).toBe('ai')
    expect(body.snapshot.items.map((entry: { slug: string }) => entry.slug)).toEqual(['wall-slide'])
    const providerBody = JSON.parse(provider.mock.calls[0][1].body)
    expect(providerBody.messages[1].content).not.toMatch(/11111111|22222222|client|confidence|deviation|image/i)
  })

  test('falls back to a scan-selected preview when the provider returns an invented exercise', async () => {
    vi.stubEnv('POSTURE_WORKOUT_OPENROUTER_API_KEY', 'unit-test-key')
    vi.stubEnv('POSTURE_WORKOUT_OPENROUTER_MODEL', 'unit-test-model')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ slugs: ['invented'] }) } }],
    })))

    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'ai',
    }))
    const body = await response.json()

    expect(body.source).toBe('scan')
    expect(body.notice).toMatch(/could not finish/i)
    expect(body.snapshot.items.some((entry: { slug: string }) => entry.slug === 'invented')).toBe(false)
  })

  test('uses only the selected DeepSeek provider with thinking disabled', async () => {
    vi.stubEnv('POSTURE_WORKOUT_AI_PROVIDER', 'deepseek')
    vi.stubEnv('POSTURE_WORKOUT_DEEPSEEK_API_KEY', 'unit-test-key')
    vi.stubEnv('POSTURE_WORKOUT_DEEPSEEK_MODEL', 'deepseek-v4-flash')
    const provider = vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ slugs: ['wall-slide'] }) } }],
    }))
    vi.stubGlobal('fetch', provider)

    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'ai',
    }))

    expect(response.status).toBe(200)
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions')
    const providerBody = JSON.parse(provider.mock.calls[0][1].body)
    expect(providerBody).toMatchObject({ model: 'deepseek-v4-flash', thinking: { type: 'disabled' } })
    expect(providerBody).not.toHaveProperty('reasoning')
  })

  test('rejects browser-supplied findings before loading assessment content', async () => {
    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'scan',
      findings: [{ key: 'untrusted' }],
    }))

    expect(response.status).toBe(422)
    expect(state.build).not.toHaveBeenCalled()
  })

  test('requires the same practitioner approval gate as workout minting', async () => {
    state.approved = false

    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'scan',
    }))

    expect(response.status).toBe(403)
    expect(state.build).not.toHaveBeenCalled()
  })

  test('does not build a preview when screening evidence is unavailable or incompatible', async () => {
    state.screen.mockReturnValueOnce({
      screeningContext: { version: 'screening-context-v1', scanUse: 'incompatible' },
      descriptiveFindings: [],
    })

    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'scan',
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ code: 'screening_context_unavailable' })
    expect(state.build).not.toHaveBeenCalled()
  })

  test('rejects an approved assessment whose analysis is incomplete', async () => {
    state.assessmentStatus = 'failed'

    const response = await POST(request({
      assessment_id: assessmentId,
      preferences: DEFAULT_WORKOUT_PREFERENCES,
      mode: 'scan',
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Assessment analysis is not complete.' })
    expect(state.build).not.toHaveBeenCalled()
  })
})
