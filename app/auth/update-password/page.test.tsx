// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const getUser = vi.fn()
const updateUser = vi.fn()
const listFactors = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const hardNavigate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: {
    getUser,
    updateUser,
    mfa: { listFactors, getAuthenticatorAssuranceLevel },
  } }),
}))
vi.mock('@/lib/auth/safe-next', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/safe-next')>(),
  hardNavigate,
}))

import UpdatePasswordPage from './page'

afterEach(() => {
  cleanup()
  getUser.mockReset()
  updateUser.mockReset()
  listFactors.mockReset()
  getAuthenticatorAssuranceLevel.mockReset()
  hardNavigate.mockReset()
})

describe('UpdatePasswordPage recovery boundary', () => {
  it('validates the recovery user rather than trusting a local session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    render(<UpdatePasswordPage />)

    expect((await screen.findByText(/reset link is invalid or has expired/i)).textContent).toBeTruthy()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('keeps a provider password failure retryable', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: { all: [] }, error: null })
    updateUser.mockResolvedValue({ error: { message: 'Reset temporarily unavailable' } })
    render(<UpdatePasswordPage />)

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'TestPass1234!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'TestPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'TestPass1234!' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not update your password')
    expect(screen.getByRole('button', { name: 'Update password' })).toBeTruthy()
  })

  it('requires TOTP before showing the password form for a verified-factor recovery session', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] }, error: null })
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null })

    render(<UpdatePasswordPage />)

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/auth/mfa?mode=recovery&next=/auth/update-password'))
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('shows a security error and blocks password updates when factor lookup fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: null, error: { message: 'factor lookup failed' } })

    render(<UpdatePasswordPage />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not verify your account security/i)
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('shows a security error and blocks password updates when assurance lookup fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] }, error: null })
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { message: 'assurance lookup failed' } })

    render(<UpdatePasswordPage />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not verify your account security/i)
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('updates the password after TOTP has raised the recovery session to AAL2', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: { all: [{ id: 'verified', factor_type: 'totp', status: 'verified' }] }, error: null })
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null })
    updateUser.mockResolvedValue({ error: null })

    render(<UpdatePasswordPage />)
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'TestPass1234!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'TestPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'TestPass1234!' }))
    expect(hardNavigate).toHaveBeenCalledWith('/auth/mfa?mode=recovery&next=/dashboard')
  })

  it('keeps the non-MFA password reset path available', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: { all: [] }, error: null })
    updateUser.mockResolvedValue({ error: null })

    render(<UpdatePasswordPage />)
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'TestPass1234!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'TestPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'TestPass1234!' }))
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(hardNavigate).toHaveBeenCalledWith('/auth/mfa?mode=recovery&next=/dashboard')
  })

  it('never displays the raw AAL2 provider error', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    listFactors.mockResolvedValue({ data: { all: [] }, error: null })
    updateUser.mockResolvedValue({ error: { message: 'AAL2 session is required to update email or password when MFA is enabled.' } })

    render(<UpdatePasswordPage />)
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'TestPass1234!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'TestPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/verify your authenticator/i)
    expect(alert.textContent).not.toMatch(/AAL2|update email or password/i)
  })
})
