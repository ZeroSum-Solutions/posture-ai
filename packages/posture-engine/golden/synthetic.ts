import type { PoseFrame, Landmark } from '../src/types'

export interface PostureSpec {
  trunkLeanDeg?: number
  forwardHeadDeg?: number
  shoulderTiltDeg?: number
  pelvicTiltDeg?: number
  kneeValgusLeftDeg?: number
  kneeValgusRightDeg?: number
  kneeHyperextensionDeg?: number
}

export interface CameraSpec {
  distanceM?: number
  pitchDeg?: number
  rollDeg?: number
  heightM?: number
}

type V3 = [number, number, number] // subject space: +x = subject LEFT, +y = up, +z = anterior
const rad = (d: number) => (d * Math.PI) / 180

/** Neutral standing skeleton (~1.7 m), origin at mid-hip. Ears sit exactly
 * above shoulders and knees exactly on the hip–ankle chord so every metric
 * reads 0 at neutral — ground truth by construction. */
function neutralSkeleton(): Record<string, V3> {
  return {
    nose: [0, 0.62, 0.10],
    left_ear: [0.07, 0.65, 0], right_ear: [-0.07, 0.65, 0],
    left_shoulder: [0.18, 0.47, 0], right_shoulder: [-0.18, 0.47, 0],
    left_hip: [0.09, 0, 0], right_hip: [-0.09, 0, 0],
    left_knee: [0.09, -0.42, 0], right_knee: [-0.09, -0.42, 0],
    left_ankle: [0.09, -0.83, 0], right_ankle: [-0.09, -0.83, 0],
    left_heel: [0.09, -0.87, -0.05], right_heel: [-0.09, -0.87, -0.05],
    left_foot_index: [0.09, -0.87, 0.13], right_foot_index: [-0.09, -0.87, 0.13],
  }
}

/** Rotate p about x-axis through pivot by a (radians): +a moves +y toward +z (anterior). */
function rotX(p: V3, pivot: V3, a: number): V3 {
  const y = p[1] - pivot[1], z = p[2] - pivot[2]
  return [p[0], pivot[1] + y * Math.cos(a) - z * Math.sin(a), pivot[2] + y * Math.sin(a) + z * Math.cos(a)]
}

/** Rotate p about z-axis through pivot by a (radians) in the frontal (x-y) plane. */
function rotZ(p: V3, pivot: V3, a: number): V3 {
  const x = p[0] - pivot[0], y = p[1] - pivot[1]
  return [pivot[0] + x * Math.cos(a) - y * Math.sin(a), pivot[1] + x * Math.sin(a) + y * Math.cos(a), p[2]]
}

