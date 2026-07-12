import type { PostureSpec, CameraSpec } from './synthetic'

export interface GoldenCase {
  name: string
  spec: PostureSpec
  cam?: CameraSpec
  /** When set, emit two profiled side frames (left/right) instead of one legacy
   * side. The aggregate sagittal finding must equal the WORST side, so `spec`
   * carries that worst side's value (its expected deviations are the aggregate's
   * ground truth) while the milder side goes in the other slot. Checked exactly
   * and kept OUT of the accuracy MAE — worst-side selection is a distinct
   * property, and a leaned trunk couples into forward-head, which would score a
   * false error there. */
  sideProfiles?: { left: PostureSpec; right: PostureSpec }
  /** The side the aggregate must select for this case's exercised metric. */
  expectWinner?: 'left' | 'right'
}

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
  // Per-side cases: the aggregate must pick the worse profile. `spec` = worst side.
  { name: 'per-side-fhp-right-worse', spec: { forwardHeadDeg: 8 }, expectWinner: 'right',
    sideProfiles: { left: { forwardHeadDeg: 2 }, right: { forwardHeadDeg: 8 } } },
  { name: 'per-side-trunk-left-worse', spec: { trunkLeanDeg: 9 }, expectWinner: 'left',
    sideProfiles: { left: { trunkLeanDeg: 9 }, right: { trunkLeanDeg: 3 } } },
]
