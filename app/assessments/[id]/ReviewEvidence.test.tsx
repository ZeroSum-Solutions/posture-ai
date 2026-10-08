// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ReviewEvidence, { type EvidenceCapture } from './ReviewEvidence'
import { CaptureSet } from './CaptureSet'
import { buildReviewModel } from './reviewModel'

afterEach(cleanup)

const finding = (id: string, imbalance_key: string, label: string, severity_pct: number) => ({
  id,
  imbalance_key,
  region: 'spine',
  label,
  deviation: 5,
  direction: 'Forward',
  severity_pct,
  zone: 'warning' as const,
  unit: '°',
  standard: 2,
  tight_muscle_links: [{ slug: 'iliopsoas', name: 'Iliopsoas' }],
  weak_muscle_links: [],
})

const rows = buildReviewModel({
  assessment: {
    overall_score: 40,
    overall_grade: 'C',
    scoring_engine_version: '2.1.0',
    assessed_at: '2026-07-12T00:00:00Z',
  },
  findings: [
    finding('f1', 'anterior_imbalanced_shoulders', 'Shoulder Imbalance (Front)', 40),
    finding('f2', 'forward_head_posture', 'Forward Head Posture', 55),
    finding('f3', 'trunk_lean', 'Trunk Lean', 38),
  ],
  prior: null,
  scanLabel: 'Screening · 12 Jul 2026',
  priorLabel: null,
}).rows

const viewByKey = { anterior_imbalanced_shoulders: 'front', forward_head_posture: 'side', trunk_lean: 'side' }

const capture = (id: string, view: string, profile_side: 'left' | 'right' | null = null): EvidenceCapture => ({
  id, view, profile_side, signed_url: `/api/captures/${id}/image`, capture_roll_deg: null,
})
const captures = [capture('c1', 'front'), capture('c2', 'side', 'left'), capture('c3', 'side', 'right'), capture('c4', 'back')]

// Array v4 Results: the capture set lives in the capture-quality sheet as a
// "Photos (n of 4)" contact sheet with missing slots shown in place; the
// Findings pane lists every finding (filter tiles + readout rows) with the
// view it was measured on.
describe('CaptureSet (capture-quality sheet)', () => {
  it('shows "Photos (n of 4)" with all four slots', () => {
    render(<CaptureSet captures={captures} />)
    expect(screen.getByText('Photos (4 of 4)')).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Capture views' })
    expect(within(group).getAllByText(/Front|Left Side|Right Side|Back/).length).toBeGreaterThanOrEqual(4)
  })

  it('shows a missing-photo slot inline instead of silently dropping it', () => {
    render(<CaptureSet captures={[capture('c1', 'front')]} />)
    expect(screen.getByText('Photos (1 of 4)')).toBeTruthy()
    expect(screen.getAllByText('No photo for this view').length).toBe(3)
  })
})

describe('ReviewEvidence (findings pane)', () => {
  it('lists every finding (not gated behind a view toggle), with its view as a subhead', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} />)
    expect(screen.getByText('Shoulder Imbalance (Front)')).toBeTruthy()
    expect(screen.getByText('Forward Head Posture')).toBeTruthy()
    expect(screen.getByText('Trunk Lean')).toBeTruthy()
    expect(screen.getAllByText('Side').length).toBe(2)
    expect(screen.getByText('Front')).toBeTruthy()
  })

  it('filters by severity from the tiles and clears on a second tap', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} />)
    expect(screen.getAllByTestId('finding-row')).toHaveLength(3)
    const monitor = screen.getByRole('button', { name: /3\s*Monitor/ })
    fireEvent.click(monitor)
    expect(monitor.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByTestId('finding-row')).toHaveLength(3)
    fireEvent.click(monitor)
    expect(monitor.getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps a finding reachable and spotlightable from its sheet', () => {
    const onSpotlight = vi.fn()
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} onSpotlight={onSpotlight} />)
    fireEvent.click(screen.getByRole('button', { name: /Trunk Lean/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
    expect(onSpotlight).toHaveBeenCalledWith('trunk_lean')
  })

  it('draws the threshold scale only when the engine cut-points apply to a degree reading', () => {
    const degRows = rows.map((row) => ({ ...row, unit: 'deg' }))
    const { container, rerender } = render(<ReviewEvidence rows={degRows} viewByKey={viewByKey} thresholdsApply />)
    expect(container.textContent).toContain('°')
    const withScale = container.querySelectorAll('[aria-hidden="true"] span[style*="left"]').length
    rerender(<ReviewEvidence rows={degRows} viewByKey={viewByKey} thresholdsApply={false} />)
    const withoutScale = container.querySelectorAll('[aria-hidden="true"] span[style*="left"]').length
    expect(withScale).toBeGreaterThan(withoutScale)
  })
})
