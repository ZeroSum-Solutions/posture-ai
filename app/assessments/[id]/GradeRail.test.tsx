// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import GradeRail from './GradeRail'
import { buildReviewModel, type GradeRailModel } from './reviewModel'

afterEach(cleanup)

function rail(): GradeRailModel {
  return buildReviewModel({
    assessment: {
      overall_score: 14,
      overall_grade: 'B',
      scoring_engine_version: '2.1.0',
      assessed_at: '2026-07-12T00:00:00Z',
    },
    findings: [],
    prior: null,
    scanLabel: 'Screening · 12 Jul 2026',
    priorLabel: null,
  }).rail
}

// The grade-letter badge is aria-hidden in both branches (its colour comes
// from bandFromGrade, a known, separately-tracked issue — see the doc
// comment on GradeRail's scaleApplies prop). These tests guard the thing
// that actually regressed: that assistive technology hears the grade letter
// regardless of which branch renders.
describe('GradeRail grade-letter announcement', () => {
  it('announces the grade letter when the current scale applies', () => {
    const { container } = render(<GradeRail rail={rail()} scaleApplies />)
    const srText = Array.from(container.querySelectorAll('.sr-only'))
      .map(el => el.textContent)
      .join(' ')

    expect(srText).toContain('grade B')
  })

  it('announces the grade as recorded — without a current-scale band or range — when the scale does not apply', () => {
    const { container, getByText } = render(<GradeRail rail={rail()} scaleApplies={false} />)
    const srText = Array.from(container.querySelectorAll('.sr-only'))
      .map(el => el.textContent)
      .join(' ')

    // This is the regression: previously nothing in this branch named the
    // grade at all, so a screen-reader user heard the score and the caveat
    // sentence and never the letter the visible badge shows.
    expect(srText).toContain('Grade B')
    expect(srText).toContain('as recorded')

    // The gated interpretations — current-scale band name and numeric range
    // — must not leak into the fallback announcement even though they are
    // safe to say when scaleApplies is true.
    expect(srText).not.toMatch(/maintain|monitor|review/i)
    expect(srText).not.toMatch(/8[–-]20/)

    expect(getByText(/Recorded with a different or unknown scoring version/)).toBeTruthy()
  })
})
