import { describe, it, expect } from 'vitest'
import type { PoseFrame, Finding, SideObservation } from '../src/types'

describe('per-side types', () => {
  it('accepts profileSide and observations', () => {
    const obs: SideObservation = {
      profileSide: 'left', deviation: 3, direction: 'Forward',
      severityPct: 40, zone: 'warning', confidence: 0.9, reliable: true,
    }
    const frame: Pick<PoseFrame, 'profileSide'> = { profileSide: 'right' }
    const finding: Pick<Finding, 'observations' | 'drivingProfileSide'> = {
      observations: [obs], drivingProfileSide: 'left',
    }
    expect(frame.profileSide).toBe('right')
    expect(finding.observations?.[0].profileSide).toBe('left')
    expect(finding.drivingProfileSide).toBe('left')
  })
})
