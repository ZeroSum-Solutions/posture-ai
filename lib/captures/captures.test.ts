import { describe, it, expect } from 'vitest'
import { buildCaptureRow } from './buildCaptureRow'
import { dedupeCapturesByViewSide } from './dedupeCaptures'
import type { PoseFrame } from '@posture-ai/engine'

const frame = (view: PoseFrame['view'], profileSide?: 'left' | 'right'): PoseFrame => ({
  view,
  landmarks: {},
  ...(profileSide ? { profileSide } : {}),
})

describe('buildCaptureRow — profile_side persistence', () => {
  it('sets profile_side from a side frame', () => {
    expect(buildCaptureRow(frame('side', 'left'), 'a', 'p', { useFixture: false }).profile_side).toBe('left')
    expect(buildCaptureRow(frame('side', 'right'), 'a', 'p', { useFixture: false }).profile_side).toBe('right')
  })
  it('null profile_side for front/back and legacy unspecified side', () => {
    expect(buildCaptureRow(frame('front'), 'a', 'p', { useFixture: false }).profile_side).toBeNull()
    expect(buildCaptureRow(frame('back'), 'a', 'p', { useFixture: false }).profile_side).toBeNull()
    expect(buildCaptureRow(frame('side'), 'a', 'p', { useFixture: false }).profile_side).toBeNull()
  })
  it('carries assessment/practitioner ids and picks the fixture source flag', () => {
    const row = buildCaptureRow(frame('front'), 'a1', 'p1', { useFixture: true })
    expect(row.assessment_id).toBe('a1')
    expect(row.practitioner_id).toBe('p1')
    expect(row.source).toBe('fixture')
  })
  it('defaults a non-fixture frame source to upload', () => {
    expect(buildCaptureRow(frame('front'), 'a', 'p', { useFixture: false }).source).toBe('upload')
  })
})

describe('dedupeCapturesByViewSide — laterality preserved', () => {
  it('keeps left and right side captures as two DISTINCT rows', () => {
    const rows = [
      { id: '1', view: 'front', profile_side: null },
      { id: '2', view: 'side', profile_side: 'left' as const },
      { id: '3', view: 'side', profile_side: 'right' as const },
      { id: '4', view: 'back', profile_side: null },
    ]
    const out = dedupeCapturesByViewSide(rows)
    const sides = out.filter((r) => r.view === 'side')
    expect(sides).toHaveLength(2)
    expect(sides.map((s) => s.profile_side).sort()).toEqual(['left', 'right'])
  })
  it('collapses a within-burst repeat of the same (view, side)', () => {
    const rows = [
      { id: '1', view: 'side', profile_side: 'left' as const },
      { id: '2', view: 'side', profile_side: 'left' as const },
    ]
    expect(dedupeCapturesByViewSide(rows)).toHaveLength(1)
  })
  it('legacy single unspecified side stays one row (back-compat)', () => {
    const rows = [
      { id: '1', view: 'front', profile_side: null },
      { id: '2', view: 'side', profile_side: null },
    ]
    expect(dedupeCapturesByViewSide(rows)).toHaveLength(2)
  })
})
