import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  row: {
    external_deletion_status: 'pending', storage_objects_enqueued: 2,
    storage_objects_deleted: 1, completed_at: null,
  } as Record<string, unknown> | null,
  error: null as { message: string } | null,
}))

function query() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: state.row, error: state.error }),
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  createSupabaseServiceClient: () => ({ from: query }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))

import { POST } from './route'

const receiptId = '30000000-0000-4000-8000-000000000001'
function request(receipt_id = receiptId) {
  return new NextRequest('http://localhost/api/privacy/erasure-status', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receipt_id }),
  })
}

describe('POST /api/privacy/erasure-status', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.row = {
      external_deletion_status: 'pending', storage_objects_enqueued: 2,
      storage_objects_deleted: 1, completed_at: null,
    }
    state.error = null
  })

  test('returns only controlled progress for an owned receipt', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      external_deletion_status: 'pending', storage_objects_enqueued: 2,
      storage_objects_deleted: 1, completed_at: null,
    })
  })

  test('does not disclose a missing or other-practitioner receipt', async () => {
    state.row = null
    const response = await POST(request())
    expect(response.status).toBe(404)
  })

  test('denies unauthenticated polling', async () => {
    state.user = null
    expect((await POST(request())).status).toBe(401)
  })

  test('rejects malformed receipt identifiers before lookup', async () => {
    expect((await POST(request('not-a-receipt'))).status).toBe(422)
  })
})
