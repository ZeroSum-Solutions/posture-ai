// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Readout } from './Readout'

afterEach(cleanup)

describe('Readout', () => {
  it('is one role="img" with a sentence aria-label carrying label, value and band', () => {
    render(
      <Readout
        label="Shoulder imbalance"
        value={47.2}
        unit="°"
        reference={{ min: 53, text: '≥ 53°' }}
        band="monitor"
      />,
    )
    const img = screen.getByRole('img')
    const label = img.getAttribute('aria-label') ?? ''
    expect(label).toContain('Shoulder imbalance')
    expect(label).toContain('47.2')
    expect(label).toContain('Monitor')
  })

  it('shows "No reference yet" with an info icon when there is no reference', () => {
    render(<Readout label="Hip tilt" value={12} band="neutral" />)
    expect(screen.getByText('No reference yet')).toBeTruthy()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toContain('no reference yet')
  })
})
