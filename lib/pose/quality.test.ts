import { describe, it, expect } from 'vitest'
import type { PoseFrame } from '@posture-ai/engine/types'
import { testLandmarksFrames } from '@posture-ai/engine'
import { assessFrameQuality } from './quality'

// ---- Helpers to build minimal PoseFrame fixtures ----

function makeFrame(view: PoseFrame['view'], landmarks: PoseFrame['landmarks'] = {}): PoseFrame {
  return { view, landmarks }
}

function withVis(base: Record<string, { x: number; y: number; visibility: number }>, overrides: Record<string, number>) {
  const result: PoseFrame['landmarks'] = {}
  for (const [k, v] of Object.entries(base)) {
    result[k] = { ...v, visibility: overrides[k] ?? v.visibility }
  }
  return result
}

// Full set of landmarks with high visibility — build from the fixture
const frontFrame = testLandmarksFrames.find(f => f.view === 'front')!
const sideFrame = testLandmarksFrames.find(f => f.view === 'side')!

// ---- Test suite ----

describe('assessFrameQuality', () => {
  describe('no_person', () => {
    it('returns no_person when landmarks are empty', () => {
      const result = assessFrameQuality(makeFrame('front'), 'front')
      expect(result.status).toBe('no_person')
      expect(result.warnings).toHaveLength(0)
    })

    it('returns no_person when only one irrelevant landmark present', () => {
      const result = assessFrameQuality(
        makeFrame('front', { nose: { x: 0.5, y: 0.1, visibility: 0.9 } }),
        'front',
      )
      expect(result.status).toBe('no_person')
    })
  })

  describe('ok — clean frame', () => {
    it('returns ok for the fixture front frame (all landmarks high-vis)', () => {
      const result = assessFrameQuality(frontFrame, 'front')
      expect(result.status).toBe('ok')
      expect(result.warnings).toHaveLength(0)
    })

    it('returns ok for the fixture side frame (near-side landmarks high-vis)', () => {
      const result = assessFrameQuality(sideFrame, 'side')
      expect(result.status).toBe('ok')
      expect(result.warnings).toHaveLength(0)
    })
  })

  describe('warnings — front view', () => {
    it('warns about legs when front-view knees/ankles are low-vis', () => {
      // Lower the knee and ankle visibility below the reliability floor
      const lowLegLandmarks = withVis(
        frontFrame.landmarks as Record<string, { x: number; y: number; visibility: number }>,
        {
          left_knee: 0.2,
          right_knee: 0.2,
          left_ankle: 0.2,
          right_ankle: 0.2,
        },
      )
      const result = assessFrameQuality(makeFrame('front', lowLegLandmarks), 'front')
      expect(result.status).toBe('warnings')
      expect(result.warnings.length).toBeGreaterThan(0)
      // Warning should mention stepping back / feet in frame
      const text = result.warnings.join(' ').toLowerCase()
      expect(text).toMatch(/leg|feet|step back/i)
    })

    it('warns about shoulders when both front-view shoulders are low-vis', () => {
      const lowShoulderLandmarks = withVis(
        frontFrame.landmarks as Record<string, { x: number; y: number; visibility: number }>,
        { left_shoulder: 0.2, right_shoulder: 0.2 },
      )
      const result = assessFrameQuality(makeFrame('front', lowShoulderLandmarks), 'front')
      expect(result.status).toBe('warnings')
      const text = result.warnings.join(' ').toLowerCase()
      expect(text).toMatch(/shoulder/i)
    })
  })

  describe('side view — far-side occlusion is NOT a warning', () => {
    it('does NOT warn when the far side (right) is occluded but the near side (left) is clear', () => {
      // The fixture side frame has left=visible, right=occluded — exactly this scenario
      const result = assessFrameQuality(sideFrame, 'side')
      expect(result.status).toBe('ok')
      // No warnings about the far side being occluded
      expect(result.warnings).toHaveLength(0)
    })

    it('warns only when the BETTER side of a side-view landmark group is also low-vis', () => {
      // Degrade the NEAR (left) side to low-vis too — far side is already occluded
      const bothSidesLow = withVis(
        sideFrame.landmarks as Record<string, { x: number; y: number; visibility: number }>,
        { left_ankle: 0.1, right_ankle: 0.1, left_knee: 0.1, right_knee: 0.1 },
      )
      const result = assessFrameQuality(makeFrame('side', bothSidesLow), 'side')
      expect(result.status).toBe('warnings')
    })
  })

  describe('back view', () => {
    it('returns ok for back view with high-vis shoulders/hips/knees/ankles', () => {
      // Build a back frame from the front fixture (same bilateral structure)
      const backFrame: PoseFrame = { view: 'back', landmarks: frontFrame.landmarks }
      const result = assessFrameQuality(backFrame, 'back')
      expect(result.status).toBe('ok')
    })

    it('warns when back-view hips are low-vis', () => {
      const lowHipLandmarks = withVis(
        frontFrame.landmarks as Record<string, { x: number; y: number; visibility: number }>,
        { left_hip: 0.2, right_hip: 0.2 },
      )
      const result = assessFrameQuality(makeFrame('back', lowHipLandmarks), 'back')
      expect(result.status).toBe('warnings')
      const text = result.warnings.join(' ').toLowerCase()
      expect(text).toMatch(/hip/i)
    })
  })
})
