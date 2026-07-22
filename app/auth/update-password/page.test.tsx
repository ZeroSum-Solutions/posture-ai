// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const getUser = vi.fn()
const updateUser = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getUser, updateUser } }),
}))

import UpdatePasswordPage from './page'

afterEach(() => {
  cleanup()
  getUser.mockReset()
  updateUser.mockReset()
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
    updateUser.mockResolvedValue({ error: { message: 'Reset temporarily unavailable' } })
    render(<UpdatePasswordPage />)

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'TestPass1234!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'TestPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'TestPass1234!' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Reset temporarily unavailable')
  })
})
