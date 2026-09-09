import type { TrainingConditioningLogEventV1, TrainingSetLogEventV1 } from '@/lib/training/contracts/logs'
import { catalogOriginsMatch, type ExecutionContextV1 } from '@/lib/training/contracts/program'
import type { TrainingConditioningSessionPrescriptionV1, TrainingSessionPrescriptionV1 } from '@/lib/training/contracts/session'
import { TrainingCatalogOriginV1Schema } from '@/lib/training/catalog/types'
import {
  TrainingLaunchMediaProjectionV1Schema,
  type TrainingLaunchMediaProjectionV1,
} from '@/lib/training/media/contract'
import type { ExactLoadQuantity } from '@/lib/training/quantity'
import type { TrainingOfflineReplayOutcome, TrainingOfflineStoredEntry } from '@/lib/training/offline'

export type TrainingSessionState = 'scheduled' | 'in_progress' | 'completed' | 'completed_with_omissions' | 'aborted'

export type TrainingSessionProjection = {
  schemaVersion: 'training-session-projection.v1'
  session: {
    id: string
    subject_id: string
    assignment_id: string
    session_kind: 'strength' | 'conditioning'
    revision: number
    state: TrainingSessionState
    scheduled_local_date: string
    athlete_timezone: string
    stopped_for_symptoms: boolean
    updated_at: string
  }
  prescription: TrainingSessionPrescriptionV1 | TrainingConditioningSessionPrescriptionV1 | null
  executionContext: ExecutionContextV1
  currentActuals: TrainingSetLogEventV1[]
  currentConditioningActual: TrainingConditioningLogEventV1 | null
  exerciseDisplay: Record<string, {
    label: string
    textInstruction: string | null
    mediaStatus: 'reviewed_exact_variant' | 'reviewed_static_fixture' | 'missing'
    media?: TrainingLaunchMediaProjectionV1
  }>
  conditioningDisplay: { label: string; effortCue: string } | null
}

export type TrainingMutationAck = {
  schemaVersion: 'training-mutation-ack.v1'
  requestId: string
  sessionId: string
  revision: number
  state: Exclude<TrainingSessionState, 'scheduled'>
  event?: TrainingSetLogEventV1
  conditioningEvent?: TrainingConditioningLogEventV1
  missingSetCount?: number
}

export type TrainingSetActual = {
  quantity: ExactLoadQuantity
  reps: number
  rir: number | '6_plus' | 'unknown'
  side: 'bilateral' | 'left' | 'right' | 'not_applicable'
  symptomState: 'none' | 'adverse_reported'
  occurredAt: string
}

export type TrainingConditioningActual = {
  durationSeconds: number
  perceivedEffort: number | 'unknown'
  symptomState: 'none' | 'adverse_reported'
  occurredAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isExecutionContext(value: unknown): value is ExecutionContextV1 {
  if (!isRecord(value)) return false
  if (value.kind === 'live') return true
  return value.kind === 'synthetic_simulation'
    && typeof value.simulationRunId === 'string'
    && typeof value.fixtureId === 'string'
    && typeof value.fixtureHash === 'string'
    && value.label === 'Practice data'
}

function executionContextsMatch(left: ExecutionContextV1, right: ExecutionContextV1): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'live' || right.kind === 'live') return true
  return left.simulationRunId === right.simulationRunId
    && left.fixtureId === right.fixtureId
    && left.fixtureHash === right.fixtureHash
    && left.label === right.label
}

function hasExactExerciseDisplay(value: Record<string, unknown>, prescription: unknown): boolean {
  for (const [exerciseInstanceId, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)
      || typeof candidate.label !== 'string'
      || (candidate.textInstruction !== null && typeof candidate.textInstruction !== 'string')
      || !['reviewed_exact_variant', 'reviewed_static_fixture', 'missing'].includes(String(candidate.mediaStatus))) {
      return false
    }
    if (candidate.media === undefined) continue
    if (!isRecord(prescription)) return false
    const media = TrainingLaunchMediaProjectionV1Schema.safeParse(candidate.media)
    const catalogOrigin = TrainingCatalogOriginV1Schema.safeParse(prescription.catalogOrigin)
    if (!media.success
      || !catalogOrigin.success
      || prescription.schemaVersion !== 'training-session-prescription.v1'
      || media.data.binding.catalogVersion !== prescription.catalogVersion
      || !catalogOriginsMatch(media.data.binding.catalogOrigin, catalogOrigin.data)
      || !Array.isArray(prescription.exercises)) {
      return false
    }
    const exercise = prescription.exercises.find((item: unknown) => isRecord(item)
      && item.exerciseInstanceId === exerciseInstanceId)
    if (!isRecord(exercise)
      || media.data.binding.exerciseVersionId !== exercise.exerciseVersionId) {
      return false
    }
  }
  return true
}

