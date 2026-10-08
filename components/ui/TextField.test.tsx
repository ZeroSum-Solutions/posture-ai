// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TextField } from './TextField'

afterEach(cleanup)

describe('TextField', () => {
  it('associates the visible label with the control', () => {
    render(<TextField label="Client name" />)
    const input = screen.getByLabelText('Client name')
    expect(input.tagName).toBe('INPUT')
  })

  it('shows "Required" in the label row when required', () => {
    render(<TextField label="Client name" required />)
    expect(screen.getByText('Required')).toBeTruthy()
  })

  it('sets aria-invalid and aria-describedby pointing at the error message', () => {
    render(<TextField label="Email" error="Enter a valid email" />)
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBe('true')

    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toContain('Enter a valid email')
  })

  it('associates a hint when there is no error', () => {
    render(<TextField label="Weight" hint="In kilograms" />)
    const input = screen.getByLabelText('Weight')
    const describedBy = input.getAttribute('aria-describedby')
    expect(document.getElementById(describedBy!)?.textContent).toBe('In kilograms')
  })
})
