import type { TrainingConditioningLogEventV1, TrainingSetLogEventV1 } from '@/lib/training/contracts/logs'
import type { ExecutionContextV1 } from '@/lib/training/contracts/program'
import type { TrainingConditioningSessionPrescriptionV1, TrainingSessionPrescriptionV1 } from '@/lib/training/contracts/session'
import type { ExactLoadQuantity } from '@/lib/training/quantity'

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
  exerciseDisplay: Record<string, { label: string; textInstruction: string | null; mediaStatus: string }>
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
  if (!isRecord(value.exerciseDisplay)) return false
  if (value.conditioningDisplay !== null && !isRecord(value.conditioningDisplay)) return false
  return value.currentConditioningActual === null || isRecord(value.currentConditioningActual)
}

function isAck(value: unknown, sessionId: string): value is TrainingMutationAck {
  return isRecord(value)
    && value.schemaVersion === 'training-mutation-ack.v1'
    && value.sessionId === sessionId
    && typeof value.requestId === 'string'
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
): Promise<TrainingMutationAck> {
  const body = await responseJson(response)
  if (response.status === 409 && isRecord(body) && body.error === 'training_revision_conflict' && isProjection(body.current)) {
    throw new TrainingRevisionConflict(body.current)
  }
  if (response.status === 409 && isRecord(body) && body.error === 'training_completion_incomplete') {
    throw new Error('Prescribed items are still missing. Log the remaining items or finish with omissions.')
  }
  if (response.status === 409 && isRecord(body) && body.error === 'training_request_id_conflict') {
    throw new Error('This save request conflicted with an earlier request. Try saving again.')
  }
  if (!response.ok) throw new Error('Training session could not be saved.')
  if (!isAck(body, sessionId)) throw new Error('Training save response was invalid.')
  return body
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
  sessionId: string
  setId: string
  expectedRevision: number
  actual: TrainingSetActual
}): Promise<TrainingMutationAck> {
  const response = await fetch(`/api/training/sessions/${encodeURIComponent(input.sessionId)}/sets/${encodeURIComponent(input.setId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: input.expectedRevision, actual: input.actual }),
  })
  return mutation(response, input.sessionId)
}

export async function saveTrainingConditioning(input: {
  sessionId: string
  expectedRevision: number
  actual: TrainingConditioningActual
}): Promise<TrainingMutationAck> {
  const response = await fetch(`/api/training/sessions/${encodeURIComponent(input.sessionId)}/conditioning`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: input.expectedRevision, actual: input.actual }),
  })
  return mutation(response, input.sessionId)
}

export async function completeTrainingSession(input: {
  sessionId: string
  expectedRevision: number
  finishMode: 'complete' | 'finish_with_omissions' | 'abort'
}): Promise<TrainingMutationAck> {
  const response = await fetch(`/api/training/sessions/${encodeURIComponent(input.sessionId)}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: input.expectedRevision, finishMode: input.finishMode }),
  })
  return mutation(response, input.sessionId)
}