function isProjection(value: unknown): value is TrainingSessionProjection {
  if (!isRecord(value) || value.schemaVersion !== 'training-session-projection.v1') return false
  if (!isRecord(value.session)
    || typeof value.session.id !== 'string'
    || !Number.isInteger(value.session.revision)
    || !Array.isArray(value.currentActuals)) return false
  if (!isExecutionContext(value.executionContext)) return false
  if (value.prescription !== null && !isRecord(value.prescription)) return false
  if (isRecord(value.prescription)
    && (!isExecutionContext(value.prescription.executionContext)
      || !executionContextsMatch(value.executionContext, value.prescription.executionContext))) return false
  if (!isRecord(value.exerciseDisplay)
    || !hasExactExerciseDisplay(value.exerciseDisplay, value.prescription)) return false
  if (value.conditioningDisplay !== null && !isRecord(value.conditioningDisplay)) return false
  return value.currentConditioningActual === null || isRecord(value.currentConditioningActual)
}

function isAck(value: unknown, sessionId: string, requestId: string): value is TrainingMutationAck {
  return isRecord(value)
    && value.schemaVersion === 'training-mutation-ack.v1'
    && value.sessionId === sessionId
    && value.requestId === requestId
    && Number.isInteger(value.revision)
    && typeof value.state === 'string'
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export class TrainingRevisionConflict extends Error {
  constructor(readonly current: TrainingSessionProjection) {
    super('Session changed elsewhere.')
  }
}

export class TrainingMutationFailure extends Error {
  constructor(
    message: string,
    readonly canRetryExact: boolean,
    readonly code = 'training_save_unavailable',
    readonly status = 0,
  ) {
    super(message)
  }
}

export async function readTrainingSession(sessionId: string): Promise<TrainingSessionProjection> {
  const response = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
  const body = await responseJson(response)
  if (!response.ok) throw new Error('Training session could not be loaded.')
  if (!isProjection(body) || body.session.id !== sessionId) throw new Error('Training session response was invalid.')
  return body
}

async function mutation(
  response: Response,
  sessionId: string,
  requestId: string,
): Promise<TrainingMutationAck> {
  const body = await responseJson(response)
  if (response.status === 409
    && isRecord(body)
    && body.error === 'training_revision_conflict'
    && isProjection(body.current)
    && body.current.session.id === sessionId) {
    throw new TrainingRevisionConflict(body.current)
  }
  if (response.status === 409 && isRecord(body) && body.error === 'training_completion_incomplete') {
    throw new TrainingMutationFailure(
      'Prescribed items are still missing. Log the remaining items or finish with omissions.',
      false,
      'training_completion_incomplete',
      response.status,
    )
  }
  if (response.status === 409 && isRecord(body) && body.error === 'training_request_id_conflict') {
    throw new TrainingMutationFailure(
      'This save request conflicted with an earlier request. Try saving again.',
      false,
      'training_request_id_conflict',
      response.status,
    )
  }
  if (response.status === 409 && isRecord(body) && body.error === 'training_session_stale') {
    throw new TrainingMutationFailure(
      'This session is over 24 hours old. Review saved work or stop the session; it cannot be completed as progression evidence.',
      false,
      'training_session_stale',
      response.status,
    )
  }
  if (!response.ok) {
    const code = isRecord(body)
      ? typeof body.error === 'string' ? body.error : typeof body.code === 'string' ? body.code : 'training_save_unavailable'
      : 'training_save_unavailable'
    throw new TrainingMutationFailure(
      'Training session could not be saved.',
      response.status >= 500 || response.status === 429,
      code,
      response.status,
    )
  }
  if (!isAck(body, sessionId, requestId)) {
    throw new TrainingMutationFailure('Training save response was invalid.', true, 'invalid_ack', response.status)
  }
  return body
}

async function sendMutation(url: string, init: RequestInit, sessionId: string, requestId: string): Promise<TrainingMutationAck> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new TrainingMutationFailure('Training session could not be saved.', true, 'network_error')
  }
  return mutation(response, sessionId, requestId)
}

