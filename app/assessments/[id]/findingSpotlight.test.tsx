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

describe('finding spotlight (3D posture map)', () => {
  it('makes a finding with muscles a toggle button that spotlights it', () => {
    const onSpotlight = vi.fn()
    render(<ReviewFindings rows={rows()} onSpotlight={onSpotlight} />)
    const button = screen.getByRole('button', { name: /Trunk Lean/ })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(onSpotlight).toHaveBeenCalledWith('trunk_lean')
  })

  it('reports the active finding as pressed (WCAG 4.1.2) and no longer expands a card', () => {
    render(<ReviewFindings rows={rows()} onSpotlight={() => {}} activeKey="trunk_lean" />)
    expect(screen.getByRole('button', { name: /Trunk Lean/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('Muscle Analysis')).toBeNull()
  })

  it('is not a button when a finding has no muscle links', () => {
    const bare = rows().map(row => ({
      ...row, causes: null, tightMuscles: [], weakMuscles: [], tightLinks: [], weakLinks: [],
    }))
    render(<ReviewFindings rows={bare} onSpotlight={() => {}} />)
    expect(screen.queryByRole('button', { name: /Trunk Lean/ })).toBeNull()
    expect(screen.getByText('Trunk Lean')).toBeTruthy()
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
