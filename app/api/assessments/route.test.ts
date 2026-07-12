import { describe, test, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { MAX_PAYLOAD_BYTES } from '@/lib/validation/frames'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({}),
  }),
  createSupabaseServiceClient: () => ({ from: () => ({}) }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))

import { POST } from './route'

// A streamed body carries no Content-Length header (routine on chunked/HTTP-2).
function streamedReq(bodyStr: string) {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(bodyStr))
      c.close()
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest('http://localhost/api/assessments', { method: 'POST', body: stream, duplex: 'half' } as any)
}

describe('POST /api/assessments payload cap', () => {
  test('rejects an oversized body with 413 even when Content-Length is absent', async () => {
    const req = streamedReq('x'.repeat(MAX_PAYLOAD_BYTES + 100))
    expect(req.headers.get('content-length')).toBeNull()
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
