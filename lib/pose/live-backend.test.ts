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

  it('bounds silent startup, terminates the stale worker, and starts a clean retry', async () => {
    vi.useFakeTimers()
    class SlowWorker {
      static latest: SlowWorker
      static terminated = 0
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null

      constructor() { SlowWorker.latest = this }

      postMessage(message: { type: string }) {
        if (message.type === 'close') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'closed' } } as MessageEvent))
        }
      }

      ready() {
        this.onmessage?.({ data: { type: 'ready', delegate: 'cpu' } } as MessageEvent)
      }

      terminate() { SlowWorker.terminated++ }
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

    const first = backend.startLiveBackend()
    await vi.advanceTimersByTimeAsync(backend.LIVE_INIT_TIMEOUT_MS)
    await expect(first).resolves.toMatchObject({ ok: false, code: 'timeout' })
    expect(SlowWorker.terminated).toBe(1)
    expect(backend.liveReadiness()).toMatchObject({ phase: 'failed', backend: 'live' })

    const second = backend.startLiveBackend()
    SlowWorker.latest.ready()
    await expect(second).resolves.toEqual({ ok: true, delegate: 'cpu' })

    const snapshot = telemetry.getLiveTelemetrySnapshot()!
    expect(snapshot.worker).toMatchObject({ initAttempts: 2, readyCount: 1, delegates: ['cpu'], errors: 1 })

    await backend.closeLiveBackend()
  })

  it('surfaces both-delegate init failure and permits a later start', async () => {
    class RecoveringWorker {
      static attempts = 0
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null

      postMessage(message: { type: string }) {
        if (message.type === 'init') {
          RecoveringWorker.attempts++
          if (RecoveringWorker.attempts === 1) {
            queueMicrotask(() => this.onmessage?.({
              data: { type: 'error', code: 'gpu_and_cpu_failed', message: 'GPU failed; CPU failed' },
            } as MessageEvent))
          } else {
            queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', delegate: 'gpu' } } as MessageEvent))
          }
        }
        if (message.type === 'close') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'closed' } } as MessageEvent))
        }
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', RecoveringWorker)
    const backend = await import('./live-backend')

    await expect(backend.startLiveBackend()).resolves.toEqual({
      ok: false,
      code: 'gpu_and_cpu_failed',
      message: 'GPU failed; CPU failed',
    })
    await expect(backend.startLiveBackend()).resolves.toEqual({ ok: true, delegate: 'gpu' })
    await backend.closeLiveBackend()
  })

  it('invalidates a worker after runtime detection error and restarts it', async () => {
    class RuntimeWorker {
      static instances = 0
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null

      constructor() { RuntimeWorker.instances++ }

      postMessage(message: { type: string; seq?: number }) {
        if (message.type === 'init') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', delegate: 'gpu' } } as MessageEvent))
        } else if (message.type === 'frame') {
          queueMicrotask(() => this.onmessage?.({
            data: { type: 'runtime-error', seq: message.seq, code: 'runtime_error', message: 'detect crashed' },
          } as MessageEvent))
        } else if (message.type === 'close') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'closed' } } as MessageEvent))
        }
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', RuntimeWorker)
    const backend = await import('./live-backend')
    await backend.startLiveBackend()
    await expect(backend.detectLiveBackend({ close() {} } as ImageBitmap, {
      generation: 1,
      timestampMs: 10,
      currentTime: 0.1,
    })).resolves.toBeNull()
    expect(backend.liveReadiness()).toMatchObject({ phase: 'failed', message: 'detect crashed' })

    await expect(backend.startLiveBackend()).resolves.toEqual({ ok: true, delegate: 'gpu' })
    expect(RuntimeWorker.instances).toBe(2)
    await backend.closeLiveBackend()
  })

  it('turns a wedged frame into a visible failure, kills late results, and retries on CPU', async () => {
    vi.useFakeTimers()
    class WedgedWorker {
      static instances: WedgedWorker[] = []
      static initPreferences: boolean[] = []
      static terminated = 0
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      lastSeq: number | undefined

      constructor() { WedgedWorker.instances.push(this) }

      postMessage(message: { type: string; preferCpu?: boolean; seq?: number }) {
        if (message.type === 'init') {
          WedgedWorker.initPreferences.push(message.preferCpu === true)
          queueMicrotask(() => this.onmessage?.({
            data: { type: 'ready', delegate: message.preferCpu ? 'cpu' : 'gpu' },
          } as MessageEvent))
        } else if (message.type === 'frame') {
          this.lastSeq = message.seq
          // Deliberately never answer: main-thread deadline must invalidate us.
        } else if (message.type === 'close') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'closed' } } as MessageEvent))
        }
      }

      emitLateResult() {
        this.onmessage?.({ data: {
          type: 'result',
          seq: this.lastSeq,
          result: { landmarks: {}, generation: 1, timestampMs: 10, inferenceMs: 1 },
        } } as MessageEvent)
      }

      terminate() { WedgedWorker.terminated++ }
    }

    vi.stubGlobal('Worker', WedgedWorker)
    const backend = await import('./live-backend')
    await expect(backend.startLiveBackend()).resolves.toEqual({ ok: true, delegate: 'gpu' })

    const firstWorker = WedgedWorker.instances[0]
    const pending = backend.detectLiveBackend({ close() {} } as ImageBitmap, {
      generation: 1,
      timestampMs: 10,
      currentTime: 0.1,
    })
    await vi.advanceTimersByTimeAsync(backend.LIVE_FRAME_TIMEOUT_MS)
    await expect(pending).resolves.toBeNull()
    expect(backend.liveReadiness()).toMatchObject({ phase: 'failed', backend: 'live' })
    expect(WedgedWorker.terminated).toBe(1)

    firstWorker.emitLateResult()
    await expect(backend.startLiveBackend()).resolves.toEqual({ ok: true, delegate: 'cpu' })
    expect(WedgedWorker.initPreferences).toEqual([false, true])

    await backend.closeLiveBackend()
  })
})
