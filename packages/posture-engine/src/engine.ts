import { PoseFrame, AssessmentResult, ViewLabel, Finding } from './types'
import { normalizeFrame } from './geometry'
import { medianFrame, deviationSpread, stabilityFromSigma } from './stability'
import {
  forwardHeadPosture, anteriorImbalancedShoulders, posteriorImbalancedShoulders,
  trunkLean, pelvicObliquity, pelvicAxialRotation,
  genuVarumValgumLeft, genuVarumValgumRight, kneeExtensionBackKnee
} from './metrics'
import { toGrade, metricValidity, VALIDITY_WEIGHT, distanceToZoneEdge } from './thresholds'
import { aggregateSagittal } from './sides'

// 2.0.0: trunk_lean merge — t1_tilt_backward + anterior_pelvic_shift were the identical shoulder→hip vector scored twice; now one finding.
// 1.3.0: multi-frame capture bursts — robust per-landmark median point estimate
// + per-finding within-capture stability (uncertaintyDeg / stabilityScore) and
// AssessmentResult.captureStability. Single-frame-per-view input is unchanged.
// 1.2.0: recurvatum metric fixed (STANDARD 175→180, facing-aware direction) +
// boundary-level threshold provenance; knee_extension danger 15→10 (cited).
export const ENGINE_VERSION = '2.1.0'

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Attach within-capture stability to a finding from the spread of its own
 * deviation across the burst. A single-frame burst carries no spread, so the
 * finding passes through unchanged (no fabricated stability).
 */
function withStability(
  rep: Finding | null,
  burst: PoseFrame[],
  deviationOf: (f: PoseFrame) => number,
): Finding | null {
  if (!rep || burst.length < 2) return rep
  const sigma = deviationSpread(burst.map(deviationOf))
  const borderline = rep.reliable && sigma > 0 && distanceToZoneEdge(rep.deviation, rep.key) < sigma
  return {
    ...rep,
    uncertaintyDeg: round2(sigma),
    stabilityScore: round2(stabilityFromSigma(sigma)),
    ...(borderline ? { borderline: true } : {}),
  }
}

/** Compute a single-view metric on the burst's median frame + its stability. */
function aggregate(burst: PoseFrame[], metric: (f: PoseFrame) => Finding): Finding | null {
  if (burst.length === 0) return null
  const rep = metric(burst.length === 1 ? burst[0] : medianFrame(burst))
  return withStability(rep, burst, (f) => metric(f).deviation)
}

export const DISCLAIMER =
  'SCREENING ONLY — Not a medical diagnosis. These findings are for educational and screening purposes only. ' +
  'Results require interpretation by qualified professionals. Do not substitute for clinical examination.'

