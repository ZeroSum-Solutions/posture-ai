// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Barbell } from './Barbell'
import { FilterTiles } from './FilterTiles'
import { FindingMatrix } from './FindingMatrix'
import { FindingReadout } from './FindingReadout'
import { ScoreScale, scoreBand } from './ScoreScale'
import { TrendPlot } from './TrendPlot'

afterEach(cleanup)

describe('scoreBand', () => {
  it('folds engine grades into the three screening bands', () => {
    expect(scoreBand(0)).toBe('maintain')
    expect(scoreBand(20)).toBe('maintain')
    expect(scoreBand(21)).toBe('monitor')
    expect(scoreBand(55)).toBe('monitor')
    expect(scoreBand(56)).toBe('review')
  })
})

describe('ScoreScale', () => {
  it('prints the value, the band word and the cutoffs in its accessible description', () => {
    render(<ScoreScale score={22} previous={{ score: 31, date: '14 Aug' }} />)
    expect(screen.getByText('Monitor')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Maintain 0–20')
    expect(screen.getByText(/was/).textContent).toContain('31')
  })
})

describe('FilterTiles', () => {
  it('selects a band, clears it on a second tap, and disables empty bands', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<FilterTiles counts={{ review: 0, monitor: 4, maintain: 5 }} selected={null} onSelect={onSelect} />)
    expect((screen.getByRole('button', { name: /Review/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Monitor/ }))
    expect(onSelect).toHaveBeenLastCalledWith('monitor')
    rerender(<FilterTiles counts={{ review: 0, monitor: 4, maintain: 5 }} selected="monitor" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: /Monitor/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Monitor/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })
})

describe('FindingReadout', () => {
  it('shows value, unit, band and the previous reading as text', () => {
    render(<FindingReadout name="Forward head posture" value={14.2} unit="°" band="monitor" scale={{ warn: 10, danger: 20 }} previous={{ value: 16.1, date: '14 Aug' }} />)
    expect(screen.getByText('Forward head posture')).toBeTruthy()
    expect(screen.getByText('Monitor')).toBeTruthy()
    expect(screen.getByText(/was 16/)).toBeTruthy()
  })
  it('says when there is no reliable reading', () => {
    render(<FindingReadout name="Pelvic rotation" value={null} unit="°" band="neutral" />)
    expect(screen.getByText('No reliable reading')).toBeTruthy()
  })
})

describe('TrendPlot', () => {
  const points = [
    { id: 'a', date: '2026-05-02', score: 48 },
    { id: 'b', date: '2026-06-10', score: 41, flag: 'Camera level not verified' },
    { id: 'c', date: '2026-09-07', score: 22 },
  ]
  it('selects the latest scan and steps with Previous/Next', () => {
    const onSelect = vi.fn()
    render(<TrendPlot points={points} onSelect={onSelect} />)
    expect(screen.getByText('3 of 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous scan' }))
    expect(onSelect).toHaveBeenLastCalledWith(points[1], 1)
    expect(screen.getByText(/Camera level not verified/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next scan' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('describes every point in its accessible label', () => {
    render(<TrendPlot points={points} />)
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('48')
    expect(label).toContain('22')
  })
})

describe('FindingMatrix', () => {
  it('renders a cell button per result and a dash for no result', () => {
    const onCell = vi.fn()
    render(
      <FindingMatrix
        findings={[{ key: 'f', name: 'Forward head' }]}
        scans={[{ id: 'x', label: '7 Sep' }, { id: 'y', label: '14 Aug' }]}
        cells={{ f: { x: { band: 'monitor' }, y: null } }}
        onCell={onCell}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Forward head, 7 Sep: Monitor' }))
    expect(onCell).toHaveBeenCalledWith('f', 'x')
    expect(screen.getByLabelText('No result')).toBeTruthy()
  })
})

describe('Barbell', () => {
  it('prints both sides for each pair', () => {
    render(<Barbell rows={[{ key: 'k', name: 'Knee alignment', left: 5, right: 2.5, unit: '%' }]} />)
    expect(screen.getByText('L 5.0% · R 2.5%')).toBeTruthy()
  })
})
