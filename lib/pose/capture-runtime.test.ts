import { afterEach, describe, it, expect, vi } from 'vitest'
import { createCaptureRuntime, subscribeAfterImport } from './capture-runtime'
import type { LiveBackend, ImageBackend } from './capture-runtime'
import type { DetectedPoseFrame } from './detect'
import { disableLiveTelemetry, enableLiveTelemetry, getLiveTelemetrySnapshot } from './live-telemetry'
import { readinessMessage, type PoseReadiness, type PoseReadinessListener } from './pose-readiness'

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
  let liveReadiness = readinessMessage('downloading', 'live')
  let imageReadiness = readinessMessage('downloading', 'image')
  const liveListeners = new Set<PoseReadinessListener>()
  const imageListeners = new Set<PoseReadinessListener>()
  const publishLive = (next: PoseReadiness) => {
    liveReadiness = next
    liveListeners.forEach(listener => listener(next))
  }
  const publishImage = (next: PoseReadiness) => {
    imageReadiness = next
    imageListeners.forEach(listener => listener(next))
  }
  const live: LiveBackend = {
    start: async () => {
      if (imageOn) violations++
      liveOn = true
      record()
      publishLive(readinessMessage('ready', 'live', 'gpu'))
      return { ok: true, delegate: 'gpu' }
    },
    close: async () => { liveOn = false },
    detect: async () => null,
    readiness: () => liveReadiness,
    subscribeReadiness: listener => {
      liveListeners.add(listener)
      listener(liveReadiness)
      return () => liveListeners.delete(listener)
    },
  }
  const image: ImageBackend = {
    warm: async () => {
      if (liveOn) violations++
      imageOn = true
      record()
      publishImage(readinessMessage('ready', 'image', 'cpu'))
      return { ok: true, delegate: 'cpu' }
    },
    close: async () => { imageOn = false },
    detect: async (): Promise<DetectedPoseFrame> => ({ view: 'front', landmarks: {}, detectedPoseCount: 0 }),
    readiness: () => imageReadiness,
    subscribeReadiness: listener => {
      imageListeners.add(listener)
      listener(imageReadiness)
      return () => imageListeners.delete(listener)
    },
    resetDelegatePreference: async () => {},
  }
  return {
    live, image, publishLive, publishImage,
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
    const live: LiveBackend = { ...f.live, start: async () => { starts++; return f.live.start() } }
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

  it('forwards the exact acquisition provenance to the IMAGE backend', async () => {
    const f = makeFakes()
    const detect = vi.fn(f.image.detect)
    const image: ImageBackend = { ...f.image, detect }
    const rt = createCaptureRuntime({ live: f.live, image })
    const poseInput = {
      sourceWidthPx: 3024,
      sourceHeightPx: 4032,
      orientationNormalization: 'exif_from_image_canvas_v1' as const,
      analysisMirrored: false as const,
      displayMirrored: false as const,
      requestedCameraFacingMode: null,
      observedCameraFacingMode: null,
    }

    await rt.detect('blob:oriented', 'side', 'upload', poseInput)

    expect(detect).toHaveBeenCalledWith('blob:oriented', 'side', 'upload', poseInput)
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

  it('emits an immediate UI readiness value and delegate-aware transitions', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })
    const seen: PoseReadiness[] = []
    const unsubscribe = rt.subscribeReadiness(value => seen.push(value))

    expect(seen[0]).toMatchObject({ phase: 'downloading', backend: 'live', delegate: null })
    await rt.enterLive()
    expect(rt.readiness()).toEqual(readinessMessage('ready', 'live', 'gpu'))
    await rt.detect('blob:review', 'front', 'camera')
    expect(rt.readiness()).toEqual(readinessMessage('ready', 'image', 'cpu'))

    unsubscribe()
    const count = seen.length
    f.publishImage(readinessMessage('failed', 'image', null, 'ignored after unsubscribe'))
    expect(seen).toHaveLength(count)
  })

  it('keeps state closed after live init failure and retries only on explicit retry', async () => {
    const f = makeFakes()
    let attempts = 0
    const live: LiveBackend = {
      ...f.live,
      start: async () => {
        attempts++
        if (attempts === 1) {
          f.publishLive(readinessMessage('failed', 'live', null, 'GPU and CPU failed'))
          return { ok: false, code: 'gpu_and_cpu_failed', message: 'GPU and CPU failed' }
        }
        return f.live.start()
      },
    }
    const rt = createCaptureRuntime({ live, image: f.image })

    await rt.enterLive()
    expect(rt.state()).toBe('closed')
    expect(rt.readiness()).toMatchObject({ phase: 'failed', backend: 'live' })
    await rt.enterLive()
    expect(attempts).toBe(1)

    await rt.retry()
    expect(attempts).toBe(2)
    expect(rt.state()).toBe('live-video')
    expect(rt.readiness()).toMatchObject({ phase: 'ready', delegate: 'gpu' })
  })

  it('tears down coherent state after an asynchronous live runtime failure', async () => {
    const f = makeFakes()
    const rt = createCaptureRuntime({ live: f.live, image: f.image })
    await rt.enterLive()

    f.publishLive(readinessMessage('failed', 'live', null, 'runtime crashed'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(rt.state()).toBe('closed')
    expect(f.resident()).toBe(0)
    expect(rt.readiness()).toMatchObject({ phase: 'failed', message: 'runtime crashed' })
  })

  it('closes a failed IMAGE backend and can warm a clean one through retry', async () => {
    const f = makeFakes()
    let warms = 0
    const image: ImageBackend = {
      ...f.image,
      warm: async () => {
        warms++
        if (warms === 1) {
          f.publishImage(readinessMessage('failed', 'image', null, 'both delegates failed'))
          return { ok: false, code: 'gpu_and_cpu_failed', message: 'both delegates failed' }
        }
        return f.image.warm()
      },
    }
    const rt = createCaptureRuntime({ live: f.live, image })

    await expect(rt.detect('blob:bad', 'front', 'upload')).rejects.toThrow('both delegates failed')
    expect(rt.state()).toBe('closed')
    expect(f.resident()).toBe(0)

    await rt.retry()
    expect(warms).toBe(2)
    expect(rt.state()).toBe('review-image')
  })

  it('resets sticky delegate recovery only when the runtime lifecycle is disposed', async () => {
    const f = makeFakes()
    let resets = 0
    const image: ImageBackend = {
      ...f.image,
      resetDelegatePreference: async () => { resets++ },
    }
    const rt = createCaptureRuntime({ live: f.live, image })

    await rt.detect('blob:review', 'front', 'camera')
    await rt.enterLive()
    expect(resets).toBe(0)

    await rt.dispose()
    expect(resets).toBe(1)
  })
})

describe('lazy readiness subscription', () => {
  it('does not register after unsubscribe wins the dynamic-import race', async () => {
    let resolveImport!: (module: { value: string }) => void
    const loading = new Promise<{ value: string }>(resolve => { resolveImport = resolve })
    let registrations = 0
    let removals = 0
    const unsubscribe = subscribeAfterImport(
      () => loading,
      () => {
        registrations++
        return () => { removals++ }
      },
    )

    unsubscribe()
    resolveImport({ value: 'loaded' })
    await loading
    await Promise.resolve()

    expect(registrations).toBe(0)
    expect(removals).toBe(0)
  })

  it('removes a listener registered before unsubscribe', async () => {
    let removals = 0
    const unsubscribe = subscribeAfterImport(
      () => Promise.resolve({ value: 'loaded' }),
      () => () => { removals++ },
    )
    await Promise.resolve()
    await Promise.resolve()

    unsubscribe()
    unsubscribe()
    expect(removals).toBe(1)
  })
})