export function assessPosture(rawFrames: PoseFrame[]): AssessmentResult {
  // Single insertion point: every metric below consumes aspect-corrected,
  // de-rotated landmarks (spec §4.4). Frames without metadata pass through.
  const frames = rawFrames.map(normalizeFrame)
  const tiltCorrected = rawFrames.some(f => (f.captureRollDeg ?? 0) !== 0)
  // Uploads can never be sensor-verified, even if a client supplies a roll.
  const levelVerified = rawFrames.length > 0 &&
    rawFrames.every(f => f.captureRollDeg !== undefined && f.source !== 'upload')

  // Group frames by view: 1 frame/view is the legacy path (median-of-one is a
  // no-op); >1 is a capture burst that drives the robust median + stability.
  const front = frames.filter(f => f.view === 'front')
  const side = frames.filter(f => f.view === 'side')
  const back = frames.filter(f => f.view === 'back')

  // Side profiles: score each captured side independently, then keep the worst
  // per metric (spec §11.2), preserving per-side burst stability via aggregate().
  // Validation rejects mixing unspecified-side with named-side frames, so when
  // !hasProfiles every side frame is legacy → scoring is byte-identical to before.
  const sideLeft = side.filter(f => f.profileSide === 'left')
  const sideRight = side.filter(f => f.profileSide === 'right')
  const hasProfiles = sideLeft.length > 0 || sideRight.length > 0
  const sag = (m: (f: PoseFrame, s?: 'left' | 'right') => Finding): Finding | null => {
    if (!hasProfiles) return aggregate(side, (f) => m(f))
    const l = sideLeft.length ? aggregate(sideLeft, (f) => m(f, 'left')) : null
    const r = sideRight.length ? aggregate(sideRight, (f) => m(f, 'right')) : null
    return aggregateSagittal(l ? { finding: l, side: 'left' } : null, r ? { finding: r, side: 'right' } : null)
  }

  const missingViews: ViewLabel[] = []
  if (front.length === 0) missingViews.push('front')
  if (side.length === 0) missingViews.push('side')

  // Posterior shoulders read the back view if present, else the front; the
  // stability burst follows the same choice (the second arg is the paired frame).
  const postBurst = back.length ? back : front
  const backRep = back.length ? medianFrame(back) : undefined
  const frontRep = front.length ? medianFrame(front) : undefined
  const posteriorRep = postBurst.length
    ? posteriorImbalancedShoulders(backRep ?? frontRep!, backRep)
    : null

  // Compute all findings (degrade gracefully if views missing)
  const findings = [
    sag(forwardHeadPosture),
    aggregate(front, anteriorImbalancedShoulders),
    withStability(posteriorRep, postBurst, f => posteriorImbalancedShoulders(f, back.length ? f : undefined).deviation),
    sag(trunkLean),
    aggregate(front, pelvicObliquity),
    aggregate(front, pelvicAxialRotation),
    aggregate(front, genuVarumValgumLeft),
    aggregate(front, genuVarumValgumRight),
    sag(kneeExtensionBackKnee),
  ].filter((f): f is Finding => f !== null)

  // Overall score (spec §3.2): validity- and confidence-weighted mean of
  // severityPct over reliable findings. weight = VALIDITY_WEIGHT[validity] ×
  // landmarkConfidence (the finding's 0–1 visibility-derived confidence).
  const reliable = findings.filter(f => f.reliable)
  const weightOf = (f: Finding) => VALIDITY_WEIGHT[metricValidity(f.key)] * f.confidence
  const totalWeight = reliable.reduce((a, f) => a + weightOf(f), 0)
  const overallScore = totalWeight > 0
    ? Math.round(reliable.reduce((a, f) => a + f.severityPct * weightOf(f), 0) / totalWeight)
    : 0

  const overallGrade = toGrade(overallScore)

  // Per-view severity index: rounded arithmetic mean of reliable findings'
  // severityPct values. Lower is better; null means the view has no reliable
  // findings. This is not a population statistic.
  const frontFindings = reliable.filter(f => f.viewUsed === 'front')
  const sideFindings = reliable.filter(f => f.viewUsed === 'side')
  const frontScore = frontFindings.length > 0
    ? frontFindings.reduce((a, f) => a + f.severityPct, 0) / frontFindings.length
    : 0
  const sideScore = sideFindings.length > 0
    ? sideFindings.reduce((a, f) => a + f.severityPct, 0) / sideFindings.length
    : 0

  const frontSeverityIndex = frontFindings.length > 0 ? Math.max(1, Math.round(frontScore)) : null
  const sideSeverityIndex = sideFindings.length > 0 ? Math.max(1, Math.round(sideScore)) : null

  // Capture-level stability: mean of the reliable findings that had a burst.
  // null when every view was single-frame (nothing to average — never faked).
  const burstStabilities = reliable
    .map(f => f.stabilityScore)
    .filter((s): s is number => s !== undefined)
  const captureStability = burstStabilities.length > 0
    ? round2(burstStabilities.reduce((a, s) => a + s, 0) / burstStabilities.length)
    : null

  return {
    findings,
    overallScore,
    overallGrade,
    viewSeverityIndex: { front: frontSeverityIndex, side: sideSeverityIndex },
    ranks: { front: frontSeverityIndex, side: sideSeverityIndex },
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    disclaimer: DISCLAIMER,
    missingViews,
    tiltCorrected,
    captureStability,
    levelVerified,
  }
}
