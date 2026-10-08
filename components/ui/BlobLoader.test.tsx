// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlobLoader } from './BlobLoader'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('BlobLoader', () => {
  it('announces the label as a live status region', () => {
    render(<BlobLoader label="Analyzing posture" />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('Analyzing posture')
    expect(status.getAttribute('aria-busy')).toBe('true')
  })

  it('cross-fades through steps on an interval', () => {
    render(<BlobLoader label="Analyzing posture" steps={['Reading front view', 'Reading back view']} />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Analyzing posture: Reading front view')

    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Analyzing posture: Reading back view')
  })

  it('renders a ProgressBar when progress is given', () => {
    render(<BlobLoader label="Analyzing posture" progress={0.4} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
  })
})

describe('BlobLoader steps ticker', () => {
  it('marks exactly one step as current and advances it', () => {
    const { container } = render(<BlobLoader label="Analyzing posture" steps={['A', 'B', 'C']} />)
    const now = () => Array.from(container.querySelectorAll('[data-pos="now"]')).map((n) => n.textContent)
    expect(now()).toEqual(['A'])
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(now()).toEqual(['B'])
    expect(container.querySelector('[data-pos="past"]')?.textContent).toBe('A')
  })
})
