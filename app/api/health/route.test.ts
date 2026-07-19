import { beforeEach, describe, expect, test, vi } from 'vitest'

type ProbeResult = { error: { code?: string; message: string } | null }

const probeResults: Record<string, ProbeResult> = {}
const observedProbes: string[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (column: string) => ({
        limit: async () => {
          const key = `${table}.${column}`
          observedProbes.push(key)
          return probeResults[key] ?? { error: null }
        },
      }),
    }),
  }),
}))

import { GET } from './route'

describe('GET /api/health schema readiness', () => {
  beforeEach(() => {
    observedProbes.length = 0
    for (const key of Object.keys(probeResults)) delete probeResults[key]
  })

  test('probes every column required by the current assessment write path', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(observedProbes).toEqual(expect.arrayContaining([
      'practitioners.id',
      'muscles.slug',
      'assessments.priority_keys',
      'captures.profile_side',
      'assessment_findings.observations',
    ]))
    expect((await response.json()).schema).toBe('ready')
  })

  test.each([
    'captures.profile_side',
    'assessment_findings.observations',
  ])('reports pending_migration when %s is missing', async (probe) => {
    probeResults[probe] = { error: { code: '42703', message: 'column does not exist' } }

    const response = await GET()

    expect(response.status).toBe(200)
    expect((await response.json()).schema).toBe('pending_migration')
  })
})
