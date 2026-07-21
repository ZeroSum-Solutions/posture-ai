import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  access: {
    mode: 'test_fixture',
    surfaces: { recommendations: true },
    approvedExerciseSlugs: ['wall-angels'],
    approvedExerciseMuscleIds: [
      'exercise_muscle:wall-angels:lower-trapezius:strengthen:2',
      'exercise_muscle:wall-angels:middle-trapezius:strengthen:2',
      'exercise_muscle:wall-angels:serratus-anterior:strengthen:2',
    ] as string[],
  },
  result: { data: null as Record<string, unknown> | null, error: null as unknown },
  from: vi.fn(),
}))

function exerciseQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => state.result) })),
    })),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createSupabaseServiceClient: () => ({ from: state.from }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/clinical-content/runtime', () => ({ clinicalContentAccess: () => state.access }))

import { GET } from './route'

function invoke(slug = 'wall-angels') {
  return GET(new NextRequest(`http://localhost/api/clinical-content/exercises/${slug}`), {
    params: Promise.resolve({ slug }),
  })
}

describe('GET /api/clinical-content/exercises/[slug]', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.access.mode = 'test_fixture'
    state.access.surfaces.recommendations = true
    state.access.approvedExerciseSlugs = ['wall-angels']
    state.access.approvedExerciseMuscleIds = [
      'exercise_muscle:wall-angels:lower-trapezius:strengthen:2',
      'exercise_muscle:wall-angels:middle-trapezius:strengthen:2',
      'exercise_muscle:wall-angels:serratus-anterior:strengthen:2',
    ]
    state.result = {
      data: {
        name: 'Wall Angel', category: 'mobility', instructions: 'Move slowly.',
        sets: 2, hold_seconds: null, video_url: null, poster_url: null,
        exercise_muscles: [{ muscle_slug: 'lower-trapezius', role: 'strengthen', progression_level: 2 }],
      },
      error: null,
    }
    state.from.mockReset().mockImplementation(() => exerciseQuery())
  })

  test('does not query the catalog while recommendations are disabled', async () => {
    state.access.surfaces.recommendations = false

    const response = await invoke()

    expect(response.status).toBe(404)
    expect(state.from).not.toHaveBeenCalled()
  })

  test('requires an authenticated practitioner session', async () => {
    state.user = null

    const response = await invoke()

    expect(response.status).toBe(401)
    expect(state.from).not.toHaveBeenCalled()
  })

  test('preserves complete exercise detail in explicit fixture mode', async () => {
    const response = await invoke()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      detail: { name: 'Wall Angels', sets: 3, hold_seconds: 3 },
      muscles: [
        { muscle_slug: 'lower-trapezius', role: 'strengthen' },
        { muscle_slug: 'middle-trapezius', role: 'strengthen' },
        { muscle_slug: 'serratus-anterior', role: 'strengthen' },
      ],
    })
  })

  test('filters unapproved exercise-muscle associations from an approved release', async () => {
    state.access.mode = 'approved'
    state.access.approvedExerciseMuscleIds = []

    const response = await invoke()

    await expect(response.json()).resolves.toMatchObject({ muscles: [] })
  })

  test('keeps an association present in the approved release inventory', async () => {
    state.access.mode = 'approved'
    state.access.approvedExerciseMuscleIds = [
      'exercise_muscle:wall-angels:lower-trapezius:strengthen:2',
    ]

    const response = await invoke()

    await expect(response.json()).resolves.toMatchObject({
      muscles: [{ muscle_slug: 'lower-trapezius', role: 'strengthen' }],
    })
  })
})
