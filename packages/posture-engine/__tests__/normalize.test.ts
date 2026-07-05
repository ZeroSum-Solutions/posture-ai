import { describe, it, expect } from 'vitest'
import type { PoseFrame, Landmark } from '../src/types'
import { rotatePoint, normalizeFrame } from '../src/geometry'
import { assessPosture, testLandmarksFrames } from '../src'

const EPS = 1e-6

function close(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps
}

describe('rotatePoint', () => {
  it('rotates 90° about the pivot in y-down screen coords', () => {
    // Point directly ABOVE the pivot (dy = -0.3). θ=90 → dx' = -dy·sin90 = +0.3
    const p = rotatePoint({ x: 0.5, y: 0.2 }, 90, { x: 0.5, y: 0.5 })
    expect(close(p.x, 0.8)).toBe(true)
    expect(close(p.y, 0.5)).toBe(true)
  })

  it('round-trips: rotate by θ then −θ returns the original point', () => {
    const orig: Landmark = { x: 0.37, y: 0.81, z: 0.1, visibility: 0.9 }
    const there = rotatePoint(orig, 12.5, { x: 0.375, y: 0.5 })
    const back = rotatePoint(there, -12.5, { x: 0.375, y: 0.5 })
    expect(close(back.x, orig.x)).toBe(true)
    expect(close(back.y, orig.y)).toBe(true)
  })

  it('does not mutate the input and preserves z/visibility', () => {
    const orig: Landmark = { x: 0.4, y: 0.6, z: -0.2, visibility: 0.7 }
    const out = rotatePoint(orig, 30, { x: 0.5, y: 0.5 })
    expect(orig).toEqual({ x: 0.4, y: 0.6, z: -0.2, visibility: 0.7 })
    expect(out).not.toBe(orig)
    expect(out.z).toBe(-0.2)
    expect(out.visibility).toBe(0.7)
  })
})

describe('normalizeFrame', () => {
  it('returns the same frame reference when no aspectRatio and no roll', () => {
    const f: PoseFrame = { view: 'front', landmarks: { nose: { x: 0.5, y: 0.1 } } }
    expect(normalizeFrame(f)).toBe(f)
  })

  it('aspect-corrects x by width/height and leaves y unchanged', () => {
    const f: PoseFrame = {
      view: 'front',
      aspectRatio: 0.75,
      landmarks: { nose: { x: 0.4, y: 0.3, visibility: 0.9 } },
    }
    const out = normalizeFrame(f)
    expect(close(out.landmarks.nose.x, 0.3)).toBe(true)
    expect(close(out.landmarks.nose.y, 0.3)).toBe(true)
    // input untouched
    expect(f.landmarks.nose.x).toBe(0.4)
  })

  it('de-rotates by captureRollDeg about the aspect-corrected centre', () => {
    // A vertical subject photographed with the camera rolled +10°
    // (top tilted right) appears tilted: head drifts LEFT of feet.
    // Simulate by applying the INVERSE rotation, then expect normalizeFrame
    // to restore verticality.
    const pivot = { x: 0.5, y: 0.5 } // aspect 1
    const headLevel: Landmark = { x: 0.5, y: 0.2, visibility: 0.9 }
    const feetLevel: Landmark = { x: 0.5, y: 0.9, visibility: 0.9 }
    const tilted: PoseFrame = {
      view: 'side',
      captureRollDeg: 10,
      landmarks: {
        left_ear: rotatePoint(headLevel, -10, pivot),
        left_ankle: rotatePoint(feetLevel, -10, pivot),
      },
    }
    // sanity: simulated tilt drifts the head left of the feet
    expect(tilted.landmarks.left_ear.x).toBeLessThan(tilted.landmarks.left_ankle.x)
    const out = normalizeFrame(tilted)
    expect(close(out.landmarks.left_ear.x, 0.5)).toBe(true)
    expect(close(out.landmarks.left_ear.y, 0.2)).toBe(true)
    expect(close(out.landmarks.left_ankle.x, 0.5)).toBe(true)
    expect(close(out.landmarks.left_ankle.y, 0.9)).toBe(true)
  })

  it('applies aspect correction before de-rotation about the scaled-centre pivot (combined path)', () => {
    // landmark (0.4, 0.2) on a 3:4 image with the camera rolled +10°:
    // scaled x = 0.4·0.75 = 0.3; rotate by +10° about (0.375, 0.5).
    // Hand-computed: x' = 0.375 + (−0.075·cos10° − (−0.3)·sin10°) ≈ 0.3532339
    //                y' = 0.5  + (−0.075·sin10° + (−0.3)·cos10°) ≈ 0.1915341
    const f: PoseFrame = {
      view: 'front',
      aspectRatio: 0.75,
      captureRollDeg: 10,
      landmarks: { nose: { x: 0.4, y: 0.2, visibility: 0.9 } },
    }
    const out = normalizeFrame(f)
    expect(close(out.landmarks.nose.x, 0.3532339)).toBe(true)
    expect(close(out.landmarks.nose.y, 0.1915341)).toBe(true)
  })

  it('keeps view/metadata fields on the returned frame', () => {
    const f: PoseFrame = {
      view: 'side', aspectRatio: 0.75, captureRollDeg: 3, source: 'camera',
      landmarks: { nose: { x: 0.5, y: 0.1 } },
    }
    const out = normalizeFrame(f)
    expect(out.view).toBe('side')
    expect(out.captureRollDeg).toBe(3)
    expect(out.aspectRatio).toBe(0.75)
    expect(out.source).toBe('camera')
  })
})

