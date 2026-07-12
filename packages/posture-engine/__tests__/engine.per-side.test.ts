import { describe, it, expect } from 'vitest'
import { assessPosture } from '../src/engine'
import { forwardHeadPosture } from '../src/metrics'
import type { PoseFrame } from '../src/types'

// A side frame whose NEAR profile shows a forward head of ~atan(fwd / 0.20).
// Feet are set so facing is confirmed (toe right of heel ⇒ anterior ear scored).
function sideFrame(profileSide: 'left' | 'right', fwd: number): PoseFrame {
  const p = profileSide
  return { view: 'side', profileSide, landmarks: {
    [`${p}_shoulder`]: { x: 0.50, y: 0.40, visibility: 0.99 },
    [`${p}_ear`]: { x: 0.50 + fwd, y: 0.20, visibility: 0.99 },
    [`${p}_foot_index`]: { x: 0.55, y: 0.98, visibility: 0.9 },
    [`${p}_heel`]: { x: 0.48, y: 0.98, visibility: 0.9 },
  } }
}

describe('per-side engine', () => {
  it('emits ONE forward_head finding = worst side, with both observations', () => {
    const r = assessPosture([sideFrame('left', 0.02), sideFrame('right', 0.10)])
    const fhp = r.findings.filter(f => f.key === 'forward_head_posture')
    expect(fhp).toHaveLength(1)
    expect(fhp[0].drivingProfileSide).toBe('right')
    expect(fhp[0].observations?.map(o => o.profileSide).sort()).toEqual(['left', 'right'])
    const leftObs = fhp[0].observations!.find(o => o.profileSide === 'left')!
    expect(fhp[0].deviation).toBeGreaterThan(leftObs.deviation) // right (worse) drove the aggregate
  })
  it('legacy side input is byte-identical to pre-change scoring', () => {
    const legacy = sideFrame('right', 0.10); delete legacy.profileSide
    const r = assessPosture([legacy])
    const fhp = r.findings.find(f => f.key === 'forward_head_posture')!
    const direct = forwardHeadPosture(legacy) // same metric run on the raw frame
    expect(fhp.observations).toBeUndefined()
    expect(fhp.drivingProfileSide).toBeUndefined()
    expect({ deviation: fhp.deviation, severityPct: fhp.severityPct, zone: fhp.zone,
             direction: fhp.direction, reliable: fhp.reliable })
      .toEqual({ deviation: direct.deviation, severityPct: direct.severityPct, zone: direct.zone,
                 direction: direct.direction, reliable: direct.reliable })
  })
})
