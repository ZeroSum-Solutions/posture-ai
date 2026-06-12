// Pure sensor math for the camera level gate. No DOM access — unit-testable.

export interface RollPitch {
  /** Camera roll in degrees. Positive = phone top tilted to the photographer's right. */
  rollDeg: number
  /** Camera pitch off the horizontal aim, degrees. 0 = aimed straight ahead. */
  pitchDeg: number
}

const RAD2DEG = 180 / Math.PI

/**
 * Reconstruct roll/pitch from W3C deviceorientation beta/gamma by projecting
 * gravity into device coordinates: g = (cosβ·sinγ, −sinβ, −cosβ·cosγ).
 * This avoids the Euler gimbal lock at β≈90° (upright portrait), where raw
 * gamma is unstable; the gravity projection is exact for any orientation.
 *
 * @param betaDeg  W3C beta angle in degrees; assumed range [−180, 180].
 * @param gammaDeg W3C gamma angle in degrees; assumed range [−90, 90].
 *   Non-finite input propagates to NaN by design (callers guard null/undefined).
 */
export function rollPitchFromOrientation(betaDeg: number, gammaDeg: number): RollPitch {
  const b = betaDeg / RAD2DEG
  const gam = gammaDeg / RAD2DEG
  const gx = Math.cos(b) * Math.sin(gam)
  const gy = -Math.sin(b)
  const gz = -Math.cos(b) * Math.cos(gam)
  const rollDeg = Math.atan2(gx, -gy) * RAD2DEG
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, -gz))) * RAD2DEG
  return { rollDeg, pitchDeg }
}
