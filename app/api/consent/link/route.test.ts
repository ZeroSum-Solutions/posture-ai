import { describe, test, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: 'c1' }, error: null }) }) }) }) }),
    }),
  }),
  createSupabaseServiceClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))

import { POST } from './route'

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/consent/link', () => {
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
  })
})
