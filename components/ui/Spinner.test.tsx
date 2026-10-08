// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Spinner } from './Spinner'

afterEach(cleanup)

describe('Spinner', () => {
  it('exposes role=status and the label when one is given', () => {
    render(<Spinner label="Loading results" />)
    const status = screen.getByRole('status', { name: 'Loading results' })
    expect(status.tagName.toLowerCase()).toBe('svg')
  })

  it('is aria-hidden when no label is given, since a parent announces busy', () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('role')).toBeNull()
  })
})
