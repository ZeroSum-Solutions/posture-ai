import { describe, it, expect } from 'vitest'
import { sourceToViewport } from './overlay-transform'

// The transform maps normalized MediaPipe source coords [0..1] (in the captured
// video frame) to normalized viewport coords [0..1] (fraction of the on-screen
// element), accounting for object-fit: cover. Its inverse recovers the source.

describe('sourceToViewport (cover-crop affine, §11.7)', () => {
  it('is the identity when source and viewport share dimensions and no mirror', () => {
    const t = sourceToViewport({ srcW: 100, srcH: 100, vpW: 100, vpH: 100, mirror: false })
    expect(t.toViewport({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 })
    expect(t.toViewport({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('always maps the source center to the viewport center (cover crop is symmetric)', () => {
    // Tall source into a square viewport → vertical crop.
    const tall = sourceToViewport({ srcW: 100, srcH: 200, vpW: 100, vpH: 100, mirror: false })
    expect(tall.toViewport({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
    // Wide source into a square viewport → horizontal crop.
    const wide = sourceToViewport({ srcW: 200, srcH: 100, vpW: 100, vpH: 100, mirror: false })
    expect(wide.toViewport({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('crops the long axis: off-center source points fall outside [0,1] in the viewport', () => {
    // Tall source, square viewport: scale=1, the top/bottom of the source is
    // scrolled off-screen (nvy < 0 or > 1); x is unscaled.
    const t = sourceToViewport({ srcW: 100, srcH: 200, vpW: 100, vpH: 100, mirror: false })
    expect(t.toViewport({ x: 0.5, y: 0 }).y).toBeCloseTo(-0.5, 10) // source top scrolled above the viewport
    expect(t.toViewport({ x: 0.5, y: 1 }).y).toBeCloseTo(1.5, 10)  // source bottom scrolled below
    expect(t.toViewport({ x: 0.3, y: 0.5 }).x).toBeCloseTo(0.3, 10) // x passes through
  })

  it('mirrors horizontally only when mirror=true; y is never mirrored', () => {
    const t = sourceToViewport({ srcW: 100, srcH: 100, vpW: 100, vpH: 100, mirror: true })
    expect(t.toViewport({ x: 0, y: 0.2 })).toEqual({ x: 1, y: 0.2 })
    expect(t.toViewport({ x: 1, y: 0.8 })).toEqual({ x: 0, y: 0.8 })
    expect(t.toViewport({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('round-trips: toSource(toViewport(p)) recovers p (portrait source, mirrored viewport)', () => {
    const t = sourceToViewport({ srcW: 720, srcH: 960, vpW: 390, vpH: 844, mirror: true })
    for (const p of [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.87 }, { x: 0.33, y: 0.04 }]) {
      const back = t.toSource(t.toViewport(p))
      expect(back.x).toBeCloseTo(p.x, 10)
      expect(back.y).toBeCloseTo(p.y, 10)
    }
  })

  it('exposes the cover scale and centered offsets for downstream drawing', () => {
    const t = sourceToViewport({ srcW: 200, srcH: 100, vpW: 100, vpH: 100, mirror: false })
    // scale = max(100/200, 100/100) = 1; scaledW = 200 → offsetX = (100-200)/2 = -50.
    expect(t.scale).toBe(1)
    expect(t.offsetX).toBe(-50)
    expect(t.offsetY).toBe(0)
  })
})
