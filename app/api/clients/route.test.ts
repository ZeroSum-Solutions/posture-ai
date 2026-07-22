import { describe, test, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The clients INSERT result (service-role). Set per test.
let insertResult: { data: unknown; error: unknown } = { data: { id: 'c1' }, error: null }
const insertSpy = vi.fn(() => ({
  select: () => ({ single: async () => insertResult }),
}))
const fromSpy = vi.fn(() => ({ insert: insertSpy }))
const rpcSpy = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
  data: { id: 'c1', first_name: 'A', last_name: 'B', consent_recorded_at: '2026-07-20T00:00:00.000Z' },
  error: null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({}),
  }),
  createSupabaseServiceClient: () => ({
    from: fromSpy,
    rpc: rpcSpy,
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
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
    insertSpy.mockClear()
    fromSpy.mockClear()
    rpcSpy.mockClear()
    rpcSpy.mockResolvedValue({
      data: { id: 'c1', first_name: 'A', last_name: 'B', consent_recorded_at: '2026-07-20T00:00:00.000Z' },
      error: null,
    })
    insertResult = { data: { id: 'c1' }, error: null }
  })

  test('rejects an invalid sex_at_birth enum with 400 (not a 500 leaking the raw DB error)', async () => {
    // Pre-fix this reaches Postgres, which rejects the enum and returns its raw
    // message verbatim as a 500 (schema-internals disclosure).
    insertResult = { data: null, error: { message: 'invalid input value for enum sex_enum: "X"' } }
    const res = await POST(req({ first_name: 'A', last_name: 'B', sex_at_birth: 'X', consent_mode: 'remote' }))
    expect(res.status).toBe(400)
    expect(fromSpy).not.toHaveBeenCalled()
    const bodyText = JSON.stringify(await res.json())
    expect(bodyText).not.toContain('enum')
  })

  test('rejects a negative height_cm with 400 and never inserts impossible PHI', async () => {
    const res = await POST(req({ first_name: 'A', last_name: 'B', height_cm: -40, consent_mode: 'remote' }))
    expect(res.status).toBe(400)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  test('accepts a valid client (201)', async () => {
    const res = await POST(req({ first_name: 'A', last_name: 'B', sex_at_birth: 'female', height_cm: 170, consent_mode: 'remote' }))
    expect(res.status).toBe(201)
    expect(insertSpy).toHaveBeenCalledOnce()
  })

  test('records in-person consent through the governed RPC with exact provenance', async () => {
    const res = await POST(req({
      first_name: 'A',
      last_name: 'B',
      consent_mode: 'in_person',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      legal_document_id: 'subject-consent-test-fixture-v1',
      legal_document_version: 'test-1',
      legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
    }))

    expect(res.status).toBe(201)
    expect(rpcSpy).toHaveBeenCalledWith(
      'create_client_with_inperson_consent_governed',
      expect.objectContaining({
        p_practitioner_id: 'u1',
        p_first_name: 'A',
        p_last_name: 'B',
        p_document_id: 'subject-consent-test-fixture-v1',
        p_document_version: 'test-1',
        p_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
      }),
    )
    expect(insertSpy).not.toHaveBeenCalled()
  })

  test('fails the entire in-person enrollment when the transactional RPC fails', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { message: 'consent rejected' } })

    const res = await POST(req({
      first_name: 'A',
      last_name: 'B',
      consent_mode: 'in_person',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      legal_document_id: 'subject-consent-test-fixture-v1',
      legal_document_version: 'test-1',
      legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
    }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'Failed to create client and record consent.' })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  test('rejects stale in-person evidence before creating the client', async () => {
    const res = await POST(req({
      first_name: 'A',
      last_name: 'B',
      consent_mode: 'in_person',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      legal_document_id: 'subject-consent-test-fixture-v1',
      legal_document_version: 'test-1',
      legal_document_body_sha256: '0'.repeat(64),
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'superseded' })
    expect(insertSpy).not.toHaveBeenCalled()
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
