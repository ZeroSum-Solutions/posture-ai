import { beforeEach, describe, expect, it } from 'vitest'
import {
  disableLiveTelemetry,
  enableLiveTelemetry,
  getLiveTelemetrySnapshot,
  MAX_TELEMETRY_SAMPLES_PER_SERIES,
  recordLiveTelemetry,
  shouldEnableCaptureTelemetry,
  type LiveTelemetryDevice,
} from './live-telemetry'

const device: LiveTelemetryDevice = {
  userAgent: 'test-device',
  viewport: { width: 390, height: 844, devicePixelRatio: 3 },
  hardwareConcurrency: 6,
  deviceMemoryGb: null,
}

beforeEach(() => disableLiveTelemetry())

describe('capture telemetry activation', () => {
  it('requires both a non-production build and the explicit query flag', () => {
    expect(shouldEnableCaptureTelemetry('development', '?captureTelemetry=1')).toBe(true)
    expect(shouldEnableCaptureTelemetry('test', '?captureTelemetry=1&x=2')).toBe(true)
    expect(shouldEnableCaptureTelemetry('development', '?captureTelemetry=0')).toBe(false)
    expect(shouldEnableCaptureTelemetry('production', '?captureTelemetry=1')).toBe(false)
  })

  it('does not retain events while telemetry is disabled', () => {
    recordLiveTelemetry({ type: 'frame-attempt' })
    expect(getLiveTelemetrySnapshot()).toBeNull()
  })
})

describe('live telemetry aggregation', () => {
  it('summarizes init, inference, drops, long tasks, and memory without frame data', () => {
    enableLiveTelemetry(device, '2026-07-19T00:00:00.000Z')
    recordLiveTelemetry({ type: 'capabilities', longTaskObserver: true, heapMemory: true })
    recordLiveTelemetry({ type: 'worker-init', status: 'ready', durationMs: 1200, delegate: 'gpu' })
    recordLiveTelemetry({ type: 'worker-init', status: 'ready', durationMs: 1800, delegate: 'cpu' })
    recordLiveTelemetry({ type: 'frame-attempt' })
    recordLiveTelemetry({ type: 'frame-attempt' })
    recordLiveTelemetry({ type: 'frame-submitted' })
    recordLiveTelemetry({ type: 'frame-result', inferenceMs: 40, roundTripMs: 48 })
    recordLiveTelemetry({ type: 'frame-drop', reason: 'backend_in_flight' })
    recordLiveTelemetry({ type: 'long-task', durationMs: 61.25 })
    recordLiveTelemetry({ type: 'memory', usedBytes: 100 })
    recordLiveTelemetry({ type: 'memory', usedBytes: 140 })
    recordLiveTelemetry({ type: 'memory', usedBytes: 120 })
    recordLiveTelemetry({ type: 'view', view: 'front', phase: 'live' })

    const snapshot = getLiveTelemetrySnapshot('2026-07-19T00:01:00.000Z')!
    expect(snapshot.worker).toMatchObject({ initAttempts: 2, readyCount: 2, initP95Ms: 1800, delegates: ['gpu', 'cpu'] })
    expect(snapshot.frames).toEqual({ attempted: 2, submitted: 1, results: 1, lateResults: 0, dropped: 1, dropReasons: { backend_in_flight: 1 } })
    expect(snapshot.inference).toEqual({ count: 1, p50Ms: 40, p95Ms: 40, maxMs: 40 })
    expect(snapshot.roundTrip.p95Ms).toBe(48)
    expect(snapshot.longTasks).toEqual({ count: 1, totalMs: 61.3, maxMs: 61.3 })
    expect(snapshot.memory).toEqual({ samples: 3, startBytes: 100, currentBytes: 120, peakBytes: 140 })
    expect(snapshot.viewTransitions).toEqual([{ view: 'front', phase: 'live' }])
    expect(JSON.stringify(snapshot)).not.toMatch(/landmark|photo|client/i)
  })

  it('uses nearest-rank p95 and resets between sessions', () => {
    enableLiveTelemetry(device, 'first')
    for (const inferenceMs of [10, 20, 30, 40, 100]) {
      recordLiveTelemetry({ type: 'frame-result', inferenceMs, roundTripMs: inferenceMs + 5 })
    }
    expect(getLiveTelemetrySnapshot('first-end')?.inference.p95Ms).toBe(100)

    enableLiveTelemetry(device, 'second')
    const reset = getLiveTelemetrySnapshot('second-end')!
    expect(reset.startedAt).toBe('second')
    expect(reset.inference.count).toBe(0)
    expect(reset.frames.dropped).toBe(0)
  })

  it('caps retained samples and reports truncation instead of silently biasing evidence', () => {
    enableLiveTelemetry(device, 'bounded')
    for (let i = 0; i <= MAX_TELEMETRY_SAMPLES_PER_SERIES; i += 1) {
      recordLiveTelemetry({ type: 'memory', usedBytes: i })
    }

    const snapshot = getLiveTelemetrySnapshot('bounded-end')!
    expect(snapshot.memory.samples).toBe(MAX_TELEMETRY_SAMPLES_PER_SERIES)
    expect(snapshot.memory.startBytes).toBe(0)
    expect(snapshot.memory.currentBytes).toBe(MAX_TELEMETRY_SAMPLES_PER_SERIES - 1)
    expect(snapshot.sampling).toEqual({
      maxSamplesPerSeries: MAX_TELEMETRY_SAMPLES_PER_SERIES,
      truncated: true,
    })
  })
})
