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

// The findings listed under the selected view (each row's visible label, exact match).
const LABELS = ['Shoulder Imbalance (Front)', 'Forward Head Posture', 'Trunk Lean']
const findingNames = () => {
  const region = screen.getByRole('region', { name: /view/ })
  return LABELS.filter((label) => within(region).queryAllByText(label, { exact: true }).length > 0)
}

describe('ReviewEvidence (capture set as evidence)', () => {
  it('shows the whole capture set with no drawn body guide or disclaimer copy', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} captures={captures} levelVerified={null} />)
    const group = screen.getByRole('group', { name: 'Capture views' })
    expect(within(group).getAllByRole('button', { name: / view$/ })).toHaveLength(4)
    expect(screen.queryByText(/Region guide/)).toBeNull()
    expect(screen.queryByText(/not a reconstruction/)).toBeNull()
  })

  it('opens on the first view with findings and lists only what was measured on it', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} captures={captures} levelVerified={null} />)
    expect(screen.getByRole('button', { name: 'front view' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: /Front view/ }).textContent).toContain('1 finding')
    expect(findingNames()).toEqual(['Shoulder Imbalance (Front)'])
  })

  it('tapping a side photo highlights both side photos and lists the side findings below', () => {
    render(<ReviewEvidence rows={rows} viewByKey={viewByKey} captures={captures} levelVerified={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'side left view' }))
    expect(screen.getByRole('button', { name: 'side left view' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'side right view' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'front view' }).getAttribute('aria-pressed')).toBe('false')
    expect(findingNames()).toEqual(['Forward Head Posture', 'Trunk Lean'])

    fireEvent.click(screen.getByRole('button', { name: 'back view' }))
    expect(screen.getByText('No findings were measured on the back view.')).toBeTruthy()
  })

  it('keeps a finding reachable when its view has no saved photo, and rows still spotlight', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'side view' }))
    expect(findingNames()).toEqual(['Forward Head Posture', 'Trunk Lean'])
    fireEvent.click(screen.getByTestId('finding-spotlight-trunk_lean'))
    expect(onSpotlight).toHaveBeenCalledWith('trunk_lean')
  })
})
