'use client'

export const LIVE_TELEMETRY_SCHEMA_VERSION = 1 as const
export const MAX_TELEMETRY_SAMPLES_PER_SERIES = 20_000

export type LiveDropReason =
  | 'runtime_not_live'
  | 'backend_not_ready'
  | 'backend_in_flight'
  | 'stale_generation'
  | 'post_failed'
  | 'timeout'
  | 'backend_closed'
  | 'worker_gate'
  | 'worker_detect_error'
  | 'bitmap_error'
  | 'stale_bitmap'

export interface LiveTelemetryDevice {
  userAgent: string
  viewport: { width: number; height: number; devicePixelRatio: number }
  hardwareConcurrency: number | null
  deviceMemoryGb: number | null
}

export type LiveTelemetryEvent =
  | { type: 'capabilities'; longTaskObserver: boolean; heapMemory: boolean }
  | { type: 'worker-init'; durationMs: number; status: 'ready' | 'error' | 'timeout' | 'unsupported' | 'post_failed'; delegate?: 'gpu' | 'cpu' }
  | { type: 'worker-ready-late'; durationMs: number; delegate?: 'gpu' | 'cpu' }
  | { type: 'worker-close' }
  | { type: 'worker-error'; stage: 'runtime' }
  | { type: 'frame-attempt' }
  | { type: 'frame-submitted' }
  | { type: 'frame-result'; inferenceMs: number; roundTripMs: number; late?: boolean }
  | { type: 'frame-drop'; reason: LiveDropReason }
  | { type: 'long-task'; durationMs: number }
  | { type: 'memory'; usedBytes: number }
  | { type: 'view'; view: string; phase: string }

export interface LiveTelemetrySnapshot {
  schemaVersion: typeof LIVE_TELEMETRY_SCHEMA_VERSION
  startedAt: string
  snapshotAt: string
  device: LiveTelemetryDevice
  capabilities: { longTaskObserver: boolean; heapMemory: boolean }
  worker: {
    initAttempts: number
    readyCount: number
    lateReadyCount: number
    initP95Ms: number | null
    delegates: Array<'gpu' | 'cpu'>
    errors: number
    closes: number
  }
  frames: {
    attempted: number
    submitted: number
    results: number
    lateResults: number
    dropped: number
    dropReasons: Partial<Record<LiveDropReason, number>>
  }
  inference: TimingSummary
  roundTrip: TimingSummary
  longTasks: { count: number; totalMs: number; maxMs: number | null }
  memory: { samples: number; startBytes: number | null; currentBytes: number | null; peakBytes: number | null }
  sampling: { maxSamplesPerSeries: number; truncated: boolean }
  viewTransitions: Array<{ view: string; phase: string }>
}

