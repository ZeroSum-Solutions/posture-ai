// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'


import { canonicalAssessmentTimestamp } from './ClinicalAssessmentResults'
import ReviewFindings from './ReviewFindings'
import { buildReviewModel } from './reviewModel'

afterEach(cleanup)

function rows() {
  return buildReviewModel({
    assessment: {
      overall_score: 40,
      overall_grade: 'C',
      scoring_engine_version: '2.1.0',
      assessed_at: '2026-07-12T00:00:00Z',
    },
    findings: [{
      id: 'f1',
      imbalance_key: 'trunk_lean',
      region: 'spine',
      label: 'Trunk Lean',
      deviation: 5,
      direction: 'Forward',
      severity_pct: 40,
      zone: 'warning',
      unit: '°',
      standard: 2,
      tight_muscle_links: [{ slug: 'iliopsoas', name: 'Iliopsoas' }],
      weak_muscle_links: [],
    }],
    prior: null,
    scanLabel: 'Screening · 12 Jul 2026',
    priorLabel: null,
  }).rows
}

// array-v3-spec.md §5 Results: a finding row's primary action is now opening
// its detail Sheet (medium detent), not toggling the 3D spotlight directly —
// spotlighting moved to the Sheet's own "Show on map" button, next to the
// finding's muscle chips.
describe('finding spotlight (3D posture map)', () => {
  it('opens the finding sheet and spotlights the finding via "Show on map"', () => {
    const onSpotlight = vi.fn()
    render(<ReviewFindings rows={rows()} onSpotlight={onSpotlight} />)
    fireEvent.click(screen.getByRole('button', { name: /Trunk Lean/ }))
    const mapButton = screen.getByRole('button', { name: 'Show on map' })
    fireEvent.click(mapButton)
    expect(onSpotlight).toHaveBeenCalledWith('trunk_lean')
  })

  it('labels the map button "Showing on body" once this finding is the active spotlight', () => {
    render(<ReviewFindings rows={rows()} onSpotlight={() => {}} activeKey="trunk_lean" />)
    fireEvent.click(screen.getByRole('button', { name: /Trunk Lean/ }))
    expect(screen.getByRole('button', { name: 'Showing on body' })).toBeTruthy()
  })

  it('has no "Show on map" button in the sheet when a finding has no muscle links', () => {
    const bare = rows().map(row => ({
      ...row, causes: null, tightMuscles: [], weakMuscles: [], tightLinks: [], weakLinks: [],
    }))
    render(<ReviewFindings rows={bare} onSpotlight={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Trunk Lean/ }))
    expect(screen.queryByRole('button', { name: /Show on map|Showing on body/ })).toBeNull()
  })
})

describe('assessment comparison timestamp boundary', () => {
  it('normalizes Postgres RFC 3339 timestamps for the canonical API filter', () => {
    expect(canonicalAssessmentTimestamp('2026-06-30T12:00:00+00:00')).toBe('2026-06-30T12:00:00.000Z')
    expect(canonicalAssessmentTimestamp('2026-06-30T12:00:00.123456+00:00'))
      .toBe('2026-06-30T12:00:00.123456Z')
    expect(canonicalAssessmentTimestamp('not-a-date')).toBeNull()
  })
})
