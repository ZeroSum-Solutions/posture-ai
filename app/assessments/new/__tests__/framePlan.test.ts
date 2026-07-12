import { describe, it, expect } from 'vitest'
import type { PoseFrame } from '@posture-ai/engine/types'
import { buildFramePlan, stampFrame } from '../framePlan'
import { emptySlot } from '../types'
import type { Captures } from '../types'

const base = (): Captures => ({
  'front': emptySlot(), 'side-left': emptySlot(), 'side-right': emptySlot(), 'back': emptySlot(),
})

const frame = (view: PoseFrame['view']): PoseFrame => ({ view, landmarks: {} })

describe('buildFramePlan — one entry per captured slot, raw channel only', () => {
  it('maps a camera burst on side-left to a burst-detect entry with left laterality', () => {
    const caps = base()
    // Display URL is DISTINCT from the raw channel (as a Slice-4 corrected image
    // would be) — the plan must detect the RAW burst, never the display image.
    caps['side-left'] = { ...emptySlot(), source: 'camera', captureRollDeg: 1.2,
      rawRepresentativeUrl: 'blob:raw-l0', rawBurstUrls: ['blob:raw-l0', 'blob:raw-l1', 'blob:raw-l2'],
      displayPreviewUrl: 'blob:CORRECTED-l' }
    const [p] = buildFramePlan(caps)
    expect(p.view).toBe('side')
    expect(p.profileSide).toBe('left')
    expect(p.burstUrls).toEqual(['blob:raw-l0', 'blob:raw-l1', 'blob:raw-l2'])
    expect(p.burstUrls).not.toContain('blob:CORRECTED-l') // never the display channel
    expect(p.cachedFrame).toBeNull()
    expect(p.fallbackUrl).toBeNull()
    expect(p.roll).toBe(1.2)
  })

  it('maps a preflighted side-right single to the cached-frame entry with right laterality', () => {
    const caps = base()
    caps['side-right'] = { ...emptySlot(), source: 'camera',
      rawRepresentativeUrl: 'blob:r0', rawBurstUrls: null, rawPoseFrame: frame('side'), displayPreviewUrl: 'blob:r0' }
    const [p] = buildFramePlan(caps)
    expect(p.view).toBe('side')
    expect(p.profileSide).toBe('right')
    expect(p.cachedFrame).not.toBeNull()
    expect(p.burstUrls).toBeNull()
    expect(p.fallbackUrl).toBeNull()
  })

  it('maps a front upload with no preflight to the fallback-detect entry, no profileSide', () => {
    const caps = base()
    // Distinct raw vs display again — fallback detection must use the raw still.
    caps['front'] = { ...emptySlot(), source: 'upload',
      rawRepresentativeUrl: 'blob:raw-f0', rawBurstUrls: null, rawPoseFrame: null, displayPreviewUrl: 'blob:CORRECTED-f' }
    const [p] = buildFramePlan(caps)
    expect(p.view).toBe('front')
    expect(p.profileSide).toBeUndefined()
    expect(p.fallbackUrl).toBe('blob:raw-f0') // raw, not 'blob:CORRECTED-f'
    expect(p.burstUrls).toBeNull()
    expect(p.cachedFrame).toBeNull()
  })

  it('skips uncaptured slots and preserves front, left, right, back order', () => {
    const caps = base()
    for (const s of ['front', 'side-left', 'side-right', 'back'] as const) {
      caps[s] = { ...emptySlot(), rawRepresentativeUrl: `blob:${s}`, displayPreviewUrl: `blob:${s}` }
    }
    caps['side-right'] = emptySlot() // drop one
    const plan = buildFramePlan(caps)
    expect(plan.map(p => p.slot)).toEqual(['front', 'side-left', 'back'])
  })
})

describe('stampFrame', () => {
  it('stamps profileSide + roll when present', () => {
    const out = stampFrame(frame('side'), 'left', 3)
    expect(out.profileSide).toBe('left')
    expect(out.captureRollDeg).toBe(3)
  })
  it('omits profileSide/roll when absent', () => {
    const out = stampFrame(frame('front'), undefined, null)
    expect(out.profileSide).toBeUndefined()
    expect(out.captureRollDeg).toBeUndefined()
  })
})
