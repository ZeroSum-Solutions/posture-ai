import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { getUser, gate, maybeSingle, download } = vi.hoisted(() => ({
  getUser: vi.fn(),
  gate: vi.fn(),
  maybeSingle: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: gate }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
  createSupabaseServiceClient: () => ({
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle }
      return query
    },
    storage: { from: () => ({ download }) },
  }),
}))

import { GET } from './route'

const request = new Request('http://localhost/api/captures/c1/image')
const context = { params: Promise.resolve({ id: 'c1' }) }

describe('GET /api/captures/[id]/image', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    gate.mockReset().mockResolvedValue(null)
    maybeSingle.mockReset().mockResolvedValue({
      data: { storage_path: 'u1/a1/front.jpg' },
      error: null,
    })
    download.mockReset().mockResolvedValue({
      data: new Blob(['image-bytes'], { type: 'image/jpeg' }),
      error: null,
    })
  })

  test('fails before storage access when practitioner admission is denied', async () => {
    gate.mockResolvedValueOnce(
      NextResponse.json({ code: 'practitioner_access_required' }, { status: 403 }),
    )

    const response = await GET(request, context)

    expect(response.status).toBe(403)
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  test('does not disclose a capture outside the admitted practitioner scope', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await GET(request, context)

    expect(response.status).toBe(404)
    expect(download).not.toHaveBeenCalled()
  })

  test('streams an owned image without a reusable storage capability', async () => {
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('image-bytes')
  })
})
