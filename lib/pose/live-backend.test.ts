import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('live backend telemetry', () => {
  it('records worker init, inference, round-trip, and close events', async () => {
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null

      postMessage(message: { type: string; seq?: number; generation?: number; timestampMs?: number }) {
        if (message.type === 'init') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', delegate: 'gpu' } } as MessageEvent))
        } else if (message.type === 'frame') {
          queueMicrotask(() => this.onmessage?.({
            data: {
              type: 'result',
              seq: message.seq,
              result: {
                landmarks: {},
                generation: message.generation,
                timestampMs: message.timestampMs,
                inferenceMs: 42,
              },
            },
          } as MessageEvent))
        } else if (message.type === 'close') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'closed' } } as MessageEvent))
        }
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', FakeWorker)
    const telemetry = await import('./live-telemetry')
    const backend = await import('./live-backend')
    telemetry.enableLiveTelemetry({
      userAgent: 'test',
      viewport: { width: 1, height: 1, devicePixelRatio: 1 },
      hardwareConcurrency: null,
      deviceMemoryGb: null,
    })

    await backend.startLiveBackend()
    const result = await backend.detectLiveBackend({ close() {} } as ImageBitmap, {
      generation: 1,
      timestampMs: 10,
      currentTime: 0.1,
    })
    await backend.closeLiveBackend()

    expect(result?.inferenceMs).toBe(42)
    expect(telemetry.getLiveTelemetrySnapshot()).toMatchObject({
      worker: { initAttempts: 1, readyCount: 1, delegates: ['gpu'], closes: 1 },
      frames: { submitted: 1, results: 1, dropped: 0 },
      inference: { count: 1, p95Ms: 42 },
    })
  })

  it('keeps late-ready and post-timeout inference samples instead of censoring slow devices', async () => {
    vi.useFakeTimers()
    class SlowWorker {
      static latest: SlowWorker
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      frame: { seq?: number; generation?: number; timestampMs?: number } | null = null

      constructor() { SlowWorker.latest = this }

      postMessage(message: { type: string; seq?: number; generation?: number; timestampMs?: number }) {
        if (message.type === 'frame') this.frame = message
        if (message.type === 'close') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'closed' } } as MessageEvent))
        }
      }

      ready() {
        this.onmessage?.({ data: { type: 'ready', delegate: 'cpu' } } as MessageEvent)
      }

      result() {
        this.onmessage?.({
          data: {
            type: 'result',
            seq: this.frame?.seq,
            result: {
              landmarks: {},
              generation: this.frame?.generation,
              timestampMs: this.frame?.timestampMs,
              inferenceMs: 1200,
            },
          },
        } as MessageEvent)
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', SlowWorker)
    const telemetry = await import('./live-telemetry')
    const backend = await import('./live-backend')
    telemetry.enableLiveTelemetry({
      userAgent: 'slow-test',
      viewport: { width: 1, height: 1, devicePixelRatio: 1 },
      hardwareConcurrency: null,
      deviceMemoryGb: null,
    })

    const starting = backend.startLiveBackend()
    await vi.advanceTimersByTimeAsync(8000)
    await starting
    SlowWorker.latest.ready()

    const detecting = backend.detectLiveBackend({ close() {} } as ImageBitmap, {
      generation: 1,
      timestampMs: 10,
      currentTime: 0.1,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(detecting).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(250)
    SlowWorker.latest.result()

    const snapshot = telemetry.getLiveTelemetrySnapshot()!
    expect(snapshot.worker).toMatchObject({ readyCount: 1, lateReadyCount: 1, initP95Ms: 8000, delegates: ['cpu'], errors: 1 })
    expect(snapshot.frames).toMatchObject({ results: 0, lateResults: 1, dropped: 1, dropReasons: { timeout: 1 } })
    expect(snapshot.inference).toMatchObject({ count: 1, p95Ms: 1200 })
    expect(snapshot.roundTrip.p95Ms).toBe(1250)

    await backend.closeLiveBackend()
  })
})