export async function startTrainingSession(sessionId: string, expectedRevision: number): Promise<TrainingSessionProjection> {
  const response = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision }),
  })
  const body = await responseJson(response)
  if (response.status === 409 && isRecord(body) && isProjection(body.current)) throw new TrainingRevisionConflict(body.current)
  if (!response.ok || !isRecord(body) || body.schemaVersion !== 'training-start-ack.v1') {
    throw new Error('Training session could not be started.')
  }
  return readTrainingSession(sessionId)
}

export async function saveTrainingSet(input: {
  requestId: string
  sessionId: string
  setId: string
  expectedRevision: number
  actual: TrainingSetActual
}, signal?: AbortSignal): Promise<TrainingMutationAck> {
  return sendMutation(`/api/training/sessions/${encodeURIComponent(input.sessionId)}/sets/${encodeURIComponent(input.setId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: input.requestId, expectedRevision: input.expectedRevision, actual: input.actual }),
    ...(signal ? { signal } : {}),
  }, input.sessionId, input.requestId)
}

export async function saveTrainingConditioning(input: {
  requestId: string
  sessionId: string
  expectedRevision: number
  actual: TrainingConditioningActual
}, signal?: AbortSignal): Promise<TrainingMutationAck> {
  return sendMutation(`/api/training/sessions/${encodeURIComponent(input.sessionId)}/conditioning`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: input.requestId, expectedRevision: input.expectedRevision, actual: input.actual }),
    ...(signal ? { signal } : {}),
  }, input.sessionId, input.requestId)
}

export async function completeTrainingSession(input: {
  requestId: string
  sessionId: string
  expectedRevision: number
  finishMode: 'complete' | 'finish_with_omissions' | 'abort'
}, signal?: AbortSignal): Promise<TrainingMutationAck> {
  return sendMutation(`/api/training/sessions/${encodeURIComponent(input.sessionId)}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: input.requestId, expectedRevision: input.expectedRevision, finishMode: input.finishMode }),
    ...(signal ? { signal } : {}),
  }, input.sessionId, input.requestId)
}

export function classifyTrainingOfflineReplay(cause: unknown): TrainingOfflineReplayOutcome {
  if (cause instanceof TrainingRevisionConflict) return { kind: 'conflict' }
  if (!(cause instanceof TrainingMutationFailure) || cause.canRetryExact) return { kind: 'retry_later' }
  if (cause.code === 'training_request_id_conflict') return { kind: 'conflict' }
  if (cause.code === 'unauthorized') return { kind: 'denied', scope: 'user', reason: 'unauthenticated' }
  if (cause.code === 'training_actor_required') {
    return { kind: 'denied', scope: 'user', reason: 'authorization_revoked' }
  }
  if (cause.code === 'relationship_revoked') {
    return { kind: 'denied', scope: 'session', reason: 'relationship_revoked' }
  }
  if (cause.code === 'assignment_expired') {
    return { kind: 'denied', scope: 'session', reason: 'assignment_expired' }
  }
  if (cause.code === 'training_action_unavailable' || cause.code === 'training_session_unavailable') {
    return { kind: 'denied', scope: 'session', reason: 'action_unavailable' }
  }
  if (['invalid_training_id', 'invalid_json', 'invalid_training_payload', 'training_payload_too_large', 'training_completion_incomplete', 'training_session_stale'].includes(cause.code)) {
    return { kind: 'rejected', reason: cause.code }
  }
  return { kind: 'retry_later' }
}

export async function replayTrainingOfflineEntry(
  entry: TrainingOfflineStoredEntry,
  signal?: AbortSignal,
  send = {
    set: saveTrainingSet,
    conditioning: saveTrainingConditioning,
    completion: completeTrainingSession,
  },
): Promise<TrainingMutationAck> {
  const { envelope } = entry
  const mutation = envelope.mutation
  if (mutation.kind === 'set_actual') {
    return send.set({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      setId: mutation.setId,
      expectedRevision: mutation.expectedRevision,
      actual: mutation.actual,
    }, signal)
  }
  if (mutation.kind === 'conditioning_actual') {
    return send.conditioning({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      expectedRevision: mutation.expectedRevision,
      actual: mutation.actual,
    }, signal)
  }
  return send.completion({
    requestId: envelope.requestId,
    sessionId: envelope.sessionId,
    expectedRevision: mutation.expectedRevision,
    finishMode: mutation.finishMode,
  }, signal)
}
