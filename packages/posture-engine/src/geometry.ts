import { Landmark, PoseFrame } from './types'

/** Angle in degrees at vertex b, formed by points a-b-c */
export function angle2D(a: Landmark, b: Landmark, c: Landmark): number {
  const v1x = a.x - b.x, v1y = a.y - b.y
  const v2x = c.x - b.x, v2y = c.y - b.y
  const dot = v1x * v2x + v1y * v2y
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)
  if (mag1 < 1e-9 || mag2 < 1e-9) return 180
  return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI)
}

/** Angle in degrees of line p1->p2 from horizontal (positive = tilts right-down) */
export function angleLine2D(p1: Landmark, p2: Landmark): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI)
}

/** Angle in degrees of the vector (dx, dy) from the downward vertical */
export function angleFromVertical(dx: number, dy: number): number {
  return Math.atan2(dx, dy) * (180 / Math.PI)
}

/** Midpoint of two landmarks */
export function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  }
}

/** Minimum visibility of provided landmarks */
export function minVis(...lms: (Landmark | undefined)[]): number {
  return Math.min(...lms.map(l => l?.visibility ?? 0))
}

const DEG2RAD = Math.PI / 180

/**
 * Rotate a point about a pivot in y-down screen coordinates.
 * thetaDeg follows the captureRollDeg convention: applying θ = captureRollDeg
 * undoes the apparent scene rotation caused by a camera rolled by θ
 * (positive = phone top tilted to the photographer's right).
 * Returns a new Landmark; never mutates the input.
 */
export function rotatePoint(
  p: Landmark,
  thetaDeg: number,
  pivot: { x: number; y: number }
): Landmark {
  const t = thetaDeg * DEG2RAD
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return { ...p, x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
}

/**
 * Map a frame into a square, level reference space:
 *  - aspect-correct: x' = x * aspectRatio so both axes share a physical scale
 *  - de-rotate: rotate landmarks by captureRollDeg about the image centre so a
 *    photo taken with a rolled camera reads as if the camera were level
 * Frames without metadata pass through unchanged (aspect defaults to 1, roll
 * to 0), so historical payloads and fixtures keep their exact scores.
 * Returns a new frame; never mutates the input.
 */
export function normalizeFrame(frame: PoseFrame): PoseFrame {
  const aspect = frame.aspectRatio ?? 1
  const roll = frame.captureRollDeg ?? 0
  if (aspect === 1 && roll === 0) return frame
  const pivot = { x: 0.5 * aspect, y: 0.5 }
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [name, lm] of Object.entries(frame.landmarks)) {
    const scaled = aspect === 1 ? lm : { ...lm, x: lm.x * aspect }
    // When roll === 0, aspect !== 1 (the fast-path handled the no-op case),
    // so `scaled` is already a fresh object — safe to use directly.
    landmarks[name] = roll === 0 ? scaled : rotatePoint(scaled, roll, pivot)
  }
  return { ...frame, landmarks }
}
