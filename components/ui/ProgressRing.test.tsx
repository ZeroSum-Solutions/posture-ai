// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressRing } from './ProgressRing'

afterEach(cleanup)

describe('ProgressRing', () => {
  it('renders role=progressbar with aria-valuenow/min/max and the label', () => {
    render(<ProgressRing value={0.5} label="Setup checklist" />)
    const ring = screen.getByRole('progressbar', { name: 'Setup checklist' })
    expect(ring.getAttribute('aria-valuemin')).toBe('0')
    expect(ring.getAttribute('aria-valuemax')).toBe('100')
    expect(ring.getAttribute('aria-valuenow')).toBe('50')
  })

  it('never moves backward when value decreases', () => {
    const { rerender } = render(<ProgressRing value={0.7} label="Setup checklist" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('70')
    rerender(<ProgressRing value={0.2} label="Setup checklist" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('70')
  })

  it('shows a check at 100%', () => {
    render(<ProgressRing value={1} label="Setup checklist" />)
    expect(screen.getByRole('img', { name: 'Complete' })).toBeTruthy()
  })
})
