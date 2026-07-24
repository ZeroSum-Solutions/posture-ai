'use client'
// Main-thread wrapper around the live VIDEO pose Worker. The worker owns the
// landmarker and reports typed startup/runtime state; failures remain a
// sensor-only capture fallback and can be retried without reloading the page.

import type { LiveFrameMeta, LiveResult } from './capture-runtime'
import { recordLiveTelemetry, type LiveDropReason, type LiveTelemetryEvent } from './live-telemetry'
import {
  readinessMessage,
  type PoseBackendStartResult,
  type PoseDelegate,
  type PoseFailureCode,
  type PoseReadiness,
  type PoseReadinessListener,
} from './pose-readiness'

type WorkerInitStatus = Extract<LiveTelemetryEvent, { type: 'worker-init' }>['status']

// The frozen PR-09 cold-start SLO is 20 seconds on a 10 Mbps / 4x CPU profile.
// Keep the recovery cutoff just above that budget so CI can measure the SLO
// instead of the application aborting a still-eligible initialization first.
export const LIVE_INIT_TIMEOUT_MS = 22_000
export const LIVE_FRAME_TIMEOUT_MS = 1_000

let worker: Worker | null = null
let ready = false
let activeDelegate: PoseDelegate | null = null
let initPromise: Promise<PoseBackendStartResult> | null = null
let lastSentGeneration = -1
let inFlight = false
let seq = 0
let preferCpuNextStart = false
let readiness = readinessMessage('downloading', 'live', null, 'Preparing the live pose model.')
const readinessListeners = new Set<PoseReadinessListener>()
const waiters = new Map<number, {
  finish: (result: LiveResult | null) => void
  sentAt: number
  timeout: ReturnType<typeof setTimeout>
}>()
const submittedAt = new Map<number, number>()

export function liveReadiness(): PoseReadiness {
  return readiness
}

export function subscribeLiveReadiness(listener: PoseReadinessListener): () => void {
  readinessListeners.add(listener)
  listener(readiness)
  return () => readinessListeners.delete(listener)
}

function publishReadiness(next: PoseReadiness) {
  readiness = next
  readinessListeners.forEach(listener => listener(next))
}

