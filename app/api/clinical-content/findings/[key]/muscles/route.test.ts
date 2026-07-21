import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  access: {
    mode: 'test_fixture',
    surfaces: { knowledgeLinks: true },
    approvedMuscleSlugs: ['latissimus-dorsi'],
    approvedLinkIds: ['link:latissimus-dorsi:trunk_lean:tight'] as string[],
  },
  result: { data: [] as Record<string, unknown>[], error: null as unknown },
  from: vi.fn(),
}))

function linkQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(async () => state.result),
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

function invoke(key = 'trunk_lean') {
  return GET(new NextRequest(`http://localhost/api/clinical-content/findings/${key}/muscles`), {
    params: Promise.resolve({ key }),
  })
}

describe('GET /api/clinical-content/findings/[key]/muscles', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.access.mode = 'test_fixture'
    state.access.surfaces.knowledgeLinks = true
    state.access.approvedMuscleSlugs = ['latissimus-dorsi']
    state.access.approvedLinkIds = ['link:latissimus-dorsi:trunk_lean:tight']
    state.result = {
      data: [
        { role: 'tight', muscle_slug: 'latissimus-dorsi', link_evidence: 'medium', scored: true, muscles: { name: 'Latissimus Dorsi' } },
        { role: 'weak', muscle_slug: 'display-only', link_evidence: 'low', scored: false, muscles: { name: 'Display Only' } },
      ],
      error: null,
    }
    state.from.mockReset().mockImplementation(() => linkQuery())
  })

  test('does not query the catalog while knowledge links are disabled', async () => {
    state.access.surfaces.knowledgeLinks = false

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

  test('returns scored fixture links normalized for the sheet', async () => {
    const response = await invoke()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      muscles: [{
        slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', role: 'tight', confidence: 'low',
      }],
    })
  })

  test('filters links not present in the approved release inventory', async () => {
    state.access.mode = 'approved'
    state.access.approvedLinkIds = []

    const response = await invoke()

    await expect(response.json()).resolves.toEqual({ muscles: [] })
  })

  test('keeps a link present in the approved release inventory', async () => {
    state.access.mode = 'approved'
    state.access.approvedLinkIds = ['link:latissimus-dorsi:trunk_lean:tight']

    const response = await invoke()

    await expect(response.json()).resolves.toMatchObject({
      muscles: [{ slug: 'latissimus-dorsi', role: 'tight' }],
    })
  })
})
