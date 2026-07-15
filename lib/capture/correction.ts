import { rotatePoint } from '@posture-ai/engine/geometry'

export interface CorrectionInput {
  srcW: number
  srcH: number
  /** Sensor roll at capture; null (upload/no sensor) → no rotation (θ=0), center-only. */
  rollDeg: number | null
  /** Support-base anchor, NORMALIZED [0,1] in source space; null → center on image center. */
  anchor: { x: number; y: number } | null
}

export interface CorrectionResult {
  destW: number
  destH: number
  /** Rotation actually applied (rollDeg ?? 0). */
  rotationDeg: number
  /** Map a SOURCE-pixel point → DEST-pixel point (rotate about src center, then A→dest center). */
  toDest(p: { x: number; y: number }): { x: number; y: number }
}

export function computeCorrection(input: CorrectionInput): CorrectionResult {
  const rotationDeg = input.rollDeg ?? 0
  const center = { x: input.srcW / 2, y: input.srcH / 2 }
  const target = input.anchor
    ? { x: input.anchor.x * input.srcW, y: input.anchor.y * input.srcH }
    : center
  const rotatedTarget = rotatePoint(target, rotationDeg, center)
  const rotatedCorners = [
    { x: 0, y: 0 },
    { x: input.srcW, y: 0 },
    { x: 0, y: input.srcH },
    { x: input.srcW, y: input.srcH },
  ].map(corner => rotatePoint(corner, rotationDeg, center))
  const destW = 2 * Math.max(...rotatedCorners.map(corner => Math.abs(corner.x - rotatedTarget.x)))
  const destH = 2 * Math.max(...rotatedCorners.map(corner => Math.abs(corner.y - rotatedTarget.y)))

  return {
    destW,
    destH,
    rotationDeg,
    toDest(p) {
      const rotated = rotatePoint(p, rotationDeg, center)
      return {
        x: rotated.x - rotatedTarget.x + destW / 2,
        y: rotated.y - rotatedTarget.y + destH / 2,
      }
    },
  }
}
