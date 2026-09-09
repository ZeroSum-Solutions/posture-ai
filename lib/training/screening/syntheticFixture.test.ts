import { describe, expect, it } from 'vitest'
import { syntheticScreeningFixtureFramesV1 } from './syntheticFixture'

describe('syntheticScreeningFixtureFramesV1', () => {
  it('provides each explicitly asserted capture group without adding camera provenance', () => {
    const frames = syntheticScreeningFixtureFramesV1()

    expect(frames.map((frame) => `${frame.view}:${frame.profileSide ?? 'none'}`)).toEqual([
      'front:none',
      'side:left',
      'side:right',
      'back:none',
    ])
    expect(frames.every((frame) => frame.poseMeta === undefined)).toBe(true)
    expect(frames.every((frame) => frame.captureRollDeg === undefined)).toBe(true)
  })
})
