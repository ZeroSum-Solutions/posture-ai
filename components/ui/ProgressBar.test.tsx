// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressBar } from './ProgressBar'

afterEach(cleanup)

describe('ProgressBar', () => {
  it('renders role=progressbar with aria-valuenow/min/max and the label', () => {
    render(<ProgressBar value={0.5} label="Processing 2 of 4 views" />)
    const bar = screen.getByRole('progressbar', { name: 'Processing 2 of 4 views' })
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
  })

  it('never moves backward when value decreases', () => {
    const { rerender } = render(<ProgressBar value={0.6} label="Progress" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60')

    rerender(<ProgressBar value={0.3} label="Progress" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60')

    rerender(<ProgressBar value={0.9} label="Progress" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90')

    rerender(<ProgressBar value={0.1} label="Progress" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90')
  })

  it('clamps out-of-range values into 0..100', () => {
    render(<ProgressBar value={1.4} label="Progress" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })
})
