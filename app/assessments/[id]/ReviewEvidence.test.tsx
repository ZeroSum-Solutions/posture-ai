// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ReviewEvidence, { type EvidenceCapture } from './ReviewEvidence'
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

// array-v3-spec.md §5 Results: the capture set is a "Photos (n of 4)"
// Disclosure (no body-guide/reconstruction copy), and findings are no longer
// gated behind a per-view photo toggle — every finding is listed, grouped by
// severity, with the view it was measured on as its subhead.
describe('ReviewEvidence (capture set + findings)', () => {
  it('shows "Photos (n of 4)" and reveals all four slots once opened', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} captures={captures} levelVerified={null} />)
    expect(screen.getByText('Photos (4 of 4)')).toBeTruthy()
    fireEvent.click(screen.getByText('Photos (4 of 4)'))
    const group = screen.getByRole('group', { name: 'Capture views' })
    expect(within(group).getAllByText(/Front|Left Side|Right Side|Back/).length).toBeGreaterThanOrEqual(4)
  })

  it('shows a missing-photo slot inline instead of silently dropping it', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} captures={[capture('c1', 'front')]} levelVerified={null} />)
    expect(screen.getByText('Photos (1 of 4)')).toBeTruthy()
    fireEvent.click(screen.getByText('Photos (1 of 4)'))
    expect(screen.getAllByText('No photo for this view').length).toBe(3)
  })

  it('lists every finding (not gated behind a view toggle), with its view as a subhead', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} captures={captures} levelVerified={null} />)
    expect(screen.getByText('Shoulder Imbalance (Front)')).toBeTruthy()
    expect(screen.getByText('Forward Head Posture')).toBeTruthy()
    expect(screen.getByText('Trunk Lean')).toBeTruthy()
    expect(screen.getAllByText('Side').length).toBe(2)
    expect(screen.getByText('Front')).toBeTruthy()
  })

  it('keeps a finding reachable and spotlightable when its view has no saved photo', () => {
    const onSpotlight = vi.fn()
    render(
      <ReviewEvidence
        rows={rows}
        viewByKey={viewByKey}
        captures={[capture('c1', 'front')]}
        levelVerified={null}
        onSpotlight={onSpotlight}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Trunk Lean/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
    expect(onSpotlight).toHaveBeenCalledWith('trunk_lean')
  })
})
