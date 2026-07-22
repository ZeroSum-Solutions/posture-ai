// Live VIDEO pose Worker (design §4.1). Owns exactly ONE lite PoseLandmarker in
// runningMode:'VIDEO' so synchronous inference stays off the render thread. The
// main thread transfers frames as ImageBitmap; the worker returns landmarks +
// {generation, timestampMs}. Stale / in-flight / unchanged / non-monotonic
// frames are dropped by the pure `admitFrame` gate, and every ImageBitmap is
// closed exactly once (§11.7 bitmap ownership).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { WASM_URL, LITE_MODEL_URL, assertPoseOnlyModel, mapLandmarks } from './pose-model'
import { admitFrame, type FrameGateState } from './live-frame-gate'
import { settleBeforeDeadline } from './async-deadline'

// Structural view of the DedicatedWorkerGlobalScope (the project's tsconfig lib
// omits "webworker", so we avoid its global types).
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
}

type InitMsg = { type: 'init'; preferCpu?: boolean }
type GenerationMsg = { type: 'generation'; generation: number }
type FrameMsg = { type: 'frame'; seq: number; bitmap: ImageBitmap; generation: number; timestampMs: number; currentTime: number }
type CloseMsg = { type: 'close' }
type InMsg = InitMsg | GenerationMsg | FrameMsg | CloseMsg

let landmarker: PoseLandmarker | null = null
const gate: FrameGateState = { inFlight: false, lastTimestampMs: -Infinity, lastCurrentTime: NaN, generation: 0 }
// The lite model alone needs about 4.6 seconds to cross the frozen 10 Mbps
// profile before parsing/initialization. Five seconds made every true cold
// attempt fail before the 20-second end-to-end camera budget could be measured.
const DELEGATE_INIT_TIMEOUT_MS = 10_000

function createLandmarker(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: 'GPU' | 'CPU',
) {
  return settleBeforeDeadline(
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: LITE_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
    DELEGATE_INIT_TIMEOUT_MS,
    late => { try { late.close() } catch { /* lifecycle already moved on */ } },
    `${delegate} live pose-model initialization timed out.`,
  )
}

async function init(preferCpu = false) {
  ctx.postMessage({ type: 'phase', phase: 'downloading', message: 'Downloading live pose runtime.' })
  try {
    assertPoseOnlyModel(LITE_MODEL_URL)
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    if (preferCpu) {
      ctx.postMessage({ type: 'phase', phase: 'initializing', delegate: 'cpu', message: 'Recovering live pose tracking on CPU.' })
      try {
        landmarker = await createLandmarker(vision, 'CPU')
        ctx.postMessage({ type: 'ready', delegate: 'cpu' })
      } catch (cpuError) {
        ctx.postMessage({
          type: 'error',
          code: 'cpu_recovery_failed',
          message: `CPU live pose recovery failed: ${cpuError instanceof Error ? cpuError.message : String(cpuError)}`,
        })
      }
      return
    }
    ctx.postMessage({ type: 'phase', phase: 'initializing', delegate: 'gpu', message: 'Initializing GPU live pose model.' })
    try {
      landmarker = await createLandmarker(vision, 'GPU')
      ctx.postMessage({ type: 'ready', delegate: 'gpu' })
      return
    } catch (gpuError) {
      ctx.postMessage({ type: 'phase', phase: 'initializing', delegate: 'cpu', message: 'GPU unavailable. Initializing CPU live pose model.' })
      try {
        landmarker = await createLandmarker(vision, 'CPU')
        ctx.postMessage({ type: 'ready', delegate: 'cpu' })
        return
      } catch (cpuError) {
        const gpuMessage = gpuError instanceof Error ? gpuError.message : String(gpuError)
        const cpuMessage = cpuError instanceof Error ? cpuError.message : String(cpuError)
        ctx.postMessage({
          type: 'error',
          code: 'gpu_and_cpu_failed',
          message: `Live pose model could not start on GPU or CPU. GPU: ${gpuMessage} CPU: ${cpuMessage}`,
        })
        return
      }
    }
  } catch (error) {
    // Init failure → the main thread degrades to sensor-only guides.
    ctx.postMessage({
      type: 'error',
      code: 'gpu_and_cpu_failed',
      message: error instanceof Error ? error.message : 'Live pose runtime failed to initialize.',
    })
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
  } catch (error) {
    // A synchronous MediaPipe runtime failure invalidates this worker. The main
    // thread terminates it and can construct a fresh GPU→CPU attempt on retry.
    ctx.postMessage({
      type: 'runtime-error',
      seq: msg.seq,
      code: 'runtime_error',
      message: error instanceof Error ? error.message : 'Live pose detection failed.',
    })
  } finally {
    msg.bitmap.close?.()
    gate.inFlight = false
  }
}

ctx.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InMsg
  switch (msg.type) {
    case 'init':
      void init(msg.preferCpu === true)
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
