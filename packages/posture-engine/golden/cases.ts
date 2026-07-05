import type { PostureSpec, CameraSpec } from './synthetic'

export interface GoldenCase { name: string; spec: PostureSpec; cam?: CameraSpec }

/** Orthographic cases assert exact recovery; the two perspective cases measure
 * real-camera error (reported, tolerated more loosely — their drift matters,
 * not their absolute error). */
export const GOLDEN_CASES: GoldenCase[] = [
  { name: 'neutral', spec: {} },
  { name: 'fhp-warn', spec: { forwardHeadDeg: 6 } },
  { name: 'fhp-danger', spec: { forwardHeadDeg: 16 } },
  { name: 'shoulder-tilt-warn', spec: { shoulderTiltDeg: 3 } },
  { name: 'trunk-lean-warn', spec: { trunkLeanDeg: 4 } },
  { name: 'trunk-lean-danger', spec: { trunkLeanDeg: 9 } },
  { name: 'pelvic-obliquity-warn', spec: { pelvicTiltDeg: 3 } },
  { name: 'valgus-left-danger', spec: { kneeValgusLeftDeg: 16 } },
  { name: 'recurvatum-lit-warn', spec: { kneeHyperextensionDeg: 6 } },
  { name: 'combined-moderate', spec: { forwardHeadDeg: 8, trunkLeanDeg: 5, shoulderTiltDeg: 2.5, kneeValgusRightDeg: 6 } },
  { name: 'perspective-3m', spec: { forwardHeadDeg: 8, trunkLeanDeg: 5 }, cam: { distanceM: 3 } },
  { name: 'perspective-2m-pitch5', spec: { forwardHeadDeg: 8, trunkLeanDeg: 5 }, cam: { distanceM: 2, pitchDeg: 5 } },
]
