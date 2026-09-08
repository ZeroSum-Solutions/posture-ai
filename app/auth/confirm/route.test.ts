import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyOtp = vi.fn()
const maybeSingle = vi.fn()
const rpc = vi.fn(() => ({ maybeSingle }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    options.cookies.setAll([
      { name: 'sb-session', value: 'rotated', options: { httpOnly: true, path: '/' } },
    ])
    return { auth: { verifyOtp }, rpc }
  }),
}))

import { GET } from './route'

describe('GET /auth/confirm', () => {
  beforeEach(() => {
    verifyOtp.mockReset()
    verifyOtp.mockResolvedValue({ error: null })
    rpc.mockClear()
    maybeSingle.mockReset().mockResolvedValue({ data: { actor_kind: 'practitioner' }, error: null })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  })

  test('requires a token hash', async () => {
    const response = await GET(new NextRequest('http://localhost/auth/confirm'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/auth/sign-in?reason=invite_invalid')
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  test('verifies only the invite OTP and preserves established session cookies', async () => {
    const response = await GET(new NextRequest('http://localhost/auth/confirm?token_hash=secret'))

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'secret' })
    expect(response.headers.get('location')).toBe('/auth/accept-invite')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
    expect(rpc).toHaveBeenCalledWith('current_application_actor')
  })

  test('routes an athlete invite to the athlete setup corridor', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { actor_kind: 'athlete' }, error: null })
    const response = await GET(new NextRequest('http://localhost/auth/confirm?token_hash=athlete'))
    expect(response.headers.get('location')).toBe('/train/accept-invite')
  })

  test('fails closed when the provisioned account has conflicting application roles', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { actor_kind: 'ambiguous' }, error: null })
    const response = await GET(new NextRequest('http://localhost/auth/confirm?token_hash=ambiguous'))
    expect(response.headers.get('location')).toBe('/auth/sign-in?reason=invite_invalid')
  })

  test('fails closed on an invalid or consumed invitation', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'expired' } })

    const response = await GET(new NextRequest('http://localhost/auth/confirm?token_hash=bad'))

    expect(response.headers.get('location')).toBe('/auth/sign-in?reason=invite_invalid')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
  })

  test('verifies a recovery OTP and keeps the redirect on the request host', async () => {
    const response = await GET(new NextRequest(
      'http://attacker-controlled.example/auth/confirm?token_hash=recovery-secret&type=recovery',
    ))

    expect(verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'recovery-secret',
    })
    expect(response.headers.get('location')).toBe('/auth/update-password')
    expect(response.headers.get('location')).not.toContain('attacker-controlled.example')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
    expect(rpc).not.toHaveBeenCalled()
  })
})
