import { isTrainingConflictCode } from '@/lib/training/persistence/conflict'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import { ExactLoadQuantityV1Schema, TrainingStableIdV1Schema, ExecutionContextV1Schema, executionContextsMatch } from '../contracts/program'
import { TrainingSetLogEventV1Schema, TrainingConditioningLogEventV1Schema, TrainingConditioningActualInputV1Schema } from '../contracts/logs'
import { TrainingSessionPrescriptionV1Schema, TrainingConditioningSessionPrescriptionV1Schema } from '../contracts/session'

import { trainingSessionDisplay } from './session-display'

type TrainingClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const TrainingSessionLifecycleDenialSchema = z.enum([
  'relationship_revoked',
  'assignment_expired',
])
export type TrainingSessionLifecycleDenial = z.infer<typeof TrainingSessionLifecycleDenialSchema>

export const TrainingSetActualInputSchema = z.object({
  quantity: ExactLoadQuantityV1Schema,
  reps: z.number().int().min(0).max(100),
  rir: z.union([z.number().int().min(0).max(5), z.literal('6_plus'), z.literal('unknown')]),
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  symptomState: z.enum(['none', 'adverse_reported']),
  occurredAt: z.string().datetime({ offset: true }),
}).strict()

export const TrainingSetMutationInputSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: revisionSchema,
  actual: TrainingSetActualInputSchema,
}).strict()
export const TrainingConditioningMutationInputSchema = z.object({
  requestId: z.string().uuid(), expectedRevision: revisionSchema, actual: TrainingConditioningActualInputV1Schema,
}).strict()
export const TrainingStartedPrescriptionSchema = z.union([TrainingSessionPrescriptionV1Schema, TrainingConditioningSessionPrescriptionV1Schema])
export const TrainingCompletionInputSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: revisionSchema,
  finishMode: z.enum(['complete', 'finish_with_omissions', 'abort']),
}).strict()
export const TrainingStartInputSchema = z.object({ expectedRevision: revisionSchema }).strict()

