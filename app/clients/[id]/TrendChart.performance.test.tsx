// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrendChart from './TrendChart'
import type { TrendInputPoint } from './trendModel'

function history(count = 20): TrendInputPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `assessment-${index}`,
    assessedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    score: 60 - index,
    grade: 'C',
    scoringEngineVersion: '2.1.0',
    segmentId: 'engine-2.1.0',
  }))
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TrendChart recorded-score disclosure', () => {
  it('presents the disclosure before mounting its table work', () => {
    vi.useFakeTimers()
    render(<TrendChart history={history()} tableId="client-score-table" />)

    expect(document.getElementById('client-score-table')).toBeNull()

    fireEvent.click(screen.getByText('Recorded scores'))

    expect(document.getElementById('client-score-table')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Preparing recorded scores')

    act(() => vi.advanceTimersByTime(299))
    expect(document.getElementById('client-score-table')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(document.getElementById('client-score-table')).not.toBeNull()
  })

  it('retains the table after its first deferred mount', () => {
    vi.useFakeTimers()
    render(<TrendChart history={history(2)} tableId="client-score-table" />)

    const summary = screen.getByText('Recorded scores')
    fireEvent.click(summary)
    act(() => vi.advanceTimersByTime(300))
    const table = document.getElementById('client-score-table')
    expect(table).not.toBeNull()

    fireEvent.click(summary)
    fireEvent.click(summary)

    expect(document.getElementById('client-score-table')).toBe(table)
  })
})
