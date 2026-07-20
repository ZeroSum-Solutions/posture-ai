// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const getUser = vi.fn()
const updateUser = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getUser, updateUser } }),
}))

import AcceptInvitePage from './page'

afterEach(() => {
  cleanup()
  getUser.mockReset()
  updateUser.mockReset()
})

describe('AcceptInvitePage', () => {
  it('does not expose password setup without an authenticated invite session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    render(<AcceptInvitePage />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid, expired, or has already been used/i)
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('keeps password validation and provider failures retryable', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    updateUser.mockResolvedValue({ error: { message: 'Password service unavailable' } })
    render(<AcceptInvitePage />)

    const password = await screen.findByLabelText('Password')
    fireEvent.change(password, { target: { value: 'TestPass1234!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'TestPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: /continue to multi-factor setup/i }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'TestPass1234!' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Password service unavailable')
    expect((screen.getByRole('button', { name: /continue to multi-factor setup/i }) as HTMLButtonElement).disabled).toBe(false)
  })
})
