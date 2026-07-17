// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { samplePixelsFromSource, MAX_SAMPLE_EDGE } from './pixel-sample'

type StubBehavior = 'null' | 'drawThrow' | 'getImageDataThrow' | 'happy'

// jsdom has no real canvas backend installed, so HTMLCanvasElement#getContext
// returns null by default — stub it per-test to exercise the draw/readback
// paths the pure-node default can't reach.
function stubCanvas2d(behavior: StubBehavior) {
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null
    if (behavior === 'null') return null
    return {
      drawImage: vi.fn(() => {
        if (behavior === 'drawThrow') throw new Error('drawImage failed')
      }),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
        if (behavior === 'getImageDataThrow') throw new Error('getImageData failed')
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }
      }),
    } as unknown as CanvasRenderingContext2D
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  return () => {
    HTMLCanvasElement.prototype.getContext = original
  }
}

const fakeSource = {} as CanvasImageSource

describe('samplePixelsFromSource', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when getContext returns null', () => {
    const restore = stubCanvas2d('null')
    try {
      expect(samplePixelsFromSource(fakeSource, 800, 600)).toBeNull()
    } finally {
      restore()
    }
  })

  it('returns null when drawImage throws', () => {
    const restore = stubCanvas2d('drawThrow')
    try {
      expect(samplePixelsFromSource(fakeSource, 800, 600)).toBeNull()
    } finally {
      restore()
    }
  })

  it('returns null when getImageData throws', () => {
    const restore = stubCanvas2d('getImageDataThrow')
    try {
      expect(samplePixelsFromSource(fakeSource, 800, 600)).toBeNull()
    } finally {
      restore()
    }
  })

  it('produces proportional dims for a 480x1600 portrait source, bounded by maxEdge', () => {
    const restore = stubCanvas2d('happy')
    try {
      const sample = samplePixelsFromSource(fakeSource, 480, 1600, 320)
      expect(sample).not.toBeNull()
      // Long edge (height) scales to maxEdge; width scales proportionally.
      expect(sample!.height).toBe(320)
      expect(sample!.width).toBe(Math.max(1, Math.round(480 * (320 / 1600))))
      expect(sample!.height).toBeLessThanOrEqual(320)
      expect(sample!.width).toBeLessThanOrEqual(320)
    } finally {
      restore()
    }
  })

  it('produces proportional dims for a 1067x1600 portrait source, bounded by maxEdge', () => {
    const restore = stubCanvas2d('happy')
    try {
      const sample = samplePixelsFromSource(fakeSource, 1067, 1600, 320)
      expect(sample).not.toBeNull()
      expect(sample!.height).toBe(320)
      expect(sample!.width).toBe(Math.max(1, Math.round(1067 * (320 / 1600))))
      expect(sample!.height).toBeLessThanOrEqual(320)
      expect(sample!.width).toBeLessThanOrEqual(320)
    } finally {
      restore()
    }
  })

  it('clamps an extreme-aspect source to >=1 on the short edge, never 0', () => {
    const restore = stubCanvas2d('happy')
    try {
      const sample = samplePixelsFromSource(fakeSource, 10000, 10, 320)
      expect(sample).not.toBeNull()
      expect(sample!.width).toBe(320)
      expect(sample!.height).toBeGreaterThanOrEqual(1)
      expect(sample!.height).not.toBe(0)
    } finally {
      restore()
    }
  })

  it('happy path returns an RGBA sample matching width*height*4', () => {
    const restore = stubCanvas2d('happy')
    try {
      const sample = samplePixelsFromSource(fakeSource, 720, 960, MAX_SAMPLE_EDGE)
      expect(sample).not.toBeNull()
      expect(sample!.data).toBeInstanceOf(Uint8ClampedArray)
      expect(sample!.data.length).toBe(sample!.width * sample!.height * 4)
    } finally {
      restore()
    }
  })

  it('returns null on invalid dimensions (zero, negative, NaN, Infinity)', () => {
    expect(samplePixelsFromSource(fakeSource, 0, 600)).toBeNull()
    expect(samplePixelsFromSource(fakeSource, 800, 0)).toBeNull()
    expect(samplePixelsFromSource(fakeSource, -1, 600)).toBeNull()
    expect(samplePixelsFromSource(fakeSource, 800, NaN)).toBeNull()
    expect(samplePixelsFromSource(fakeSource, Infinity, 600)).toBeNull()
  })

  it('never downscales below source dims (scale clamped to <=1)', () => {
    const restore = stubCanvas2d('happy')
    try {
      const sample = samplePixelsFromSource(fakeSource, 100, 50, 320)
      expect(sample).not.toBeNull()
      expect(sample!.width).toBe(100)
      expect(sample!.height).toBe(50)
    } finally {
      restore()
    }
  })
})
