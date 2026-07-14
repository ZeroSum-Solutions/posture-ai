import type { Landmark, PoseFrame } from '@posture-ai/engine/types'
import { RELIABILITY_FLOOR } from '@posture-ai/engine/thresholds'
import { supportAnchorX } from '../capture/support-anchor'
import { ANKLE_LANDMARKS, HEAD_LANDMARKS, requiredNearSideJoints } from './quality'

export interface QualityScore {
  score: number
  factors: { framing: number; joints: number; level: number }
  warnings: string[]
  blocked: boolean
}

type QualityView = 'front' | 'side' | 'back'

const FRAME_SPAN_FULL_MIN = 0.65
const FRAME_SPAN_FULL_MAX = 0.95
const FRAME_SPAN_ZERO_MIN = 0.45
const FRAME_SPAN_ZERO_MAX = 1.10
const CENTER_FULL_MAX = 0.15
const CENTER_ZERO_MAX = 0.35

function isVisible(landmark: Landmark | undefined): landmark is Landmark {
  return !!landmark && (landmark.visibility ?? 0) >= RELIABILITY_FLOOR
}

function clampSubscore(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

function scoreJoints(
  frame: PoseFrame,
  requiredJoints: string[],
  warnings: string[],
): number {
  let visibleCount = 0
  for (const name of requiredJoints) {
    if (isVisible(frame.landmarks[name])) {
      visibleCount += 1
    } else {
      warnings.push(`Required joint not visible: ${name}.`)
    }
  }
  return clampSubscore((visibleCount / requiredJoints.length) * 35, 35)
}

function scoreSpan(frame: PoseFrame, warnings: string[]): number {
  const headYs = HEAD_LANDMARKS
    .map(name => frame.landmarks[name])
    .filter(isVisible)
    .map(landmark => landmark.y)
  const ankleYs = ANKLE_LANDMARKS
    .map(name => frame.landmarks[name])
    .filter(isVisible)
    .map(landmark => landmark.y)

  if (headYs.length === 0) {
    warnings.push('No visible head landmark — framing span unavailable.')
  }
  if (ankleYs.length === 0) {
    warnings.push('No visible ankle landmark — framing span unavailable.')
  }
  if (headYs.length === 0 || ankleYs.length === 0) return 0

  const span = Math.max(...ankleYs) - Math.min(...headYs)
  if (span >= FRAME_SPAN_FULL_MIN && span <= FRAME_SPAN_FULL_MAX) return 15
  if (span <= FRAME_SPAN_ZERO_MIN || span >= FRAME_SPAN_ZERO_MAX) return 0
  if (span < FRAME_SPAN_FULL_MIN) {
    return clampSubscore(
      ((span - FRAME_SPAN_ZERO_MIN) / (FRAME_SPAN_FULL_MIN - FRAME_SPAN_ZERO_MIN)) * 15,
      15,
    )
  }
  return clampSubscore(
    ((FRAME_SPAN_ZERO_MAX - span) / (FRAME_SPAN_ZERO_MAX - FRAME_SPAN_FULL_MAX)) * 15,
    15,
  )
}

function scoreCentering(frame: PoseFrame, warnings: string[]): number {
  const anchorX = supportAnchorX(frame.landmarks)
  if (anchorX === null) {
    warnings.push('Support anchor unavailable — centering score unavailable.')
    return 0
  }

  const distance = Math.abs(anchorX - 0.5)
  if (distance <= CENTER_FULL_MAX) return 15
  if (distance >= CENTER_ZERO_MAX) return 0
  return clampSubscore(
    ((CENTER_ZERO_MAX - distance) / (CENTER_ZERO_MAX - CENTER_FULL_MAX)) * 15,
    15,
  )
}

function scoreInFrame(
  frame: PoseFrame,
  requiredJoints: string[],
  warnings: string[],
): number {
  let inFrameCount = 0
  for (const name of requiredJoints) {
    const landmark = frame.landmarks[name]
    if (!isVisible(landmark)) continue
    if (landmark.x >= 0 && landmark.x <= 1 && landmark.y >= 0 && landmark.y <= 1) {
      inFrameCount += 1
    } else {
      warnings.push(`Required joint outside frame: ${name}.`)
    }
  }
  return clampSubscore((inFrameCount / requiredJoints.length) * 10, 10)
}

function scoreFraming(
  frame: PoseFrame,
  requiredJoints: string[],
  warnings: string[],
): number {
  return clampSubscore(
    scoreSpan(frame, warnings) +
      scoreCentering(frame, warnings) +
      scoreInFrame(frame, requiredJoints, warnings),
    40,
  )
}

function scoreLevel(rollDeg: number | null, warnings: string[]): number {
  if (rollDeg === null) {
    warnings.push('Level unverified — sensor roll is unavailable.')
    return 18
  }

  const absoluteRoll = Math.abs(rollDeg)
  if (absoluteRoll <= 2) return 25
  if (absoluteRoll <= 5) {
    return clampSubscore(25 - ((absoluteRoll - 2) / 3) * 13, 25)
  }
  return clampSubscore(12 - ((absoluteRoll - 5) / 5) * 12, 25)
}

export function scoreFrameQuality(
  frame: PoseFrame,
  view: QualityView,
  profileSide: 'left' | 'right' | undefined,
  rollDeg: number | null,
): QualityScore {
  const warnings: string[] = []
  const requiredJoints = requiredNearSideJoints(view, profileSide)
  const joints = scoreJoints(frame, requiredJoints, warnings)
  const framing = scoreFraming(frame, requiredJoints, warnings)
  const level = scoreLevel(rollDeg, warnings)

  return {
    score: joints + framing + level,
    factors: { framing, joints, level },
    warnings,
    blocked: Object.keys(frame.landmarks).length < 4 && (view === 'front' || view === 'side'),
  }
}
