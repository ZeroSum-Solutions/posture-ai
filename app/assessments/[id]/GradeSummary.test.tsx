// @vitest-environment node
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BandTable, GradeRing, ScoreBar } from './GradeSummary'

const BANNED_RESULT_COPY = [
  'elite',
  'critical',
  'percentile',
  'rank',
  'top 10%',
  'modeled population',
]

describe('web grade summary', () => {
  it('renders score 14 as accessible grade B using the engine-derived 8–20 range', () => {
    const markup = renderToStaticMarkup(
      <>
        <GradeRing grade="B" score={14} />
        <ScoreBar grade="B" score={14} />
        <BandTable currentGrade="B" />
      </>,
    )

    expect(markup).toContain('Grade B: Mild deviation; deviation 14 out of 100, lower is better')
    expect(markup).toContain('8–20')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('Lower deviation')
    expect(markup).toContain('Higher deviation')

    const normalized = markup.toLowerCase()
    for (const banned of BANNED_RESULT_COPY) expect(normalized).not.toContain(banned)
  })

  it('renders every exact range and neutral description', () => {
    const markup = renderToStaticMarkup(<BandTable currentGrade="S" />)

    for (const expected of [
      '0–3', 'Minimal deviation',
      '4–7', 'Low deviation',
      '8–20', 'Mild deviation',
      '21–55', 'Moderate deviation',
      '56–87', 'High deviation',
      '88–100', 'Very high deviation',
    ]) expect(markup).toContain(expected)
  })
})
