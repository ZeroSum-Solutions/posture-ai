'use client'
// Main-thread wrapper around the live VIDEO pose Worker. Best-effort by design:
// if the Worker can't be spawned, or its GPU/WASM init fails, every call
// degrades to a no-op (null result) so capture keeps working with sensor-only
// guides (§4.1 fallback). Enforces single-in-flight on this side too, and syncs
// the worker's generation token so stale-view frames are dropped in the worker.

import type { LiveFrameMeta, LiveResult } from './capture-runtime'
import { recordLiveTelemetry, type LiveDropReason, type LiveTelemetryEvent } from './live-telemetry'

type WorkerInitStatus = Extract<LiveTelemetryEvent, { type: 'worker-init' }>['status']

let worker: Worker | null = null
let ready = false
let initPromise: Promise<void> | null = null
let lastSentGeneration = -1
let inFlight = false
let seq = 0
const waiters = new Map<number, { finish: (r: LiveResult | null) => void; sentAt: number }>()
const submittedAt = new Map<number, number>()

function spawn(): Worker | null {
  try {
    return new Worker(new URL('./live-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null // SSR / no Worker support / bundler edge — degrade silently.
  }
}

export function startLiveBackend(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = new Promise<void>((resolve) => {
    const startedAt = performance.now()
    const w = spawn()
    if (!w) {
      recordLiveTelemetry({ type: 'worker-init', durationMs: performance.now() - startedAt, status: 'unsupported' })
      resolve()
      return
    }
    worker = w
    lastSentGeneration = -1
    let settled = false
    let settledStatus: WorkerInitStatus | null = null
    let lateReadyRecorded = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const done = (status: WorkerInitStatus, delegate?: 'gpu' | 'cpu') => {
      if (settled) return
      settled = true
      settledStatus = status
      if (timeout) clearTimeout(timeout)
      recordLiveTelemetry({ type: 'worker-init', durationMs: performance.now() - startedAt, status, delegate })
      resolve()
    }
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg?.type === 'ready') {
        ready = true
        if (settled && settledStatus !== 'ready' && !lateReadyRecorded) {
          lateReadyRecorded = true
          recordLiveTelemetry({ type: 'worker-ready-late', durationMs: performance.now() - startedAt, delegate: msg.delegate })
        } else done('ready', msg.delegate)
      }
      else if (msg?.type === 'error') { ready = false; done('error') }
      else if (msg?.type === 'result') {
        const waiter = waiters.get(msg.seq)
        const sentAt = submittedAt.get(msg.seq)
        waiters.delete(msg.seq)
        submittedAt.delete(msg.seq)
        const result = (msg.result ?? null) as LiveResult | null
        if (result && sentAt !== undefined) {
          recordLiveTelemetry({
            type: 'frame-result',
            inferenceMs: result.inferenceMs,
            roundTripMs: performance.now() - sentAt,
            late: !waiter,
          })
        } else if (!result && waiter) {
          recordLiveTelemetry({ type: 'frame-drop', reason: asDropReason(msg.dropReason) })
        }
        waiter?.finish(result)
      }
    }
    w.onerror = () => {
      ready = false
      if (settled) recordLiveTelemetry({ type: 'worker-error', stage: 'runtime' })
      else done('error')
    }
    try { w.postMessage({ type: 'init' }) } catch { done('post_failed') }
    // Never block the state machine forever on a silent worker.
    if (!settled) timeout = setTimeout(() => done('timeout'), 8000)
  })
  return initPromise
}

export function detectLiveBackend(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null> {
  // Not ready, a detect is already pending, or a stale-generation frame arrived
  // (an old view's bitmap resolved late) — drop it and release its bitmap so the
  // live loop can't accumulate GPU memory or waste inference on the old view.
  if (!worker || !ready) return drop(bitmap, 'backend_not_ready')
  if (inFlight) return drop(bitmap, 'backend_in_flight')
  if (meta.generation < lastSentGeneration) return drop(bitmap, 'stale_generation')
  // Sync the worker's generation token — monotonically, so it never moves backward.
  if (meta.generation > lastSentGeneration) {
    try { worker.postMessage({ type: 'generation', generation: meta.generation }) } catch { /* ignore */ }
    lastSentGeneration = meta.generation
  }
  const s = ++seq
  inFlight = true
  const sentAt = performance.now()
  return new Promise<LiveResult | null>((resolve) => {
    const finish = (r: LiveResult | null) => { inFlight = false; resolve(r) }
    waiters.set(s, { finish, sentAt })
    submittedAt.set(s, sentAt)
    try {
      worker!.postMessage({ type: 'frame', seq: s, bitmap, generation: meta.generation, timestampMs: meta.timestampMs, currentTime: meta.currentTime }, [bitmap])
      recordLiveTelemetry({ type: 'frame-submitted' })
    } catch {
      waiters.delete(s)
      submittedAt.delete(s)
      recordLiveTelemetry({ type: 'frame-drop', reason: 'post_failed' })
      bitmap.close?.()
      finish(null)
      return
    }
    // Guard against a lost message so the loop never hangs on `inFlight`.
    setTimeout(() => {
      if (waiters.delete(s)) {
        recordLiveTelemetry({ type: 'frame-drop', reason: 'timeout' })
        finish(null)
      }
    }, 1000)
  })
}

export async function closeLiveBackend(): Promise<void> {
  const w = worker
  worker = null
  ready = false
  initPromise = null
  inFlight = false
  lastSentGeneration = -1
  waiters.forEach(({ finish }) => {
    recordLiveTelemetry({ type: 'frame-drop', reason: 'backend_closed' })
    finish(null)
  })
  waiters.clear()
  submittedAt.clear()
  if (!w) return
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 500)
    w.onmessage = (e: MessageEvent) => { if (e.data?.type === 'closed') { clearTimeout(t); resolve() } }
    try { w.postMessage({ type: 'close' }) } catch { clearTimeout(t); resolve() }
  })
  w.terminate()
  recordLiveTelemetry({ type: 'worker-close' })
}

function drop(bitmap: ImageBitmap, reason: LiveDropReason): Promise<null> {
  recordLiveTelemetry({ type: 'frame-drop', reason })
  bitmap.close?.()
  return Promise.resolve(null)
}

function asDropReason(value: unknown): LiveDropReason {
  return value === 'worker_detect_error' ? value : 'worker_gate'
}
