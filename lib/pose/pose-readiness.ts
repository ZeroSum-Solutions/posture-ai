export type PoseReadinessPhase = 'downloading' | 'initializing' | 'ready' | 'failed'
export type PoseBackendKind = 'live' | 'image'
export type PoseDelegate = 'gpu' | 'cpu'

export interface PoseReadiness {
  phase: PoseReadinessPhase
  backend: PoseBackendKind
  delegate: PoseDelegate | null
  message: string | null
}

export type PoseFailureCode =
  | 'unsupported'
  | 'timeout'
  | 'post_failed'
  | 'gpu_and_cpu_failed'
  | 'cpu_recovery_failed'
  | 'runtime_error'
  | 'detect_timeout'
  | 'detect_failed'

export type PoseBackendStartResult =
  | { ok: true; delegate: PoseDelegate }
  | { ok: false; code: PoseFailureCode; message: string }

export type PoseReadinessListener = (readiness: PoseReadiness) => void

export function readinessMessage(
  phase: PoseReadinessPhase,
  backend: PoseBackendKind,
  delegate: PoseDelegate | null = null,
  message: string | null = null,
): PoseReadiness {
  return { phase, backend, delegate, message }
}
