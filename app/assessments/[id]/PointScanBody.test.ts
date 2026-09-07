import { describe, expect, it } from 'vitest'
import { buildParticles, spanAt } from './PointScanBody'

describe('PointScanBody point-cloud geometry', () => {
  it('uses the terminal silhouette span below the final body anchor', () => {
    const spans = [
      { at: 0.1, centre: 0.6, halfWidth: 0.1 },
      { at: 0.9, centre: 0.5, halfWidth: 0.08 },
    ]

    expect(spanAt(spans, 0.99)).toEqual({ centre: 0.5, halfWidth: 0.08 })
  })

  it('rebuilds identical particle positions for the same view', () => {
    expect(buildParticles('side')).toEqual(buildParticles('side'))
    expect(buildParticles('front')).toEqual(buildParticles('front'))
  })
})
