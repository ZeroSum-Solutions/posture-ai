// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const getUser = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const listFactors = vi.fn()
const unenroll = vi.fn()
const enroll = vi.fn()
const challengeAndVerify = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUser,
      mfa: { getAuthenticatorAssuranceLevel, listFactors, unenroll, enroll, challengeAndVerify },
    },
  }),
}))

import MfaPage, { completionMessage } from './page'

describe('MfaPage', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    })
    listFactors.mockReset()
    unenroll.mockReset().mockResolvedValue({ error: null })
    enroll.mockReset().mockResolvedValue({
      data: { id: 'new-factor', totp: { qr_code: 'data:image/svg+xml,test' } },
      error: null,
    })
    challengeAndVerify.mockReset()
    vi.stubGlobal('fetch', vi.fn())
    window.history.replaceState({}, '', '/auth/mfa')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('removes abandoned unverified factors before starting one enrollment', async () => {
    listFactors.mockResolvedValue({
      data: { all: [{ id: 'stale', factor_type: 'totp', status: 'unverified' }] },
      error: null,
    })

    render(<MfaPage />)

    expect(await screen.findByAltText(/QR code for Posture AI/i)).toBeTruthy()
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'stale' })
    expect(enroll).toHaveBeenCalledTimes(1)
  })

  it('keeps a bad authenticator code retryable without re-enrolling', async () => {
    listFactors.mockResolvedValue({
      data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] },
      error: null,
    })
    challengeAndVerify.mockResolvedValue({ error: { message: 'bad code' } })

    render(<MfaPage />)
    const input = await screen.findByLabelText('Authenticator code')
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))

    await waitFor(() => expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'verified', code: '123456' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not accepted/i)
    expect(enroll).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: /verify and continue/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('explains that recovery cannot bypass an existing factor', async () => {
    window.history.replaceState({}, '', '/auth/mfa?mode=recovery')
    listFactors.mockResolvedValue({
      data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] },
      error: null,
    })

    render(<MfaPage />)

    expect((await screen.findByText(/Password recovery does not bypass MFA/i)).textContent).toMatch(/contact your beta administrator/i)
  })
})

describe('completionMessage', () => {
  it('provides explicit recovery and revocation guidance', () => {
    expect(completionMessage('recovery_not_authorized')).toMatch(/not been authorized/i)
    expect(completionMessage('revoked')).toMatch(/revoked/i)
    expect(completionMessage('expired')).toMatch(/replacement invitation/i)
  })
})
