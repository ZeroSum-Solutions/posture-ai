'use client'
// Main-thread wrapper around the live VIDEO pose Worker. Best-effort by design:
// if the Worker can't be spawned, or its GPU/WASM init fails, every call
// degrades to a no-op (null result) so capture keeps working with sensor-only
// guides (§4.1 fallback). Enforces single-in-flight on this side too, and syncs
// the worker's generation token so stale-view frames are dropped in the worker.

import type { LiveFrameMeta, LiveResult } from './capture-runtime'

let worker: Worker | null = null
let ready = false
let initPromise: Promise<void> | null = null
let lastSentGeneration = -1
let inFlight = false
let seq = 0
const waiters = new Map<number, (r: LiveResult | null) => void>()

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
    const w = spawn()
    if (!w) { resolve(); return }
    worker = w
    lastSentGeneration = -1
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg?.type === 'ready') { ready = true; done() }
      else if (msg?.type === 'error') { ready = false; done() }
      else if (msg?.type === 'result') {
        const cb = waiters.get(msg.seq)
        if (cb) { waiters.delete(msg.seq); cb(msg.result ?? null) }
      }
    }
    w.onerror = () => { ready = false; done() }
    try { w.postMessage({ type: 'init' }) } catch { done() }
    // Never block the state machine forever on a silent worker.
    setTimeout(done, 8000)
  })
  return initPromise
}

export function detectLiveBackend(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null> {
  // Not ready, a detect is already pending, or a stale-generation frame arrived
  // (an old view's bitmap resolved late) — drop it and release its bitmap so the
  // live loop can't accumulate GPU memory or waste inference on the old view.
  if (!worker || !ready || inFlight || meta.generation < lastSentGeneration) { bitmap.close?.(); return Promise.resolve(null) }
  // Sync the worker's generation token — monotonically, so it never moves backward.
  if (meta.generation > lastSentGeneration) {
    try { worker.postMessage({ type: 'generation', generation: meta.generation }) } catch { /* ignore */ }
    lastSentGeneration = meta.generation
  }
  const s = ++seq
  inFlight = true
  return new Promise<LiveResult | null>((resolve) => {
    const finish = (r: LiveResult | null) => { inFlight = false; resolve(r) }
    waiters.set(s, finish)
    try {
      worker!.postMessage({ type: 'frame', seq: s, bitmap, generation: meta.generation, timestampMs: meta.timestampMs, currentTime: meta.currentTime }, [bitmap])
    } catch {
      waiters.delete(s); bitmap.close?.(); finish(null); return
    }
    // Guard against a lost message so the loop never hangs on `inFlight`.
    setTimeout(() => { if (waiters.delete(s)) finish(null) }, 1000)
  })
}

export async function closeLiveBackend(): Promise<void> {
  const w = worker
  worker = null
  ready = false
  initPromise = null
  inFlight = false
  lastSentGeneration = -1
  waiters.forEach(cb => cb(null))
  waiters.clear()
  if (!w) return
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 500)
    w.onmessage = (e: MessageEvent) => { if (e.data?.type === 'closed') { clearTimeout(t); resolve() } }
    try { w.postMessage({ type: 'close' }) } catch { clearTimeout(t); resolve() }
  })
  w.terminate()
}
