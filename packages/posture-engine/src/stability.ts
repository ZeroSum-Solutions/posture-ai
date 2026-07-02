import { Landmark, PoseFrame } from './types'

/** Median of a numeric array (0 for empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Sample standard deviation (1σ, degrees) of a finding's deviation across the
 * burst. Returns 0 for < 2 samples (no spread is estimable from one frame — we
 * never fabricate uncertainty). Note we deliberately use the (non-robust) SD, not
 * MAD, for the spread: the robust MEDIAN already gives the outlier-proof point
 * estimate, so the *uncertainty* should still reflect a jittery frame — a capture
 * with one wild detection is genuinely less stable and should read that way.
 */
export function deviationSpread(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

/**
 * Per-landmark median frame across a capture burst. The median is inherently
 * robust to an outlier frame (a jittered detection can't move the middle value),
 * so this is the point-estimate that a wobbly frame cannot corrupt. Returns the
 * sole frame unchanged for a single-frame burst (byte-identical legacy behaviour).
 * Never mutates inputs.
 */
export function medianFrame(frames: PoseFrame[]): PoseFrame {
  if (frames.length === 1) return frames[0]
  const names = new Set<string>()
  for (const f of frames) for (const n of Object.keys(f.landmarks)) names.add(n)
  const landmarks: Record<string, Landmark> = {}
  for (const name of names) {
    const present = frames.map((f) => f.landmarks[name]).filter((l): l is Landmark => Boolean(l))
    if (present.length === 0) continue
    const hasZ = present.some((l) => l.z !== undefined)
    landmarks[name] = {
      x: median(present.map((l) => l.x)),
      y: median(present.map((l) => l.y)),
      ...(hasZ ? { z: median(present.map((l) => l.z ?? 0)) } : {}),
      visibility: median(present.map((l) => l.visibility ?? 0)),
    }
  }
  return { ...frames[0], landmarks }
}

// Deviation spread (σ, degrees) at/above which within-capture stability reads 0.
// 5° of jitter on a screening angle is already "don't trust this to the degree".
const STABILITY_SCALE_DEG = 5

/** Map a deviation spread (σ, degrees) to a 0..1 stability score (1 = rock-steady). */
export function stabilityFromSigma(sigmaDeg: number): number {
  return Math.max(0, Math.min(1, 1 - sigmaDeg / STABILITY_SCALE_DEG))
}
