// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SignUpPage from './page'

afterEach(cleanup)

describe('SignUpPage invitation-only boundary', () => {
  it('explains invitation-only access without exposing public account creation', () => {
    render(<SignUpPage />)

    expect(screen.getByRole('heading', { name: 'Practitioner access is invitation-only' })).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull()
    expect(screen.getByRole('link', { name: /already accepted an invitation/i }).getAttribute('href')).toBe('/auth/sign-in')
  })
})
