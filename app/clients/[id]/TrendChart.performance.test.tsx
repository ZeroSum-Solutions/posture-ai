// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
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
  it('renders a true compact sparkline while keeping the current score in readable text', () => {
    const { container } = render(<TrendChart history={history(2)} tableId="client-score-table" />)

    expect(screen.getByLabelText('Latest deviation score 59 out of 100')).toBeTruthy()
    const drawing = container.querySelector('svg[viewBox="0 0 330 60"]')
    expect(drawing?.getAttribute('viewBox')).toBe('0 0 330 60')
    expect(drawing?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(drawing?.querySelectorAll('text')).toHaveLength(0)
  })

  it('keeps its server-rendered control inert until the pointer guard is installed', () => {
    const markup = renderToString(<TrendChart history={history(2)} tableId="client-score-table" />)

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-label="Preparing score details…"')
    expect(markup).toContain('>Preparing score details…</button>')
  })

  it('uses a button disclosure with explicit expanded state', () => {
    render(<TrendChart history={history(2)} tableId="client-score-table" />)

    const disclosure = screen.getByRole('button', { name: 'Score details' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.hasAttribute('disabled')).toBe(false)
    expect(disclosure.getAttribute('aria-busy')).toBe('false')
    expect(disclosure.getAttribute('aria-label')).toBe('Score details')
    expect(disclosure.textContent).toBe('Score details')
    expect(disclosure.getAttribute('aria-controls')).toBe('client-score-table-panel')
    expect(document.getElementById('client-score-table-panel')).not.toBeNull()

    disclosure.focus()
    expect(document.activeElement).toBe(disclosure)

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
  })

  it('suppresses mouse focus work without blocking touch or keyboard focus', () => {
    render(<TrendChart history={history(2)} tableId="client-score-table" />)

    const disclosure = screen.getByRole('button', { name: 'Score details' })
    const mousePress = createEvent.pointerDown(disclosure)
    Object.defineProperties(mousePress, {
      pointerType: { value: 'mouse' },
      button: { value: 0 },
      isPrimary: { value: true },
    })
    expect(fireEvent(disclosure, mousePress)).toBe(false)

    const touchPress = createEvent.pointerDown(disclosure)
    Object.defineProperties(touchPress, {
      pointerType: { value: 'touch' },
      button: { value: 0 },
      isPrimary: { value: true },
    })
    expect(fireEvent(disclosure, touchPress)).toBe(true)

    const penPress = createEvent.pointerDown(disclosure)
    Object.defineProperties(penPress, {
      pointerType: { value: 'pen' },
      button: { value: 0 },
      isPrimary: { value: true },
    })
    expect(fireEvent(disclosure, penPress)).toBe(true)

    const secondaryMousePress = createEvent.pointerDown(disclosure)
    Object.defineProperties(secondaryMousePress, {
      pointerType: { value: 'mouse' },
      button: { value: 2 },
      isPrimary: { value: true },
    })
    expect(fireEvent(disclosure, secondaryMousePress)).toBe(true)

    const nonPrimaryMousePress = createEvent.pointerDown(disclosure)
    Object.defineProperties(nonPrimaryMousePress, {
      pointerType: { value: 'mouse' },
      button: { value: 0 },
      isPrimary: { value: false },
    })
    expect(fireEvent(disclosure, nonPrimaryMousePress)).toBe(true)

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')

    disclosure.focus()
    expect(document.activeElement).toBe(disclosure)
  })

  it('presents the disclosure before mounting its table work', () => {
    vi.useFakeTimers()
    render(<TrendChart history={history()} tableId="client-score-table" />)

    expect(document.getElementById('client-score-table')).toBeNull()

    fireEvent.click(screen.getByText('Score details'))

    expect(document.getElementById('client-score-table')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Preparing score details')

    act(() => vi.advanceTimersByTime(299))
    expect(document.getElementById('client-score-table')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(document.getElementById('client-score-table')).not.toBeNull()
  })

  it('retains the table after its first deferred mount', () => {
    vi.useFakeTimers()
    render(<TrendChart history={history(2)} tableId="client-score-table" />)

    const summary = screen.getByText('Score details')
    fireEvent.click(summary)
    act(() => vi.advanceTimersByTime(300))
    const table = document.getElementById('client-score-table')
    expect(table).not.toBeNull()

    fireEvent.click(summary)
    fireEvent.click(summary)

    expect(document.getElementById('client-score-table')).toBe(table)
  })
})
