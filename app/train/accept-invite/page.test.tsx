// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const getUser = vi.fn()
const updateUser = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getUser, updateUser } }),
}))

import AthleteAcceptInvitePage from './page'

describe('AthleteAcceptInvitePage', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'athlete' } }, error: null })
    updateUser.mockReset().mockResolvedValue({ error: { message: 'stop before redirect' } })
  })

  afterEach(() => cleanup())

  it('requires a real authenticated invite session', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    render(<AthleteAcceptInvitePage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid, expired, or has already been used/i)
  })

  it('sets the password then continues to the athlete-specific MFA mode', async () => {
    render(<AthleteAcceptInvitePage />)
    const password = await screen.findByLabelText('Password')
    const confirm = screen.getByLabelText('Confirm password')
    fireEvent.change(password, { target: { value: 'correct horse battery staple' } })
    fireEvent.change(confirm, { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: /continue to multi-factor setup/i }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'correct horse battery staple' }))
  })
})