function spawn(): Worker | null {
  try {
    return new Worker(new URL('./live-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

function releaseWaiters(reason: LiveDropReason) {
  waiters.forEach(({ finish, timeout }) => {
    clearTimeout(timeout)
    recordLiveTelemetry({ type: 'frame-drop', reason })
    finish(null)
  })
  waiters.clear()
  submittedAt.clear()
  inFlight = false
}

function terminate(current: Worker, reason: LiveDropReason = 'backend_closed') {
  if (worker !== current) return
  worker = null
  ready = false
  activeDelegate = null
  lastSentGeneration = -1
  releaseWaiters(reason)
  current.onmessage = null
  current.onerror = null
  current.terminate()
}

function failure(
  code: PoseFailureCode,
  message: string,
): PoseBackendStartResult {
  publishReadiness(readinessMessage('failed', 'live', null, message))
  return { ok: false, code, message }
}

export function startLiveBackend(): Promise<PoseBackendStartResult> {
  if (worker && ready && activeDelegate) {
    return Promise.resolve({ ok: true, delegate: activeDelegate })
  }
  if (initPromise) return initPromise

  publishReadiness(readinessMessage('downloading', 'live', null, 'Downloading live pose runtime.'))
  const pending = new Promise<PoseBackendStartResult>((resolve) => {
    const startedAt = performance.now()
    const w = spawn()
    if (!w) {
      recordLiveTelemetry({ type: 'worker-init', durationMs: performance.now() - startedAt, status: 'unsupported' })
      resolve(failure('unsupported', 'Live pose tracking is not supported in this browser.'))
      return
    }

    worker = w
    ready = false
    activeDelegate = null
    lastSentGeneration = -1
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const done = (
      result: PoseBackendStartResult,
      status: WorkerInitStatus,
      delegate?: PoseDelegate,
    ) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      recordLiveTelemetry({ type: 'worker-init', durationMs: performance.now() - startedAt, status, delegate })
      resolve(result)
      if (!result.ok) terminate(w)
    }

    w.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === 'phase' && (msg.phase === 'downloading' || msg.phase === 'initializing')) {
        publishReadiness(readinessMessage(msg.phase, 'live', msg.delegate ?? null, msg.message ?? null))
      } else if (msg?.type === 'ready' && (msg.delegate === 'gpu' || msg.delegate === 'cpu')) {
        ready = true
        activeDelegate = msg.delegate
        preferCpuNextStart = msg.delegate === 'cpu'
        publishReadiness(readinessMessage('ready', 'live', msg.delegate))
        done({ ok: true, delegate: msg.delegate }, 'ready', msg.delegate)
      } else if (msg?.type === 'error') {
        ready = false
        const code: PoseFailureCode = msg.code === 'cpu_recovery_failed' ? msg.code : 'gpu_and_cpu_failed'
        done(failure(code, msg.message ?? 'Live pose model could not start on GPU or CPU.'), 'error')
      } else if (msg?.type === 'runtime-error') {
        if (activeDelegate === 'gpu') preferCpuNextStart = true
        const waiter = waiters.get(msg.seq)
        if (waiter) {
          clearTimeout(waiter.timeout)
          waiters.delete(msg.seq)
          submittedAt.delete(msg.seq)
          recordLiveTelemetry({ type: 'frame-drop', reason: 'worker_detect_error' })
          waiter.finish(null)
        }
        recordLiveTelemetry({ type: 'worker-error', stage: 'runtime' })
        failure('runtime_error', msg.message ?? 'Live pose tracking stopped unexpectedly.')
        terminate(w, 'backend_closed')
        initPromise = null
      } else if (msg?.type === 'result') {
        const waiter = waiters.get(msg.seq)
        const sentAt = submittedAt.get(msg.seq)
        if (waiter) clearTimeout(waiter.timeout)
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
      if (settled) {
        recordLiveTelemetry({ type: 'worker-error', stage: 'runtime' })
        failure('runtime_error', 'Live pose worker stopped unexpectedly.')
        terminate(w)
        initPromise = null
      } else {
        done(failure('gpu_and_cpu_failed', 'Live pose worker failed during initialization.'), 'error')
      }
    }

    try {
      w.postMessage({ type: 'init', preferCpu: preferCpuNextStart })
    } catch {
      done(failure('post_failed', 'Could not start the live pose worker.'), 'post_failed')
      return
    }

    timer = setTimeout(() => {
      done(failure('timeout', 'Live pose-model initialization timed out.'), 'timeout')
    }, LIVE_INIT_TIMEOUT_MS)
  })

  initPromise = pending
  void pending.then(result => {
    if (!result.ok && initPromise === pending) initPromise = null
  })
  return pending
}

export function detectLiveBackend(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null> {
  if (!worker || !ready) return drop(bitmap, 'backend_not_ready')
  if (inFlight) return drop(bitmap, 'backend_in_flight')
  if (meta.generation < lastSentGeneration) return drop(bitmap, 'stale_generation')
  if (meta.generation > lastSentGeneration) {
    try { worker.postMessage({ type: 'generation', generation: meta.generation }) } catch { /* next frame will retry */ }
    lastSentGeneration = meta.generation
  }
  const currentWorker = worker
  const currentSeq = ++seq
  inFlight = true
  const sentAt = performance.now()
  return new Promise<LiveResult | null>((resolve) => {
    const finish = (result: LiveResult | null) => { inFlight = false; resolve(result) }
    const timer = setTimeout(() => {
      if (waiters.delete(currentSeq)) {
        submittedAt.delete(currentSeq)
        recordLiveTelemetry({ type: 'frame-drop', reason: 'timeout' })
        if (worker === currentWorker) {
          if (activeDelegate === 'gpu') preferCpuNextStart = true
          failure('timeout', 'Live pose tracking timed out. Retry the model to restart tracking.')
          terminate(currentWorker, 'timeout')
          initPromise = null
        }
        finish(null)
      }
    }, LIVE_FRAME_TIMEOUT_MS)
    waiters.set(currentSeq, { finish, sentAt, timeout: timer })
    submittedAt.set(currentSeq, sentAt)
    try {
      currentWorker.postMessage(
        { type: 'frame', seq: currentSeq, bitmap, generation: meta.generation, timestampMs: meta.timestampMs, currentTime: meta.currentTime },
        [bitmap],
      )
      recordLiveTelemetry({ type: 'frame-submitted' })
    } catch {
      clearTimeout(timer)
      waiters.delete(currentSeq)
      submittedAt.delete(currentSeq)
      recordLiveTelemetry({ type: 'frame-drop', reason: 'post_failed' })
      bitmap.close?.()
      finish(null)
    }
  })
}

export async function closeLiveBackend(): Promise<void> {
  const current = worker
  initPromise = null
  ready = false
  activeDelegate = null
  lastSentGeneration = -1
  releaseWaiters('backend_closed')
  if (!current) return

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500)
    current.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'closed') { clearTimeout(timer); resolve() }
    }
    try { current.postMessage({ type: 'close' }) } catch { clearTimeout(timer); resolve() }
  })
  if (worker === current) {
    worker = null
    current.terminate()
  }
  recordLiveTelemetry({ type: 'worker-close' })
}

export async function restartLiveBackend(): Promise<PoseBackendStartResult> {
  await closeLiveBackend()
  return startLiveBackend()
}

/** Reset sticky runtime demotion only when the whole capture lifecycle ends. */
export function resetLiveDelegatePreference(): void {
  preferCpuNextStart = false
}

function drop(bitmap: ImageBitmap, reason: LiveDropReason): Promise<null> {
  recordLiveTelemetry({ type: 'frame-drop', reason })
  bitmap.close?.()
  return Promise.resolve(null)
}

function asDropReason(value: unknown): LiveDropReason {
  return value === 'worker_detect_error' ? value : 'worker_gate'
}
