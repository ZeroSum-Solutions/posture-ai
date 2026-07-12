// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SignUpPage from './page'

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signUp: async () => ({ error: null }) } }),
}))

afterEach(cleanup)

describe('SignUpPage accessibility', () => {
  it('gives the Email and Password inputs a programmatic accessible name', () => {
    render(<SignUpPage />)
    // getByLabelText resolves only when label↔input are associated (htmlFor/id,
    // aria-label, or wrapping). On the one page an unauthenticated user must enter
    // credentials, both fields must be reachable by their name.
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })
})
