import { Landmark } from './types'

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
