import { describe, it, expect } from 'vitest'
import type { PoseFrame, Landmark } from '../src/types'
import { rotatePoint, normalizeFrame } from '../src/geometry'

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
