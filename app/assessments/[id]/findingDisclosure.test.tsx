// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// The muscle map's own rendering is irrelevant to the disclosure's semantics.
vi.mock('./MuscleBodyMap', () => ({ default: () => null }))

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

describe('finding muscle-analysis disclosure', () => {
  it('exposes its expanded state to assistive technology (WCAG 4.1.2)', () => {
    render(<ReviewFindings rows={rows()} />)
    // A native details/summary reports expanded state on its own, so there is no
    // hand-maintained aria-expanded to drift out of step with the panel.
    const summary = screen.getByText('Muscle Analysis')
    expect(summary.tagName).toBe('SUMMARY')
    const details = summary.closest('details')
    expect(details).toBeTruthy()
    expect(details!.open).toBe(false)
  })

  it('omits the disclosure when a finding has no muscle links and no causes', () => {
    const bare = rows().map(row => ({
      ...row, causes: null, tightMuscles: [], weakMuscles: [], tightLinks: [], weakLinks: [],
    }))
    render(<ReviewFindings rows={bare} />)
    expect(screen.queryByText('Muscle Analysis')).toBeNull()
  })

  it('draws no range bar for an unusable reading', () => {
    const unusable = rows().map(row => ({ ...row, reliable: false }))
    const { container } = render(<ReviewFindings rows={unusable} />)
    expect(container.textContent).toContain('Reading not usable')
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