interface TimingSummary {
  count: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

interface TelemetryState {
  startedAt: string
  device: LiveTelemetryDevice
  capabilities: LiveTelemetrySnapshot['capabilities']
  workerInits: Array<{ durationMs: number; status: Extract<LiveTelemetryEvent, { type: 'worker-init' }>['status']; delegate?: 'gpu' | 'cpu' }>
  lateWorkerReady: Array<{ durationMs: number; delegate?: 'gpu' | 'cpu' }>
  workerErrors: number
  workerCloses: number
  frameAttempts: number
  frameSubmissions: number
  frameResults: number
  lateFrameResults: number
  dropReasons: Partial<Record<LiveDropReason, number>>
  inferenceMs: number[]
  roundTripMs: number[]
  longTaskMs: number[]
  memoryBytes: number[]
  samplesTruncated: boolean
  viewTransitions: Array<{ view: string; phase: string }>
}

const listeners = new Set<() => void>()
let state: TelemetryState | null = null

export function shouldEnableCaptureTelemetry(nodeEnv: string | undefined, search: string): boolean {
  if (nodeEnv === 'production') return false
  return new URLSearchParams(search).get('captureTelemetry') === '1'
}

export function enableLiveTelemetry(device: LiveTelemetryDevice, startedAt = new Date().toISOString()): void {
  state = {
    startedAt,
    device,
    capabilities: { longTaskObserver: false, heapMemory: false },
    workerInits: [],
    lateWorkerReady: [],
    workerErrors: 0,
    workerCloses: 0,
    frameAttempts: 0,
    frameSubmissions: 0,
    frameResults: 0,
    lateFrameResults: 0,
    dropReasons: {},
    inferenceMs: [],
    roundTripMs: [],
    longTaskMs: [],
    memoryBytes: [],
    samplesTruncated: false,
    viewTransitions: [],
  }
  notify()
}

export function disableLiveTelemetry(): void {
  state = null
  notify()
}

export function isLiveTelemetryEnabled(): boolean {
  return state !== null
}

export function updateLiveTelemetryDevice(device: LiveTelemetryDevice): void {
  if (!state) return
  state.device = device
  notify()
}

export function subscribeLiveTelemetry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function recordLiveTelemetry(event: LiveTelemetryEvent): void {
  if (!state) return
  applyEvent(state, event)
  notify()
}

export function getLiveTelemetrySnapshot(snapshotAt = new Date().toISOString()): LiveTelemetrySnapshot | null {
  if (!state) return null
  const readyInits = state.workerInits.filter((entry) => entry.status === 'ready')
  const allReady = [...readyInits, ...state.lateWorkerReady]
  const memory = state.memoryBytes
  return {
    schemaVersion: LIVE_TELEMETRY_SCHEMA_VERSION,
    startedAt: state.startedAt,
    snapshotAt,
    device: { ...state.device, viewport: { ...state.device.viewport } },
    capabilities: { ...state.capabilities },
    worker: {
      initAttempts: state.workerInits.length,
      readyCount: allReady.length,
      lateReadyCount: state.lateWorkerReady.length,
      initP95Ms: percentile(allReady.map((entry) => entry.durationMs), 0.95),
      delegates: allReady.flatMap((entry) => entry.delegate ? [entry.delegate] : []),
      errors: state.workerErrors + state.workerInits.filter((entry) =>
        entry.status === 'error' || entry.status === 'post_failed' || entry.status === 'timeout',
      ).length,
      closes: state.workerCloses,
    },
    frames: {
      attempted: state.frameAttempts,
      submitted: state.frameSubmissions,
      results: state.frameResults,
      lateResults: state.lateFrameResults,
      dropped: Object.values(state.dropReasons).reduce((sum, count) => sum + (count ?? 0), 0),
      dropReasons: { ...state.dropReasons },
    },
    inference: timingSummary(state.inferenceMs),
    roundTrip: timingSummary(state.roundTripMs),
    longTasks: {
      count: state.longTaskMs.length,
      totalMs: round(state.longTaskMs.reduce((sum, value) => sum + value, 0)),
      maxMs: nullableMax(state.longTaskMs),
    },
    memory: {
      samples: memory.length,
      startBytes: memory[0] ?? null,
      currentBytes: memory.at(-1) ?? null,
      peakBytes: memory.length ? Math.max(...memory) : null,
    },
    sampling: {
      maxSamplesPerSeries: MAX_TELEMETRY_SAMPLES_PER_SERIES,
      truncated: state.samplesTruncated,
    },
    viewTransitions: state.viewTransitions.map((entry) => ({ ...entry })),
  }
}

function applyEvent(target: TelemetryState, event: LiveTelemetryEvent): void {
  switch (event.type) {
    case 'capabilities': target.capabilities = { longTaskObserver: event.longTaskObserver, heapMemory: event.heapMemory }; break
    case 'worker-init': target.samplesTruncated = pushBounded(target.workerInits, { durationMs: event.durationMs, status: event.status, delegate: event.delegate }) || target.samplesTruncated; break
    case 'worker-ready-late': target.samplesTruncated = pushBounded(target.lateWorkerReady, { durationMs: event.durationMs, delegate: event.delegate }) || target.samplesTruncated; break
    case 'worker-close': target.workerCloses++; break
    case 'worker-error': target.workerErrors++; break
    case 'frame-attempt': target.frameAttempts++; break
    case 'frame-submitted': target.frameSubmissions++; break
    case 'frame-result':
      if (event.late) target.lateFrameResults++
      else target.frameResults++
      target.samplesTruncated = pushBounded(target.inferenceMs, event.inferenceMs) || target.samplesTruncated
      target.samplesTruncated = pushBounded(target.roundTripMs, event.roundTripMs) || target.samplesTruncated
      break
    case 'frame-drop': target.dropReasons[event.reason] = (target.dropReasons[event.reason] ?? 0) + 1; break
    case 'long-task': target.samplesTruncated = pushBounded(target.longTaskMs, event.durationMs) || target.samplesTruncated; break
    case 'memory': target.samplesTruncated = pushBounded(target.memoryBytes, event.usedBytes) || target.samplesTruncated; break
    case 'view': target.samplesTruncated = pushBounded(target.viewTransitions, { view: event.view, phase: event.phase }) || target.samplesTruncated; break
  }
}

function timingSummary(values: number[]): TimingSummary {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: nullableMax(values),
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)])
}

function nullableMax(values: number[]): number | null {
  return values.length ? round(Math.max(...values)) : null
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function pushBounded<T>(target: T[], value: T): boolean {
  if (target.length >= MAX_TELEMETRY_SAMPLES_PER_SERIES) return true
  target.push(value)
  return false
}

function notify(): void {
  listeners.forEach((listener) => listener())
}
