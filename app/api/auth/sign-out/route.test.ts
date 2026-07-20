import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const signOut = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { signOut } })),
}))

import { POST } from './route'

describe('POST /api/auth/sign-out', () => {
  beforeEach(() => signOut.mockReset().mockResolvedValue({ error: null }))

  const request = (site = 'same-origin') => new NextRequest(
    'https://posture.example/api/auth/sign-out',
    { method: 'POST', headers: { 'Sec-Fetch-Site': site } },
  )

  test('redirects relatively after provider signout', async () => {
    const response = await POST(request())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/auth/sign-in')
  })

  test('does not claim success when provider signout fails', async () => {
    signOut.mockResolvedValueOnce({ error: { message: 'provider unavailable' } })

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'signout_failed' })
  })

  test('rejects cross-site browser requests before touching the session', async () => {
    const response = await POST(request('cross-site'))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'cross_site_request' })
    expect(signOut).not.toHaveBeenCalled()
  })
})