export const TrainingMutationAckSchema = z.object({
  schemaVersion: z.literal('training-mutation-ack.v1'),
  requestId: z.string().uuid(),
  sessionId: TrainingStableIdV1Schema,
  revision: revisionSchema,
  state: z.enum(['in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  event: TrainingSetLogEventV1Schema.optional(),
  conditioningEvent: TrainingConditioningLogEventV1Schema.optional(),
  missingSetCount: z.number().int().min(0).optional(),
}).strict()

const sessionRowSchema = z.object({
  id: TrainingStableIdV1Schema,
  subject_id: z.string().uuid(),
  assignment_id: TrainingStableIdV1Schema,
  session_kind: z.enum(['strength', 'conditioning']),
  revision: revisionSchema,
  state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  scheduled_local_date: z.string(),
  athlete_timezone: z.string(),
  stopped_for_symptoms: z.boolean(),
  updated_at: z.string(),
  completed_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export async function readTrainingSessionProjection(client: TrainingClient, sessionId: string) {
  const { data, error } = await client.rpc('read_training_session_projection', { p_session_id: sessionId })
  if (error) return { kind: 'unavailable' } as const
  if (data === null) return { kind: 'not_found' } as const
  const parsed = z.object({
    session: sessionRowSchema,
    executionContext: ExecutionContextV1Schema,
    prescription: TrainingStartedPrescriptionSchema.nullable(),
    currentActuals: z.array(TrainingSetLogEventV1Schema).max(600),
    currentConditioningActual: TrainingConditioningLogEventV1Schema.nullable(),
  }).strict().safeParse(data)
  if (!parsed.success) return { kind: 'unavailable' } as const
  const { session, executionContext, prescription, currentActuals, currentConditioningActual } = parsed.data
  if (session.id !== sessionId || (prescription && (prescription.sessionId !== sessionId || prescription.subjectId !== session.subject_id || prescription.assignmentId !== session.assignment_id))) {
    return { kind: 'unavailable' } as const
  }
  if (prescription && !executionContextsMatch(executionContext, prescription.executionContext)) return { kind: 'unavailable' } as const
  if ((!prescription && session.state !== 'scheduled') || (!prescription && currentActuals.length > 0)) {
    return { kind: 'unavailable' } as const
  }
  if (currentActuals.some(actual => actual.sessionId !== sessionId || actual.subjectId !== session.subject_id)) {
    return { kind: 'unavailable' } as const
  }
  const isStrength = prescription?.schemaVersion === 'training-session-prescription.v1'
  if (prescription && ((session.session_kind === 'strength') !== isStrength)) return { kind: 'unavailable' } as const
  if (currentActuals.length > 0 && !isStrength) return { kind: 'unavailable' } as const
  if (currentConditioningActual && (!prescription || isStrength
    || currentConditioningActual.sessionId !== sessionId
    || currentConditioningActual.subjectId !== session.subject_id
    || currentConditioningActual.boutId !== prescription.acceptedBout.boutId
    || currentConditioningActual.modalityId !== prescription.acceptedBout.modalityId
    || !executionContextsMatch(currentConditioningActual.executionContext, prescription.executionContext))) {
    return { kind: 'unavailable' } as const
  }
  if (isStrength && currentActuals.some(actual => {
    const exercise = prescription.exercises.find(item => item.exerciseInstanceId === actual.exerciseInstanceId)
    const workingIndex = exercise?.setIds.indexOf(actual.setId) ?? -1
    const isWarmup = exercise?.warmupSets?.some(set => set.setId === actual.setId) ?? false
    return (!isWarmup && workingIndex < 0)
      || (isWarmup && (actual.setKind !== 'warmup' || actual.workingSetOrdinal !== null))
      || (workingIndex >= 0 && (actual.setKind !== 'working' || actual.workingSetOrdinal !== workingIndex + 1))
      || !executionContextsMatch(actual.executionContext, prescription.executionContext)
  })) return { kind: 'unavailable' } as const
  return {
    kind: 'found',
    value: { schemaVersion: 'training-session-projection.v1', session, executionContext, prescription, currentActuals, currentConditioningActual, ...trainingSessionDisplay(prescription) },
  } as const
}

export function trainingJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function parseTrainingBody<T>(request: Request, schema: z.ZodType<T>) {
  let raw: unknown
  try {
    const text = await request.text()
    if (text.length > 8_192) return { ok: false, response: trainingJson({ error: 'training_payload_too_large' }, 413) } as const
    raw = JSON.parse(text)
  } catch {
    return { ok: false, response: trainingJson({ error: 'invalid_json' }, 400) } as const
  }
  const parsed = schema.safeParse(raw)
  return parsed.success
    ? { ok: true, data: parsed.data } as const
    : { ok: false, response: trainingJson({ error: 'invalid_training_payload' }, 422) } as const
}

export async function trainingMutationError(client: TrainingClient, sessionId: string, code: string | undefined, message?: string) {
  if (isTrainingConflictCode(code)) {
    if (message === 'training session has unlogged sets') {
      return trainingJson({ error: 'training_completion_incomplete', action: 'log_remaining_or_finish_with_omissions' }, 409)
    }
    if (message === 'training request ID reused with different content') {
      return trainingJson({ error: 'training_request_id_conflict', action: 'retry_with_new_request' }, 409)
    }
    const current = await readTrainingSessionProjection(client, sessionId)
    if (current.kind !== 'found') return trainingJson({ error: 'training_session_unavailable' }, current.kind === 'not_found' ? 404 : 503)
    return trainingJson({ error: 'training_revision_conflict', current: current.value }, 409)
  }
  if (code === '22023' || code === '23514') return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (code === 'P0001' && message === 'training session is stale') {
    return trainingJson({ error: 'training_session_stale', action: 'review_or_abort' }, 409)
  }
  if (code === 'P0001' || code === '42501') {
    try {
      const lifecycle = await client.rpc('read_training_session_lifecycle_denial', {
        p_session_id: sessionId,
      })
      if (lifecycle && !lifecycle.error) {
        const denial = TrainingSessionLifecycleDenialSchema.safeParse(lifecycle.data)
        if (denial.success) {
          return trainingJson({ error: denial.data, action: 'clear_session_scope' }, 403)
        }
      }
    } catch {
      // Error classification is advisory; retain the original denial if the
      // scoped lifecycle projection is unavailable.
    }
    return trainingJson({ error: 'training_action_unavailable' }, 403)
  }
  return trainingJson({ error: 'training_save_unavailable' }, 503)
}
