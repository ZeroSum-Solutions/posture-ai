import { describe, it, expect } from 'vitest'
import { generatePose, expectedDeviations } from '../golden/synthetic'
import {
  forwardHeadPosture, anteriorImbalancedShoulders, pelvicObliquity,
  trunkLean, genuVarumValgumLeft, kneeExtensionBackKnee,
} from '../src/metrics'

const TOL = 0.15 // degrees, orthographic

describe('synthetic generator recovers spec angles (orthographic)', () => {
  it('neutral pose yields ~0 on every metric', () => {
    const front = generatePose('front')
    const side = generatePose('side')
    expect(Math.abs(forwardHeadPosture(side).deviation)).toBeLessThan(TOL)
    expect(Math.abs(anteriorImbalancedShoulders(front).deviation)).toBeLessThan(TOL)
    expect(Math.abs(pelvicObliquity(front).deviation)).toBeLessThan(TOL)
    expect(Math.abs(trunkLean(side).deviation)).toBeLessThan(TOL)
    expect(Math.abs(genuVarumValgumLeft(front).deviation)).toBeLessThan(TOL)
    expect(Math.abs(kneeExtensionBackKnee(side).deviation)).toBeLessThan(TOL)
  })

  it('MediaPipe front-view mirror convention holds: subject left at larger image x', () => {
    const front = generatePose('front')
    expect(front.landmarks['left_shoulder'].x).toBeGreaterThan(front.landmarks['right_shoulder'].x)
  })

  it('side view faces image-right (toe.x > heel.x) so anterior labels resolve', () => {
    const side = generatePose('side')
    expect(side.landmarks['left_foot_index'].x).toBeGreaterThan(side.landmarks['left_heel'].x)
  })

  it.each([
    [{ trunkLeanDeg: 8 }, 'trunk_lean', (f: any) => trunkLean(f).deviation, 8],
    [{ forwardHeadDeg: 12 }, 'fhp', (f: any) => forwardHeadPosture(f).deviation, 12],
    [{ kneeHyperextensionDeg: 7 }, 'knee', (f: any) => kneeExtensionBackKnee(f).deviation, 7],
  ])('side-view spec %j recovers %s = %d°', (spec, _label, metric, want) => {
    const side = generatePose('side', spec as any)
    expect(Math.abs(metric(side) - (want as number))).toBeLessThan(TOL)
  })

  it.each([
    [{ shoulderTiltDeg: 4 }, (f: any) => anteriorImbalancedShoulders(f), 4, 'Left Low'],
    [{ pelvicTiltDeg: 3 }, (f: any) => pelvicObliquity(f), 3, 'Left Low'],
  ])('front-view spec %j recovers deviation + direction', (spec, metric, want, dir) => {
    const f = metric(generatePose('front', spec as any))
    expect(Math.abs(f.deviation - (want as number))).toBeLessThan(TOL)
    expect(f.direction).toBe(dir)
  })

  it('left knee valgus 6° recovers magnitude and Valgum direction', () => {
    const f = genuVarumValgumLeft(generatePose('front', { kneeValgusLeftDeg: 6 }))
    expect(Math.abs(f.deviation - 6)).toBeLessThan(TOL)
    expect(f.direction).toContain('Valgum')
  })

  it('expectedDeviations mirrors the spec', () => {
    expect(expectedDeviations({ trunkLeanDeg: 8, forwardHeadDeg: 12 })).toMatchObject({
      trunk_lean: 8, forward_head_posture: 12,
    })
  })
})