// Helper: simulate a photo of `frame`'s scene taken with a camera rolled by
// rollDeg on an image with the given aspect ratio. Works in corrected space
// (x·aspect), applies the inverse rotation, then maps back to image space.
function simulateTiltedCapture(frame: PoseFrame, rollDeg: number, aspect: number): PoseFrame {
  const pivot = { x: 0.5 * aspect, y: 0.5 }
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [name, lm] of Object.entries(frame.landmarks)) {
    const corrected = { ...lm, x: lm.x * aspect }
    const tilted = rotatePoint(corrected, -rollDeg, pivot)
    landmarks[name] = { ...tilted, x: tilted.x / aspect }
  }
  return { ...frame, landmarks, captureRollDeg: rollDeg, aspectRatio: aspect }
}

describe('assessPosture tilt correction (engine equivalence)', () => {
  const levelFrames = testLandmarksFrames.map(f => ({ ...f, aspectRatio: 0.75 }))

  it('a tilted capture with matching captureRollDeg scores identically to the level capture', () => {
    const tiltedFrames = testLandmarksFrames.map(f => simulateTiltedCapture(f, 4.2, 0.75))
    const level = assessPosture(levelFrames)
    const tilted = assessPosture(tiltedFrames)
    expect(tilted.findings.length).toBe(level.findings.length)
    tilted.findings.forEach((f, i) => {
      expect(f.key).toBe(level.findings[i].key)
      expect(Math.abs(f.deviation - level.findings[i].deviation)).toBeLessThan(1e-6)
      expect(f.zone).toBe(level.findings[i].zone)
    })
    expect(tilted.overallScore).toBe(level.overallScore)
  })

  it('flags: tiltCorrected true / levelVerified true when all frames carry a roll', () => {
    const tiltedFrames = testLandmarksFrames.map(f => simulateTiltedCapture(f, 3, 0.75))
    const r = assessPosture(tiltedFrames)
    expect(r.tiltCorrected).toBe(true)
    expect(r.levelVerified).toBe(true)
  })

  it('flags: measured-level capture (roll 0) is levelVerified but not tiltCorrected', () => {
    const frames = testLandmarksFrames.map(f => ({ ...f, captureRollDeg: 0, aspectRatio: 0.75 }))
    const r = assessPosture(frames)
    expect(r.tiltCorrected).toBe(false)
    expect(r.levelVerified).toBe(true)
  })

  it('flags: any frame without captureRollDeg makes levelVerified false', () => {
    const frames = testLandmarksFrames.map((f, i) =>
      i === 0 ? { ...f, aspectRatio: 0.75 } : { ...f, captureRollDeg: 0, aspectRatio: 0.75 }
    )
    const r = assessPosture(frames)
    expect(r.levelVerified).toBe(false)
  })

  it('flags: empty frame list is not levelVerified', () => {
    const r = assessPosture([])
    expect(r.levelVerified).toBe(false)
    expect(r.tiltCorrected).toBe(false)
  })

  it('flags: an uploaded frame is never level-verified, even if it claims a roll', () => {
    const frames = testLandmarksFrames.map(f => ({
      ...f, captureRollDeg: 0, aspectRatio: 0.75, source: 'upload' as const,
    }))
    const r = assessPosture(frames)
    expect(r.levelVerified).toBe(false)
  })
})

