// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IconButton } from './IconButton'

afterEach(cleanup)

describe('IconButton', () => {
  it('requires a label and exposes it as aria-label', () => {
    render(<IconButton icon="alt-arrow-left-linear" label="Back to Clients" />)
    const button = screen.getByRole('button', { name: 'Back to Clients' })
    expect(button.getAttribute('aria-label')).toBe('Back to Clients')
  })

  it('renders a numeric badge', () => {
    render(<IconButton icon="bell-linear" label="Notifications" badge={3} />)
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('swallows the click and marks aria-disabled when a disabledReason is set', () => {
    const onClick = vi.fn()
    render(<IconButton icon="pen-linear" label="Edit" disabledReason="Finish the current step first" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
