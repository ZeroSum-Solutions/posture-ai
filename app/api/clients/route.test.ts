import { describe, test, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The clients INSERT result (service-role). Set per test.
let insertResult: { data: unknown; error: unknown } = { data: { id: 'c1' }, error: null }
const insertSpy = vi.fn(() => ({
  select: () => ({ single: async () => insertResult }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({}),
  }),
  createSupabaseServiceClient: () => ({
    from: () => ({ insert: insertSpy }),
    rpc: async () => ({ data: 'ok', error: null }),
  }),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))

import { POST } from './route'

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/clients', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/clients validation', () => {
  beforeEach(() => {
    insertSpy.mockClear()
    insertResult = { data: { id: 'c1' }, error: null }
  })

  test('rejects an invalid sex_at_birth enum with 400 (not a 500 leaking the raw DB error)', async () => {
    // Pre-fix this reaches Postgres, which rejects the enum and returns its raw
    // message verbatim as a 500 (schema-internals disclosure).
    insertResult = { data: null, error: { message: 'invalid input value for enum sex_enum: "X"' } }
    const res = await POST(req({ first_name: 'A', last_name: 'B', sex_at_birth: 'X', consent_mode: 'remote' }))
    expect(res.status).toBe(400)
    expect(insertSpy).not.toHaveBeenCalled()
    const bodyText = JSON.stringify(await res.json())
    expect(bodyText).not.toContain('enum')
  })

  test('rejects a negative height_cm with 400 and never inserts impossible PHI', async () => {
    const res = await POST(req({ first_name: 'A', last_name: 'B', height_cm: -40, consent_mode: 'remote' }))
    expect(res.status).toBe(400)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  test('accepts a valid client (201)', async () => {
    const res = await POST(req({ first_name: 'A', last_name: 'B', sex_at_birth: 'female', height_cm: 170, consent_mode: 'remote' }))
    expect(res.status).toBe(201)
    expect(insertSpy).toHaveBeenCalledOnce()
  })
})
