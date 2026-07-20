import { beforeEach, describe, expect, test, vi } from 'vitest'

const { listUsers, acceptanceInsert } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  acceptanceInsert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { listUsers } },
    from: (table: string) => {
      if (table === 'practitioners') {
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => ({ data: { id: 'u1' }, error: null }),
        }
        return query
      }
      if (table === 'practitioner_legal_acceptances') return { upsert: acceptanceInsert }
      throw new Error(`Unexpected table ${table}`)
    },
  }),
}))

import { GET } from './route'

describe('GET /api/dev/create-test-user fixture legal seed', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('POSTURE_TEST_MODE_ENABLED', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    listUsers.mockReset().mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'testpractitioner@postureai.test' }] },
    })
    acceptanceInsert.mockReset().mockResolvedValue({ error: null })
  })

  test('seeds exact fixture acceptances for an existing test practitioner', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    const rows = acceptanceInsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.legal_document_id).sort()).toEqual([
      'privacy-test-fixture-v1',
      'screening-notice-test-fixture-v1',
      'terms-test-fixture-v1',
    ])
    expect(rows.every((row) => row.practitioner_id === 'u1')).toBe(true)
  })
})
