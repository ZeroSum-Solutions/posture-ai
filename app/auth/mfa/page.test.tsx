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

import MfaPage from './page'
import { completionMessage } from './mfa-format'

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
      data: {
        id: 'new-factor',
        totp: {
          qr_code: 'data:image/svg+xml,test',
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Posture%20AI:u1?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Posture%20AI',
        },
      },
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

  // The QR alone is unusable when this page and the authenticator app are on the
  // same phone: nothing can photograph its own screen. These two cover the paths
  // that do work there.
  it('offers an otpauth deep link so the authenticator can be enrolled on this device', async () => {
    listFactors.mockResolvedValue({ data: { all: [] }, error: null })

    render(<MfaPage />)

    const link = await screen.findByRole('link', { name: /open in your authenticator app/i })
    expect(link.getAttribute('href')).toMatch(/^otpauth:\/\/totp\//)
    expect(link.getAttribute('href')).toContain('secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')
  })

  it('shows the setup key for manual entry and copies it unspaced', async () => {
    listFactors.mockResolvedValue({ data: { all: [] }, error: null })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<MfaPage />)

    // Grouped for hand-typing, but the clipboard must receive what the app expects.
    expect((await screen.findByText(/JBSW Y3DP/)).textContent).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    fireEvent.click(screen.getByRole('button', { name: /copy setup key/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'))
  })

  it('keeps the QR available but behind a disclosure for other-device setup', async () => {
    listFactors.mockResolvedValue({ data: { all: [] }, error: null })

    render(<MfaPage />)

    const qr = await screen.findByAltText(/QR code for Posture AI/i)
    const disclosure = qr.closest('details')
    expect(disclosure).toBeTruthy()
    expect(disclosure!.open).toBe(false)
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

  it('focuses the code field so the only action on the page needs no hunting', async () => {
    listFactors.mockResolvedValue({
      data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] },
      error: null,
    })

    render(<MfaPage />)

    const input = await screen.findByLabelText('Authenticator code')
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  // maxLength is 7 rather than 6 on purpose: authenticators display the code
  // grouped as "123 456", and handleVerify strips whitespace before validating
  // /^\d{6}$/. Narrowing the attribute to 6 truncates a pasted grouped code to
  // "123 45" and silently breaks the paste path, so this pins the intent.
  it('accepts a space-separated code as pasted from an authenticator', async () => {
    listFactors.mockResolvedValue({
      data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] },
      error: null,
    })
    challengeAndVerify.mockResolvedValue({ error: { message: 'bad code' } })

    render(<MfaPage />)
    const input = await screen.findByLabelText('Authenticator code')
    expect(input.getAttribute('maxlength')).toBe('7')

    fireEvent.change(input, { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))

    await waitFor(() => expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'verified', code: '123456' }))
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