describe('aspect-ratio golden values (intentional score shift, spec §6)', () => {
  // Hand-derived by replaying the engine math on the canonical fixture with
  // x scaled by 0.75. Side-view from-vertical angles DROP (they were
  // overstated); front-view from-horizontal angles RISE (understated).
  const frames = testLandmarksFrames.map(f => ({ ...f, aspectRatio: 0.75 }))
  const EPSILON = 0.05

  it('locks the aspect-corrected canonical result', () => {
    const r = assessPosture(frames)
    // Aspect correction lowers the side-view angles; validity-weighted score
    // (Task 6) shifts to 23 (was 24 unweighted). No overallPercentile emitted.
    expect(r.overallScore).toBe(23)
    expect(r.overallGrade).toBe('C')
    expect(r.ranks.front).toBe(21) // was 18 uncorrected
    expect(r.ranks.side).toBe(30)  // was 35 uncorrected (was 28 pre-trunk_lean-merge)

    const byKey = Object.fromEntries(r.findings.map(f => [f.key, f]))
    expect(Math.abs(byKey['forward_head_posture'].deviation - 8.7778)).toBeLessThan(EPSILON)        // was 11.63
    expect(Math.abs(byKey['anterior_imbalanced_shoulders'].deviation - 3.8655)).toBeLessThan(EPSILON) // was 2.90
    expect(Math.abs(byKey['trunk_lean'].deviation - 2.7702)).toBeLessThan(EPSILON)                  // was 3.69 (merges t1 + aps)
    expect(byKey['trunk_lean'].zone).toBe('maintain')                                                // was 'warning'
    expect(Math.abs(byKey['knee_extension_back_knee'].deviation - 2.0888)).toBeLessThan(EPSILON) // was 2.9112 under STANDARD=175
    expect(Math.abs(byKey['genu_varum_valgum_left'].deviation - 0.6218)).toBeLessThan(EPSILON)
  })

  it('frames WITHOUT aspectRatio keep the historical values (no silent re-scoring)', () => {
    const r = assessPosture(testLandmarksFrames)
    expect(r.overallScore).toBe(24) // 25 before validity-weighted score (Task 6), 26 before trunk_lean-merge (2.0.0)
    expect(r.ranks.front).toBe(18)
    expect(r.ranks.side).toBe(37)
  })

  it('hand value: FHP fixture frame at aspect 0.75 → atan2(0.07·0.75, 0.10) ≈ 27.70°', () => {
    const fhp: PoseFrame = {
      view: 'side',
      aspectRatio: 0.75,
      landmarks: {
        // nose right of the ear → facing-confirmed anterior ear (aspect scaling
        // is monotonic in x, so the facing sign survives normalization).
        nose:          { x: 0.640, y: 0.055, visibility: 0.90 },
        left_ear:      { x: 0.570, y: 0.150, visibility: 0.90 },
        left_shoulder: { x: 0.500, y: 0.250, visibility: 0.90 },
      },
    }
    const r = assessPosture([fhp])
    const f = r.findings.find(x => x.key === 'forward_head_posture')!
    // dy = shoulder.y − ear.y = +0.10 in y-down coords (shoulder below ear)
    expect(Math.abs(f.deviation - 27.70)).toBeLessThan(0.05) // raw math gave 34.99
  })
})
