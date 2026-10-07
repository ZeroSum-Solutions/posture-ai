// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

afterEach(cleanup)

describe('Button', () => {
  it.each(['primary', 'secondary', 'tertiary', 'danger'] as const)('renders the %s variant', (variant) => {
    render(<Button variant={variant}>Continue</Button>)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('sets aria-busy and ignores clicks while loading', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-busy')).toBe('true')

    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('sets aria-disabled and aria-describedby when a disabledReason is given, and swallows the click', () => {
    const onClick = vi.fn()
    render(<Button disabledReason="Choose a client to continue" onClick={onClick}>Continue</Button>)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-disabled')).toBe('true')

    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Choose a client to continue')

    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders a next/link when href is given', () => {
    render(<Button href="/clients">Go to clients</Button>)
    const link = screen.getByRole('link', { name: 'Go to clients' })
    expect(link.getAttribute('href')).toBe('/clients')
  })

  it('fires onClick normally when neither loading nor blocked', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} haptic={false}>Start scan</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
