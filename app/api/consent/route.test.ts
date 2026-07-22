import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getConsentStatus: vi.fn(),
  captureEligibility: vi.fn(),
  clientResult: { data: { id: 'c1', date_of_birth: '1990-01-01' }, error: null } as { data: unknown; error: unknown },
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => mocks.clientResult,
      }
      return chain
    },
  }),
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))
vi.mock('@/lib/consent/record', () => ({
  getConsentStatus: mocks.getConsentStatus,
  captureEligibility: mocks.captureEligibility,
}))

import { GET, POST } from './route'

const evidence = {
  legal_document_id: 'subject-consent-test-fixture-v1',
  legal_document_version: 'test-1',
  legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: 'c1',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      ...evidence,
      ...overrides,
    }),
  })
}

describe('POST /api/consent governed in-person consent', () => {
  beforeEach(() => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
    mocks.rpc.mockReset().mockResolvedValue({ data: 'ok', error: null })
    mocks.clientResult = { data: { id: 'c1', date_of_birth: '1990-01-01' }, error: null }
    mocks.getConsentStatus.mockReset().mockResolvedValue({
      hasConsent: true,
      signerRelationship: 'self',
      legalState: 'current',
      document: {},
    })
    mocks.captureEligibility.mockReset().mockReturnValue({ ok: true, reason: null })
  })

  test('verifies submitted evidence and calls only the governed RPC', async () => {
    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc.mock.calls[0][0]).toBe('record_inperson_consent_governed')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_client_id: 'c1',
      p_practitioner_id: 'u1',
      p_document_id: evidence.legal_document_id,
      p_document_version: evidence.legal_document_version,
      p_document_body_sha256: evidence.legal_document_body_sha256,
      p_document_effective_at: '2026-07-20T00:00:00.000Z',
      p_jurisdiction: 'US',
      p_product_scope: 'us_fitness_wellness_assessment_beta_v1',
      p_signer_name: 'Morgan Example',
      p_signer_relationship: 'self',
      p_consent_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_signed_at: expect.any(String),
    })
  })

  test('rejects stale or forged submitted evidence before writing', async () => {
    const response = await POST(request({ legal_document_body_sha256: '0'.repeat(64) }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'superseded' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  test('fails closed when production consent copy is unavailable', async () => {
    delete process.env.POSTURE_TEST_MODE_ENABLED
    process.env.VERCEL_ENV = 'production'

    const response = await POST(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'legal_unavailable' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  test('returns a no-store server-side capture decision without exposing legal copy', async () => {
    const response = await GET(new NextRequest('http://localhost/api/consent?client_id=c1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toEqual({
      hasConsent: true,
      legalState: 'current',
      captureAllowed: true,
      reason: null,
    })
    expect(mocks.getConsentStatus).toHaveBeenCalledWith(expect.anything(), 'c1')
  })

  test('does not reveal a client outside the practitioner ownership scope', async () => {
    mocks.clientResult = { data: null, error: null }

    const response = await GET(new NextRequest('http://localhost/api/consent?client_id=other'))

    expect(response.status).toBe(404)
    expect(mocks.getConsentStatus).not.toHaveBeenCalled()
  })
})
