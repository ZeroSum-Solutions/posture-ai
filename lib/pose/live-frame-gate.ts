/**
 * Pure frame-admission guard for the live VIDEO worker (§4.1). Decides whether
 * an incoming frame should be run through `detectForVideo`, enforcing:
 *  - single in-flight detection (never overlap synchronous inference);
 *  - the current generation token (drop frames from a superseded phase/view);
 *  - strictly monotonic timestamps (MediaPipe VIDEO mode requires increasing ts);
 *  - `video.currentTime` dedup (skip an unchanged frame).
 * Extracted so the decision is unit-testable without a real Worker/GPU.
 */
export interface FrameGateState {
  inFlight: boolean
  lastTimestampMs: number
  lastCurrentTime: number
  /** The worker's current generation; frames from other generations are stale. */
  generation: number
}

export interface IncomingFrame {
  generation: number
  timestampMs: number
  currentTime: number
}

export function admitFrame(state: FrameGateState, f: IncomingFrame): boolean {
  if (state.inFlight) return false
  if (f.generation !== state.generation) return false
  if (f.timestampMs <= state.lastTimestampMs) return false
  if (f.currentTime === state.lastCurrentTime) return false
  return true
}
