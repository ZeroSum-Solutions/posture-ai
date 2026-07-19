// Live VIDEO pose Worker (design §4.1). Owns exactly ONE lite PoseLandmarker in
// runningMode:'VIDEO' so synchronous inference stays off the render thread. The
// main thread transfers frames as ImageBitmap; the worker returns landmarks +
// {generation, timestampMs}. Stale / in-flight / unchanged / non-monotonic
// frames are dropped by the pure `admitFrame` gate, and every ImageBitmap is
// closed exactly once (§11.7 bitmap ownership).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { WASM_URL, LITE_MODEL_URL, assertPoseOnlyModel, mapLandmarks } from './pose-model'
import { admitFrame, type FrameGateState } from './live-frame-gate'

// Structural view of the DedicatedWorkerGlobalScope (the project's tsconfig lib
// omits "webworker", so we avoid its global types).
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
}

type InitMsg = { type: 'init' }
type GenerationMsg = { type: 'generation'; generation: number }
type FrameMsg = { type: 'frame'; seq: number; bitmap: ImageBitmap; generation: number; timestampMs: number; currentTime: number }
type CloseMsg = { type: 'close' }
type InMsg = InitMsg | GenerationMsg | FrameMsg | CloseMsg

let landmarker: PoseLandmarker | null = null
const gate: FrameGateState = { inFlight: false, lastTimestampMs: -Infinity, lastCurrentTime: NaN, generation: 0 }

async function init() {
  try {
    assertPoseOnlyModel(LITE_MODEL_URL)
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    let delegate: 'gpu' | 'cpu' = 'gpu'
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: LITE_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    } catch {
      delegate = 'cpu'
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: LITE_MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    }
    ctx.postMessage({ type: 'ready', delegate })
  } catch {
    // Init failure → the main thread degrades to sensor-only guides.
    ctx.postMessage({ type: 'error' })
  }
}

function handleFrame(msg: FrameMsg) {
  const admitted = landmarker !== null && admitFrame(gate, { generation: msg.generation, timestampMs: msg.timestampMs, currentTime: msg.currentTime })
  if (!admitted) {
    msg.bitmap.close?.()
    ctx.postMessage({ type: 'result', seq: msg.seq, result: null, dropReason: 'worker_gate' })
    return
  }
  gate.inFlight = true
  gate.lastTimestampMs = msg.timestampMs
  gate.lastCurrentTime = msg.currentTime
  try {
    const startedAt = performance.now()
    const result = landmarker!.detectForVideo(msg.bitmap, msg.timestampMs)
    const inferenceMs = performance.now() - startedAt
    const landmarks = mapLandmarks(result.landmarks?.[0])
    ctx.postMessage({ type: 'result', seq: msg.seq, result: { landmarks, generation: msg.generation, timestampMs: msg.timestampMs, inferenceMs } })
  } catch {
    ctx.postMessage({ type: 'result', seq: msg.seq, result: null, dropReason: 'worker_detect_error' })
  } finally {
    msg.bitmap.close?.()
    gate.inFlight = false
  }
}

ctx.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InMsg
  switch (msg.type) {
    case 'init':
      void init()
      break
    case 'generation':
      // A new phase/view: bump the token so any late frames from the old view
      // are dropped, and reset the monotonic-timestamp / dedup baselines. Never
      // move the generation backward (stale message) — that would re-admit an old
      // view's frames.
      if (msg.generation >= gate.generation) {
        gate.generation = msg.generation
        gate.lastTimestampMs = -Infinity
        gate.lastCurrentTime = NaN
      }
      break
    case 'frame':
      handleFrame(msg)
      break
    case 'close':
      try { landmarker?.close() } catch { /* already torn down */ }
      landmarker = null
      ctx.postMessage({ type: 'closed' })
      break
  }
})
