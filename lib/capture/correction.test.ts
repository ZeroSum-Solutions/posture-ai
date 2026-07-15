import { describe, expect, it } from 'vitest'
import { computeCorrection } from './correction'

const EPSILON = 1e-9
const ROLLS = [-15, -5, 0, 5, 15]
const SIZES = [
  { srcW: 720, srcH: 960 },
  { srcW: 1080, srcH: 1080 },
]
const ANCHORS: Array<{ x: number; y: number } | null> = [
  { x: 0.2, y: 0.9 },
  { x: 0.5, y: 0.95 },
  { x: 0.8, y: 0.9 },
  null,
]
const corners = (srcW: number, srcH: number) => [
  { x: 0, y: 0 },
  { x: srcW, y: 0 },
  { x: 0, y: srcH },
  { x: srcW, y: srcH },
]

describe('computeCorrection (§11.5 no-crop anchor-centered correction)', () => {
  it('keeps every rotated source corner within the destination bounds', () => {
    for (const { srcW, srcH } of SIZES) {
      for (const rollDeg of ROLLS) {
        for (const anchor of ANCHORS) {
          const result = computeCorrection({ srcW, srcH, rollDeg, anchor })

          for (const corner of corners(srcW, srcH)) {
            const mapped = result.toDest(corner)
            expect(mapped.x).toBeGreaterThanOrEqual(-EPSILON)
            expect(mapped.x).toBeLessThanOrEqual(result.destW + EPSILON)
            expect(mapped.y).toBeGreaterThanOrEqual(-EPSILON)
            expect(mapped.y).toBeLessThanOrEqual(result.destH + EPSILON)
          }
        }
      }
    }
  })

  it('maps every available anchor to the destination center', () => {
    for (const { srcW, srcH } of SIZES) {
      for (const rollDeg of ROLLS) {
        for (const anchor of ANCHORS) {
          if (anchor === null) continue

          const result = computeCorrection({ srcW, srcH, rollDeg, anchor })
          const mapped = result.toDest({ x: anchor.x * srcW, y: anchor.y * srcH })

          expect(mapped.x).toBeCloseTo(result.destW / 2, 9)
          expect(mapped.y).toBeCloseTo(result.destH / 2, 9)
        }
      }
    }
  })

  it('uses zero rotation when the sensor roll is unavailable', () => {
    const result = computeCorrection({
      srcW: 720,
      srcH: 960,
      rollDeg: null,
      anchor: { x: 0.2, y: 0.9 },
    })
    const mappedAnchor = result.toDest({ x: 144, y: 864 })

    expect(result.rotationDeg).toBe(0)
    expect(mappedAnchor.x).toBeCloseTo(result.destW / 2, 9)
    expect(mappedAnchor.y).toBeCloseTo(result.destH / 2, 9)
  })

  it('straightens around the image center when the anchor is unavailable', () => {
    const result = computeCorrection({ srcW: 720, srcH: 960, rollDeg: 15, anchor: null })
    const center = { x: 360, y: 480 }
    const mappedCenter = result.toDest(center)

    expect(result.destW).toBeGreaterThan(720)
    expect(result.destH).toBeGreaterThan(960)
    expect(mappedCenter.x).toBeCloseTo(result.destW / 2, 9)
    expect(mappedCenter.y).toBeCloseTo(result.destH / 2, 9)
  })

  it('is the identity for an upload with no anchor or sensor roll', () => {
    const result = computeCorrection({ srcW: 720, srcH: 960, rollDeg: null, anchor: null })

    expect(result.destW).toBe(720)
    expect(result.destH).toBe(960)
    expect(result.rotationDeg).toBe(0)
    expect(result.toDest({ x: 123, y: 456 })).toEqual({ x: 123, y: 456 })
  })
})
