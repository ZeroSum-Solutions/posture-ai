// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SeverityChip } from './SeverityChip'

afterEach(cleanup)

describe('SeverityChip', () => {
  it('renders the band word and an icon for maintain', () => {
    render(<SeverityChip band="maintain" />)
    expect(screen.getByText('Maintain')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })

  it('renders the band word and an icon for monitor', () => {
    render(<SeverityChip band="monitor" />)
    expect(screen.getByText('Monitor')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })

  it('renders the band word and an icon for review', () => {
    render(<SeverityChip band="review" />)
    expect(screen.getByText('Review')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })

  it('renders the band word and an icon for neutral', () => {
    render(<SeverityChip band="neutral" />)
    expect(screen.getByText('Not scored')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })

  it('lets a caller override the word without dropping the band icon', () => {
    render(<SeverityChip band="review" label="Flagged" />)
    expect(screen.getByText('Flagged')).toBeTruthy()
    expect(screen.queryByText('Review')).toBeNull()
  })
})
