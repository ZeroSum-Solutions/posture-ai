import { afterEach, describe, it, expect } from 'vitest'
import { createCaptureRuntime } from './capture-runtime'
import type { LiveBackend, ImageBackend } from './capture-runtime'
import type { DetectedPoseFrame } from './detect'
import { disableLiveTelemetry, enableLiveTelemetry, getLiveTelemetrySnapshot } from './live-telemetry'

afterEach(() => disableLiveTelemetry())

// Fake backends that track exactly which landmarker is resident, so a residency
// counter can PROVE the §11.1 exclusivity invariant: ≤1 landmarker alive at any
// instant across a full four-view session incl. error/visibility/unmount paths.
function makeFakes() {
  let liveOn = false
  let imageOn = false
  let maxResident = 0
  let violations = 0
  const record = () => {
    const r = (liveOn ? 1 : 0) + (imageOn ? 1 : 0)
    if (r > 1) violations++
    if (r > maxResident) maxResident = r
  }
  const live: LiveBackend = {
    start: async () => { if (imageOn) violations++; liveOn = true; record() },
    close: async () => { liveOn = false },
    detect: async () => null,
  }
  const image: ImageBackend = {
    warm: async () => { if (liveOn) violations++; imageOn = true; record() },
    close: async () => { imageOn = false },
    detect: async (): Promise<DetectedPoseFrame> => ({ view: 'front', landmarks: {}, detectedPoseCount: 0 }),
  }
  return {
    live, image,
    get maxResident() { return maxResident },
    get violations() { return violations },
    resident: () => (liveOn ? 1 : 0) + (imageOn ? 1 : 0),
  }
}

describe('capture-runtime state machine (§11.1 exclusivity)', () => {
  it('holds ≤1 landmarker resident across a full four-view session + submit + dispose', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })

    // Four views: each framed live, then reviewed (image detect), free order.
    for (const [i, side] of ['front', 'side-left', 'side-right', 'back'].entries()) {
      await rt.enterLive()                         // frame the view (live worker)
      expect(rt.state()).toBe('live-video')
      await rt.detect(`blob:${side}`, 'front', 'camera') // shutter→review scoring (IMAGE)
      expect(rt.state()).toBe('review-image')
      if (i === 1) { await rt.dispose() } // visibilitychange→hidden mid-session; loop re-enters live next view
    }
    // Submit: score the burst of every slot (many detects, still one landmarker).
    for (let i = 0; i < 8; i++) await rt.detect(`blob:submit-${i}`, 'side', 'camera')
    await rt.dispose()

    expect(f.violations).toBe(0)
    expect(f.maxResident).toBeLessThanOrEqual(1)
    expect(f.resident()).toBe(0) // dispose closed everything
    expect(rt.state()).toBe('closed')
  })

  it('enterLive closes the IMAGE backend before starting the live worker', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })
    await rt.detect('blob:x', 'front', 'camera') // → review-image (image resident)
    expect(rt.state()).toBe('review-image')
    await rt.enterLive()                          // must close image, then start live
    expect(rt.state()).toBe('live-video')
    expect(f.maxResident).toBeLessThanOrEqual(1)
  })

  it('is idempotent: re-entering the same state does not construct twice', async () => {
    const f = makeFakes()
    let starts = 0
    const live: LiveBackend = { ...f.live, start: async () => { starts++; await f.live.start() } }
    const rt = createCaptureRuntime({ live, image: f.image })
    await rt.enterLive()
    await rt.enterLive()
    await rt.enterLive()
    expect(starts).toBe(1)
    expect(rt.state()).toBe('live-video')
  })

  it('serializes overlapping transitions so residency never exceeds 1', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })
    // Fire a live-enter and an image-detect without awaiting between them — the
    // mutex must run them serially, never holding both landmarkers at once.
    await Promise.all([
      rt.enterLive(),
      rt.detect('blob:race', 'front', 'camera'),
      rt.enterLive(),
      rt.detect('blob:race2', 'front', 'camera'),
    ])
    expect(f.violations).toBe(0)
    expect(f.maxResident).toBeLessThanOrEqual(1)
  })

  it('dispose from live-video closes the worker (error/unmount path)', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })
    await rt.enterLive()
    await rt.dispose()
    expect(rt.state()).toBe('closed')
    expect(f.resident()).toBe(0)
  })

  it('routes review/submit detection through the resident IMAGE backend', async () => {
    const f = makeFakes()
    let detected = 0
    const image: ImageBackend = { ...f.image, detect: async () => { detected++; return { view: 'side', landmarks: {}, detectedPoseCount: 0 } } }
    const rt = createCaptureRuntime({ live: f.live, image })
    const frame = await rt.detect('blob:s', 'side', 'upload')
    expect(detected).toBe(1)
    expect(frame.view).toBe('side')
    expect(rt.state()).toBe('review-image')
  })

  it('records and releases a frame offered while the live backend is closed', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })
    let closed = false
    const bitmap = { close: () => { closed = true } } as ImageBitmap
    enableLiveTelemetry({
      userAgent: 'test',
      viewport: { width: 1, height: 1, devicePixelRatio: 1 },
      hardwareConcurrency: null,
      deviceMemoryGb: null,
    })

    await expect(rt.frameLive(bitmap, { generation: 1, timestampMs: 1, currentTime: 1 })).resolves.toBeNull()

    expect(closed).toBe(true)
    expect(getLiveTelemetrySnapshot()?.frames.dropReasons.runtime_not_live).toBe(1)
  })
})