function applyPosture(P: Record<string, V3>, s: PostureSpec): Record<string, V3> {
  const out: Record<string, V3> = { ...P }
  const midHip: V3 = [0, 0, 0]
  const upper = ['nose', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder']

  if (s.trunkLeanDeg) {
    for (const k of upper) out[k] = rotX(out[k], midHip, rad(s.trunkLeanDeg))
  }
  if (s.forwardHeadDeg) {
    const midShoulder: V3 = [
      (out.left_shoulder[0] + out.right_shoulder[0]) / 2,
      (out.left_shoulder[1] + out.right_shoulder[1]) / 2,
      (out.left_shoulder[2] + out.right_shoulder[2]) / 2,
    ]
    for (const k of ['nose', 'left_ear', 'right_ear']) out[k] = rotX(out[k], midShoulder, rad(s.forwardHeadDeg))
  }
  // + = subject's LEFT lower ⇒ rotate the pair by −deg about the segment midpoint.
  if (s.shoulderTiltDeg) {
    const mid: V3 = [0, 0.47, 0]
    out.left_shoulder = rotZ(out.left_shoulder, mid, -rad(s.shoulderTiltDeg))
    out.right_shoulder = rotZ(out.right_shoulder, mid, -rad(s.shoulderTiltDeg))
  }
  if (s.pelvicTiltDeg) {
    const mid: V3 = [0, 0, 0]
    out.left_hip = rotZ(out.left_hip, mid, -rad(s.pelvicTiltDeg))
    out.right_hip = rotZ(out.right_hip, mid, -rad(s.pelvicTiltDeg))
  }
  // Knee deviation d places the knee off the hip–ankle chord so the interior
  // bend angle is exactly 180−d: lateral offset = halfLen · tan(d/2).
  const halfLen = 0.415
  if (s.kneeValgusLeftDeg) out.left_knee = [0.09 - halfLen * Math.tan(rad(s.kneeValgusLeftDeg) / 2), -0.42, 0]
  if (s.kneeValgusRightDeg) out.right_knee = [-0.09 + halfLen * Math.tan(rad(s.kneeValgusRightDeg) / 2), -0.42, 0]
  if (s.kneeHyperextensionDeg) {
    const off = -halfLen * Math.tan(rad(s.kneeHyperextensionDeg) / 2) // posterior = −z
    out.left_knee = [out.left_knee[0], -0.42, off]
    out.right_knee = [out.right_knee[0], -0.42, off]
  }
  return out
}

/** View transform: front = subject faces camera; side = subject anterior → image-right. */
function toViewSpace(p: V3, view: 'front' | 'side'): V3 {
  if (view === 'front') return p
  // yaw −90° about y: (x, y, z) → (z, y, −x); anterior (+z) → +x (image right)
  return [p[2], p[1], -p[0]]
}

/** Project view-space point to normalized image coords (MediaPipe-style: x right,
 * y DOWN). Front view maps subject-left (+x) to larger image x, matching the
 * MediaPipe convention asserted in metrics.ts:70. */
function project(p: V3, cam: Required<CameraSpec>): Landmark {
  const SCALE = 0.4
  const [x, y0, z0] = p
  let y = y0, z = z0
  // camera pitch: rotate world about the x-axis at camera height by −pitch
  if (cam.pitchDeg !== 0) {
    const a = -rad(cam.pitchDeg)
    const yy = y - cam.heightM, zz = z
    y = cam.heightM + yy * Math.cos(a) - zz * Math.sin(a)
    z = yy * Math.sin(a) + zz * Math.cos(a)
  }
  let xi: number, yi: number
  if (!Number.isFinite(cam.distanceM)) {
    xi = 0.5 + x * SCALE
    yi = 0.5 - (y - cam.heightM) * SCALE
  } else {
    const depth = cam.distanceM - z
    const f = cam.distanceM // focal chosen so orthographic ≈ perspective at z=0
    xi = 0.5 + (x * f / depth) * SCALE
    yi = 0.5 - ((y - cam.heightM) * f / depth) * SCALE
  }
  if (cam.rollDeg !== 0) {
    const a = -rad(cam.rollDeg)
    const rx = xi - 0.5, ry = yi - 0.5
    xi = 0.5 + rx * Math.cos(a) - ry * Math.sin(a)
    yi = 0.5 + rx * Math.sin(a) + ry * Math.cos(a)
  }
  return { x: xi, y: yi, z: 0, visibility: 1 }
}

export function generatePose(
  view: 'front' | 'side',
  spec: PostureSpec = {},
  cam: CameraSpec = {},
  profileSide?: 'left' | 'right',
): PoseFrame {
  const c: Required<CameraSpec> = {
    distanceM: cam.distanceM ?? Infinity,
    pitchDeg: cam.pitchDeg ?? 0,
    rollDeg: cam.rollDeg ?? 0,
    heightM: cam.heightM ?? 0,
  }
  const pts = applyPosture(neutralSkeleton(), spec)
  const landmarks: Record<string, Landmark> = {}
  for (const [name, p] of Object.entries(pts)) landmarks[name] = project(toViewSpace(p, view), c)
  return { view, landmarks, source: 'camera', ...(profileSide ? { profileSide } : {}) }
}

/** Deterministic LCG so bursts are reproducible without Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32)
}

/** Box–Muller gaussian on the LCG. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12), v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function generateBurst(
  view: 'front' | 'side', spec: PostureSpec, cam: CameraSpec, n: number, jitterSigma: number, seed: number,
): PoseFrame[] {
  const rand = lcg(seed)
  return Array.from({ length: n }, () => {
    const frame = generatePose(view, spec, cam)
    const jittered: Record<string, Landmark> = {}
    for (const [name, lm] of Object.entries(frame.landmarks)) {
      jittered[name] = { ...lm, x: lm.x + gaussian(rand) * jitterSigma, y: lm.y + gaussian(rand) * jitterSigma }
    }
    return { ...frame, landmarks: jittered }
  })
}

/** Expected per-metric deviations implied by a spec (orthographic ground truth). */
export function expectedDeviations(spec: PostureSpec): Record<string, number> {
  return {
    forward_head_posture: spec.forwardHeadDeg ?? 0,
    anterior_imbalanced_shoulders: Math.abs(spec.shoulderTiltDeg ?? 0),
    posterior_imbalanced_shoulders: Math.abs(spec.shoulderTiltDeg ?? 0),
    trunk_lean: Math.abs(spec.trunkLeanDeg ?? 0),
    pelvic_obliquity: Math.abs(spec.pelvicTiltDeg ?? 0),
    genu_varum_valgum_left: spec.kneeValgusLeftDeg ?? 0,
    genu_varum_valgum_right: spec.kneeValgusRightDeg ?? 0,
    knee_extension_back_knee: spec.kneeHyperextensionDeg ?? 0,
  }
}
