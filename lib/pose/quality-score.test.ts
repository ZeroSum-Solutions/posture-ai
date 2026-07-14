import { describe, expect, it } from 'vitest'
import type { PoseFrame } from '@posture-ai/engine/types'
import { requiredNearSideJoints } from './quality'
import { scoreFrameQuality } from './quality-score'

function landmark(x: number, y: number, visibility = 0.9) {
  return { x, y, visibility }
}

function makeFrontFrame(options: {
  headY?: number
  ankleY?: number
  ankleXs?: [number, number]
  rollDeg?: number
  omit?: string[]
} = {}): PoseFrame {
  const headY = options.headY ?? 0.1
  const ankleY = options.ankleY ?? 0.9
  const [leftAnkleX, rightAnkleX] = options.ankleXs ?? [0.45, 0.55]
  const landmarks = {
    nose: landmark(0.5, headY),
    left_eye: landmark(0.48, headY),
    right_eye: landmark(0.52, headY),
    left_shoulder: landmark(0.4, 0.3),
    right_shoulder: landmark(0.6, 0.3),
    left_hip: landmark(0.44, 0.5),
    right_hip: landmark(0.56, 0.5),
    left_knee: landmark(0.44, 0.7),
    right_knee: landmark(0.56, 0.7),
    left_ankle: landmark(leftAnkleX, ankleY),
    right_ankle: landmark(rightAnkleX, ankleY),
  }

  for (const name of options.omit ?? []) delete landmarks[name as keyof typeof landmarks]

  return { view: 'front', landmarks, captureRollDeg: options.rollDeg }
}

describe('requiredNearSideJoints', () => {
  it('selects the frozen required joints for each view and side', () => {
    expect(requiredNearSideJoints('front', undefined)).toEqual([
      'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
      'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
    ])
    expect(requiredNearSideJoints('side', 'left')).toEqual([
      'left_ear', 'left_shoulder', 'left_hip', 'left_knee', 'left_ankle',
    ])
    expect(requiredNearSideJoints('side', 'right')).toEqual([
      'right_ear', 'right_shoulder', 'right_hip', 'right_knee', 'right_ankle',
    ])
    expect(requiredNearSideJoints('back', undefined)).toEqual([
      'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
    ])
  })
})

describe('scoreFrameQuality', () => {
  it('scores a centered, well-framed, level front frame near 100 with no warnings', () => {
    const result = scoreFrameQuality(makeFrontFrame(), 'front', undefined, 0)

    expect(result).toEqual({
      score: 100,
      factors: { framing: 40, joints: 35, level: 25 },
      warnings: [],
      blocked: false,
    })
  })

  it('uses the exact linear span ramps below the full-score band', () => {
    const result = scoreFrameQuality(makeFrontFrame({ headY: 0.2, ankleY: 0.75 }), 'front', undefined, 0)

    expect(result.factors.framing).toBeCloseTo(32.5, 10)
    expect(result.factors.joints).toBe(35)
  })

  it('uses the exact linear span ramps above the full-score band', () => {
    const result = scoreFrameQuality(makeFrontFrame({ headY: 0, ankleY: 1 }), 'front', undefined, 0)

    expect(result.factors.framing).toBeCloseTo(35, 10)
  })

  it('clamps an out-of-range span to zero', () => {
    const result = scoreFrameQuality(makeFrontFrame({ headY: 0.3, ankleY: 0.7 }), 'front', undefined, 0)

    expect(result.factors.framing).toBe(25)
  })

  it('uses the exact centering ramp', () => {
    const result = scoreFrameQuality(
      makeFrontFrame({ ankleXs: [0.2, 0.3] }),
      'front',
      undefined,
      0,
    )

    expect(result.factors.framing).toBeCloseTo(32.5, 10)
  })

  it.each([
    [0, 25],
    [3, 25 - (13 / 3)],
    [8, 4.8],
  ])('uses the exact level ramp at %s degrees', (rollDeg, expected) => {
    const result = scoreFrameQuality(makeFrontFrame(), 'front', undefined, rollDeg)

    expect(result.factors.level).toBeCloseTo(expected, 10)
  })

  it('scores span zero and warns when no visible head is available', () => {
    const frame = makeFrontFrame({ omit: ['nose', 'left_eye', 'right_eye'] })
    const result = scoreFrameQuality(frame, 'front', undefined, 0)

    expect(result.factors.framing).toBe(25)
    expect(result.warnings.some(warning => /head/i.test(warning))).toBe(true)
  })

  it('scores span zero and warns when no visible ankle is available', () => {
    const frame = makeFrontFrame({ omit: ['left_ankle', 'right_ankle'] })
    const result = scoreFrameQuality(frame, 'front', undefined, 0)

    expect(result.factors.framing).toBe(7.5)
    expect(result.warnings.some(warning => /ankle/i.test(warning))).toBe(true)
  })

  it('scores centering zero and warns when the support anchor is unavailable', () => {
    const frame = makeFrontFrame({ omit: ['right_ankle'] })
    const result = scoreFrameQuality(frame, 'front', undefined, 0)

    expect(result.factors.framing).toBeCloseTo(23.75, 10)
    expect(result.warnings.some(warning => /centering|anchor/i.test(warning))).toBe(true)
  })

  it('reduces joints proportionally when a required joint group is absent', () => {
    const frame = makeFrontFrame({ omit: ['left_knee', 'right_knee'] })
    const result = scoreFrameQuality(frame, 'front', undefined, 0)

    expect(result.factors.joints).toBe(26.25)
    expect(result.warnings.some(warning => /knee/i.test(warning))).toBe(true)
  })

  it('uses level 18 and warns when the upload has no roll measurement', () => {
    const result = scoreFrameQuality(makeFrontFrame(), 'front', undefined, null)

    expect(result.factors.level).toBe(18)
    expect(result.warnings.some(warning => /level unverified/i.test(warning))).toBe(true)
    expect(result.blocked).toBe(false)
  })

  it('blocks front and side sparse frames but never blocks back sparse frames', () => {
    const sparse: PoseFrame = {
      view: 'front',
      landmarks: {
        nose: landmark(0.5, 0.1),
        left_shoulder: landmark(0.4, 0.3),
        right_shoulder: landmark(0.6, 0.3),
      },
    }

    expect(scoreFrameQuality(sparse, 'front', undefined, 0).blocked).toBe(true)
    expect(scoreFrameQuality({ ...sparse, view: 'side' }, 'side', 'left', 0).blocked).toBe(true)
    expect(scoreFrameQuality({ ...sparse, view: 'back' }, 'back', undefined, 0).blocked).toBe(false)
    expect(scoreFrameQuality(makeFrontFrame(), 'front', undefined, 0).blocked).toBe(false)
  })
})
