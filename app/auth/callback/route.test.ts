import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const exchangeCodeForSession = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: vi.fn() })),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: { exchangeCodeForSession } })),
}))

import { GET } from './route'

describe('GET /auth/callback', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  })

  test('uses a relative safe redirect after a valid exchange', async () => {
    const response = await GET(new NextRequest(
      'http://untrusted-host.example/auth/callback?code=valid&next=/dashboard',
    ))

    expect(exchangeCodeForSession).toHaveBeenCalledWith('valid')
    expect(response.headers.get('location')).toBe('/dashboard')
  })

  test('fails on a relative sign-in path without reflecting the request host', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: { message: 'bad code' } })

    const response = await GET(new NextRequest(
      'http://untrusted-host.example/auth/callback?code=bad&next=//evil.example',
    ))

    expect(response.headers.get('location')).toBe('/auth/sign-in?error=callback_failed')
  })
})
