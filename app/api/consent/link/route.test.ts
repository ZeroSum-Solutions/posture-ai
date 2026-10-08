import { beforeEach, describe, test, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { tokenInsert, clientArchived } = vi.hoisted(() => ({ tokenInsert: vi.fn(), clientArchived: { value: false } }))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      let checksArchive = false
      const query = {
        select: () => query,
        eq: () => query,
        is: (column: string) => { if (column === 'archived_at') checksArchive = true; return query },
        maybeSingle: async () => ({ data: clientArchived.value && checksArchive ? null : { id: 'c1' }, error: null }),
      }
      return query
    },
  }),
  createSupabaseServiceClient: () => ({
    from: () => ({ insert: tokenInsert }),
  }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))

import { POST } from './route'

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/consent/link', () => {
  beforeEach(() => {
    vi.stubEnv('POSTURE_TEST_MODE_ENABLED', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    tokenInsert.mockReset().mockResolvedValue({ error: null })
    clientArchived.value = false
  })

  test('does not mint a consent token for an archived client', async () => {
    clientArchived.value = true
    const response = await POST(new NextRequest('http://localhost/api/consent/link', {
      method: 'POST', body: JSON.stringify({ client_id: 'c1' }),
    }))

    expect(response.status).toBe(404)
    expect(tokenInsert).not.toHaveBeenCalled()
  })

  test('builds the shareable consent URL from NEXT_PUBLIC_APP_URL, never the caller Host header', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.postureai.com')
    // The request arrives with a spoofed Host — a share link for a PHI consent token
    // must not point at an attacker-controlled origin.
    const res = await POST(new NextRequest('https://evil.example.com/api/consent/link', {
      method: 'POST', body: JSON.stringify({ client_id: 'c1' }),
      headers: { 'content-type': 'application/json' },
    }))
    const body = await res.json()
    expect(body.url.startsWith('https://app.postureai.com/consent/')).toBe(true)
    expect(body.url).not.toContain('evil.example.com')
    expect(tokenInsert).toHaveBeenCalledWith(expect.objectContaining({
      legal_document_id: 'subject-consent-test-fixture-v1',
      legal_document_version: 'test-1',
      legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
      legal_document_effective_at: '2026-07-20T00:00:00.000Z',
      legal_jurisdiction: 'US',
      legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
      legal_provenance_state: 'governed',
    }))
  })

  test('fails closed before minting when production consent copy is unavailable', async () => {
    vi.stubEnv('POSTURE_TEST_MODE_ENABLED', '0')
    vi.stubEnv('VERCEL_ENV', 'production')

    const response = await POST(new NextRequest('https://app.postureai.com/api/consent/link', {
      method: 'POST',
      body: JSON.stringify({ client_id: 'c1' }),
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'legal_unavailable' })
    expect(tokenInsert).not.toHaveBeenCalled()
  })
})
