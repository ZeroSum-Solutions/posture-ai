import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  access: {
    mode: 'test_fixture',
    surfaces: { knowledgeLinks: true, recommendations: true },
    approvedMuscleSlugs: ['pectoralis-minor'] as string[],
    approvedLinkIds: [] as string[],
    approvedExerciseSlugs: [] as string[],
    approvedExerciseMuscleIds: [] as string[],
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/clinical-content/runtime', () => ({ clinicalContentAccess: () => state.access }))
vi.mock('@/lib/clinical-content/database', () => ({ verifyClinicalContentAccess: async (a: unknown) => a }))

import { GET } from './route'

function invoke(slug = 'pectoralis-minor') {
  return GET(new NextRequest(`http://localhost/api/clinical-content/muscles/${slug}`), {
    params: Promise.resolve({ slug }),
  })
}

describe('GET /api/clinical-content/muscles/[slug]', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.access.surfaces = { knowledgeLinks: true, recommendations: true }
    state.access.approvedMuscleSlugs = ['pectoralis-minor']
  })

  test('requires an authenticated practitioner session', async () => {
    state.user = null
    expect((await invoke()).status).toBe(401)
  })

  test('is unavailable while knowledge links are not released', async () => {
    state.access.surfaces.knowledgeLinks = false
    expect((await invoke()).status).toBe(404)
  })

  test('404s an unreleased or malformed muscle slug', async () => {
    expect((await invoke('upper-trapezius')).status).toBe(404)
    expect((await invoke('../etc')).status).toBe(404)
  })

  test('returns the authored anatomy copy for a released muscle', async () => {
    const response = await invoke()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.muscle).toMatchObject({ slug: 'pectoralis-minor', name: expect.any(String) })
    expect(body.muscle.anatomy.length).toBeGreaterThan(0)
    expect(body.muscle.function.length).toBeGreaterThan(0)
    expect(Array.isArray(body.links)).toBe(true)
    expect(Array.isArray(body.exercises)).toBe(true)
  })
})
