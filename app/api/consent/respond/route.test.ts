import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { maybeSingle, rpc, strictRateLimit } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  strictRateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      expect(table).toBe('consent_tokens')
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle,
      }
      return query
    },
    rpc,
  }),
}))
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: async () => true,
  enforceRateLimitStrict: strictRateLimit,
}))

import { POST } from './route'

const evidence = {
  legal_document_id: 'subject-consent-test-fixture-v1',
  legal_document_version: 'test-1',
  legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
}

const governedToken = {
  ...evidence,
  legal_document_effective_at: '2026-07-20T00:00:00+00:00',
  legal_jurisdiction: 'US',
  legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
  legal_provenance_state: 'governed',
  created_at: '2026-07-20T01:00:00.000Z',
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/consent/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: 'a'.repeat(43),
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      ...evidence,
      ...overrides,
    }),
  })
}

describe('POST /api/consent/respond governed remote consent', () => {
  beforeEach(() => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
    maybeSingle.mockReset().mockResolvedValue({ data: governedToken, error: null })
    rpc.mockReset().mockResolvedValue({ data: 'ok', error: null })
    strictRateLimit.mockReset().mockResolvedValue(true)
  })

  test('fails closed when the public-token limiter is unavailable', async () => {
    strictRateLimit.mockResolvedValueOnce(false)

    const response = await POST(request())

    expect(response.status).toBe(429)
    expect(strictRateLimit).toHaveBeenCalledOnce()
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  test('hashes the token-pinned snapshot and invokes the governed RPC', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_remote_consent_governed', expect.objectContaining({
      p_presented_document_id: evidence.legal_document_id,
      p_presented_document_version: evidence.legal_document_version,
      p_presented_document_body_sha256: evidence.legal_document_body_sha256,
      p_signer_name: 'Morgan Example',
      p_consent_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
  })

  test('rejects forged browser evidence before consuming the token', async () => {
    const response = await POST(request({ legal_document_body_sha256: '0'.repeat(64) }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'superseded' })
    expect(rpc).not.toHaveBeenCalled()
  })

  test('rejects a legacy or tampered token before recording consent', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { ...governedToken, legal_provenance_state: 'legacy_unverified' },
      error: null,
    })

    const response = await POST(request())

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ code: 'superseded' })
    expect(rpc).not.toHaveBeenCalled()
  })

  test('maps governed RPC document mismatch to superseded', async () => {
    rpc.mockResolvedValueOnce({ data: 'document_mismatch', error: null })

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'superseded' })
  })
})
