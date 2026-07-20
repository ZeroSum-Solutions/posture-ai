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

const request = new Request('http://localhost/api/reports/r1/download')
const context = { params: Promise.resolve({ id: 'r1' }) }

describe('GET /api/reports/[id]/download', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    gate.mockReset().mockResolvedValue(null)
    maybeSingle.mockReset().mockResolvedValue({
      data: { storage_path: 'u1/a1/report.pdf' },
      error: null,
    })
    download.mockReset().mockResolvedValue({
      data: new Blob(['%PDF-test'], { type: 'application/pdf' }),
      error: null,
    })
  })

  test('fails before storage access when practitioner admission is denied', async () => {
    gate.mockResolvedValueOnce(
      NextResponse.json({ code: 'mfa_required' }, { status: 403 }),
    )

    const response = await GET(request, context)

    expect(response.status).toBe(403)
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  test('does not disclose a report outside the practitioner scope', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await GET(request, context)

    expect(response.status).toBe(404)
    expect(download).not.toHaveBeenCalled()
  })

  test('streams an owned PDF through the live admission boundary', async () => {
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toContain('posture-report.pdf')
    expect(await response.text()).toBe('%PDF-test')
  })
})
