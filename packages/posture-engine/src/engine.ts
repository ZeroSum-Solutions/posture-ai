import { PoseFrame, AssessmentResult, OverallGrade, ViewLabel } from './types'
import {
  forwardHeadPosture, anteriorImbalancedShoulders, posteriorImbalancedShoulders,
  t1TiltBackward, pelvicObliquity, anteriorPelvicShift, pelvicAxialRotation,
  genuVarumValgumLeft, genuVarumValgumRight, kneeExtensionBackKnee
} from './metrics'
import { toGrade, toPercentile } from './thresholds'

export const ENGINE_VERSION = '1.0.0'

export const DISCLAIMER =
  'SCREENING ONLY — Not a medical diagnosis. These findings are for educational and screening purposes only. ' +
  'Results require interpretation by qualified professionals. Do not substitute for clinical examination.'

export function assessPosture(frames: PoseFrame[]): AssessmentResult {
  const front = frames.find(f => f.view === 'front')
  const side = frames.find(f => f.view === 'side')
  const back = frames.find(f => f.view === 'back')

  const missingViews: ViewLabel[] = []
  if (!front) missingViews.push('front')
  if (!side) missingViews.push('side')

  // Compute all findings (degrade gracefully if views missing)
  const findings = [
    side ? forwardHeadPosture(side) : null,
    front ? anteriorImbalancedShoulders(front) : null,
    (front || back) ? posteriorImbalancedShoulders(front ?? back!, back) : null,
    side ? t1TiltBackward(side) : null,
    front ? pelvicObliquity(front) : null,
    side ? anteriorPelvicShift(side) : null,
    front ? pelvicAxialRotation(front) : null,
    front ? genuVarumValgumLeft(front) : null,
    front ? genuVarumValgumRight(front) : null,
    side ? kneeExtensionBackKnee(side) : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null)

  // Overall score: average severityPct of reliable findings (0-100, higher = worse)
  const reliable = findings.filter(f => f.reliable)
  const overallScore = reliable.length > 0
    ? Math.round(reliable.reduce((acc, f) => acc + f.severityPct, 0) / reliable.length)
    : 0

  const overallGrade = toGrade(overallScore)
  const overallPercentile = toPercentile(overallScore)

  // Modeled per-view ranks (1-100, lower = worse)
  const frontFindings = reliable.filter(f => f.viewUsed === 'front')
  const sideFindings = reliable.filter(f => f.viewUsed === 'side')
  const frontScore = frontFindings.length > 0
    ? frontFindings.reduce((a, f) => a + f.severityPct, 0) / frontFindings.length
    : 0
  const sideScore = sideFindings.length > 0
    ? sideFindings.reduce((a, f) => a + f.severityPct, 0) / sideFindings.length
    : 0

  // Rank: top X% of modeled population (lower number = better rank)
  // null = no reliable findings for this view (don't fabricate a "best" rank)
  const frontRank = frontFindings.length > 0 ? Math.max(1, Math.round(frontScore)) : null
  const sideRank = sideFindings.length > 0 ? Math.max(1, Math.round(sideScore)) : null

  return {
    findings,
    overallScore,
    overallGrade,
    overallPercentile,
    ranks: { front: frontRank, side: sideRank },
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    disclaimer: DISCLAIMER,
    missingViews,
  }
}
