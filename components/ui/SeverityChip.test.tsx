// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SeverityChip } from './SeverityChip'

afterEach(cleanup)

describe('SeverityChip', () => {
  it('renders the band word and its bead count for maintain', () => {
    render(<SeverityChip band="maintain" />)
    const FILLED = 1
    expect(screen.getByText('Maintain')).toBeTruthy()
    expect(document.querySelectorAll('[data-on]').length).toBe(FILLED)
  })

  it('renders the band word and its bead count for monitor', () => {
    render(<SeverityChip band="monitor" />)
    const FILLED = 2
    expect(screen.getByText('Monitor')).toBeTruthy()
    expect(document.querySelectorAll('[data-on]').length).toBe(FILLED)
  })

  it('renders the band word and its bead count for review', () => {
    render(<SeverityChip band="review" />)
    const FILLED = 3
    expect(screen.getByText('Review')).toBeTruthy()
    expect(document.querySelectorAll('[data-on]').length).toBe(FILLED)
  })

  it('renders the band word and its bead count for neutral', () => {
    render(<SeverityChip band="neutral" />)
    const FILLED = 0
    expect(screen.getByText('Not scored')).toBeTruthy()
    expect(document.querySelectorAll('[data-on]').length).toBe(FILLED)
  })

  it('lets a caller override the word and keeps the band beads', () => {
    render(<SeverityChip band="review" label="Flagged" />)
    expect(screen.getByText('Flagged')).toBeTruthy()
    expect(screen.queryByText('Review')).toBeNull()
  })
})
