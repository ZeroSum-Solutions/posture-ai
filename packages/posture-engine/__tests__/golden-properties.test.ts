import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generatePose, generateBurst, expectedDeviations, type PostureSpec } from '../golden/synthetic'
import { assessPosture } from '../src/engine'
import type { PoseFrame } from '../src/types'

const TOL = 0.15
const SPEC: PostureSpec = { trunkLeanDeg: 6, forwardHeadDeg: 10, shoulderTiltDeg: 3, pelvicTiltDeg: 2, kneeValgusLeftDeg: 5 }
const REPORTS = join(__dirname, '..', 'golden', 'reports')

function findingMap(frames: PoseFrame[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of assessPosture(frames).findings) out[f.key] = f.deviation
  return out
}

function scaleFrame(f: PoseFrame, s: number, dx: number, dy: number): PoseFrame {
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [k, lm] of Object.entries(f.landmarks)) {
    landmarks[k] = { ...lm, x: 0.5 + (lm.x - 0.5) * s + dx, y: 0.5 + (lm.y - 0.5) * s + dy }
  }
  return { ...f, landmarks }
}

describe('engine invariance properties (spec §1 Tier A)', () => {
  const base = [generatePose('front', SPEC), generatePose('side', SPEC)]

  it('scale + translation invariance: subject distance must not change any angle', () => {
    const scaled = base.map(f => scaleFrame(f, 0.6, 0.08, -0.05))
    const a = findingMap(base), b = findingMap(scaled)
    for (const key of Object.keys(a)) {
      if (key === 'pelvic_axial_rotation') continue // never scored, z-based
      expect(Math.abs(a[key] - b[key]), key).toBeLessThan(TOL)
    }
  })

  it('roll round-trip: baked-in camera roll + captureRollDeg metadata ≡ level capture', () => {
    const rolled = [
      { ...generatePose('front', SPEC, { rollDeg: 7 }), captureRollDeg: 7 },
      { ...generatePose('side', SPEC, { rollDeg: 7 }), captureRollDeg: 7 },
    ]
    const a = findingMap(base), b = findingMap(rolled)
    for (const key of Object.keys(a)) {
      if (key === 'pelvic_axial_rotation') continue
      expect(Math.abs(a[key] - b[key]), key).toBeLessThan(0.3) // de-rotation is about image center; small residual allowed
    }
  })

  it('noise sensitivity: writes the per-metric σ table and bounds it', () => {
    const RUNS = 60
    const sums: Record<string, number[]> = {}
    for (let i = 0; i < RUNS; i++) {
      const frames = [
        ...generateBurst('front', SPEC, {}, 1, 0.005, 1000 + i),
        ...generateBurst('side', SPEC, {}, 1, 0.005, 5000 + i),
      ]
      for (const [k, v] of Object.entries(findingMap(frames))) (sums[k] ??= []).push(v)
    }
    const table: Record<string, number> = {}
    for (const [k, xs] of Object.entries(sums)) {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length
      table[k] = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1))
    }
    mkdirSync(REPORTS, { recursive: true })
    writeFileSync(join(REPORTS, 'noise-sensitivity.json'), JSON.stringify({ jitterSigma: 0.005, runs: RUNS, sigmaDegByMetric: table }, null, 2))
    // Single-frame σ ceiling per metric at jitter σ=0.005 (image units).
    // Four metrics measure angles over SHORT image-space segments, so landmark
    // noise amplifies analytically (σ ≈ atan(jitter·√2 / segmentLength)):
    // forward_head_posture ear→shoulder ≈ 0.072 units → σ ≈ 5.6–6.1° measured.
    // These ceilings document measured reality (2026-07, engine 1.3.0) and catch
    // EXPLOSION, not drift — production capture medians a multi-frame burst,
    // which the burst-median path (withStability) reduces further.
    const SIGMA_CEILING_DEG: Record<string, number> = {
      forward_head_posture: 7,
      pelvic_obliquity: 5.5,
      genu_varum_valgum_left: 4.5,
      knee_extension_back_knee: 4.5,
    }
    for (const [k, sigma] of Object.entries(table)) {
      if (k === 'pelvic_axial_rotation') continue
      expect(sigma, `metric ${k} explodes under landmark noise`).toBeLessThan(SIGMA_CEILING_DEG[k] ?? 3)
    }
  })

  it('pitch sweep: writes the per-metric error curve (measurement, loose bound)', () => {
    const clean = findingMap(base)
    const curve: Array<{ pitchDeg: number; errorByMetric: Record<string, number> }> = []
    for (const pitch of [0, 5, 10, 15, 20]) {
      const frames = [generatePose('front', SPEC, { pitchDeg: pitch, distanceM: 3 }), generatePose('side', SPEC, { pitchDeg: pitch, distanceM: 3 })]
      const m = findingMap(frames)
      const errorByMetric: Record<string, number> = {}
      for (const key of Object.keys(clean)) {
        if (key === 'pelvic_axial_rotation') continue
        errorByMetric[key] = Math.abs(m[key] - clean[key])
      }
      curve.push({ pitchDeg: pitch, errorByMetric })
    }
    mkdirSync(REPORTS, { recursive: true })
    writeFileSync(join(REPORTS, 'pitch-sensitivity.json'), JSON.stringify({ cameraDistanceM: 3, curve }, null, 2))
    expect(curve.length).toBe(5) // the curve itself is the deliverable; Task 12 applies the spec §2.2 decision rule
  })
})
