import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  EligibilityAnswersV1Schema,
  ELIGIBILITY_ANSWERS_SCHEMA_VERSION,
  ELIGIBILITY_QUESTIONNAIRE_SOURCE_VERSION,
} from '@/lib/training/contracts/eligibility'
import { isTrainingConflictCode } from '@/lib/training/persistence/conflict'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

const inputSchema = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  answers: EligibilityAnswersV1Schema.omit({
    schemaVersion: true, questionnaireSourceVersion: true, submittedAt: true, origin: true,
  }),
}).strict()
const receiptSchema = z.object({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  source_revision_id: z.string().uuid(),
  answers_hash: z.string().regex(/^[a-f0-9]{64}$/),
  hash_encoding: z.literal('postgres-jsonb-text-utf8.v1'),
}).strict()

export async function GET() {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  if (context.actor.actorKind !== 'athlete' || !context.actor.subjectId) {
    return trainingJson({ error: 'athlete_self_report_required' }, 403)
  }
  const { data, error } = await context.supabase.from('training_eligibility_responses')
    .select('revision,source_revision_id,answers_json')
    .eq('subject_id', context.actor.subjectId)
    .order('revision', { ascending: false }).limit(1).maybeSingle()
  if (error) return trainingJson({ error: 'eligibility_answers_unavailable' }, 503)
  const parsed = z.object({
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    source_revision_id: z.string().min(1).max(160),
    answers_json: EligibilityAnswersV1Schema,
  }).strict().nullable().safeParse(data)
  if (!parsed.success) return trainingJson({ error: 'eligibility_answers_unavailable' }, 503)
  return trainingJson({
    schemaVersion: 'training-eligibility-answers-projection.v1',
    subjectId: context.actor.subjectId,
    current: parsed.data === null ? null : {
      revision: parsed.data.revision,
      sourceRevisionId: parsed.data.source_revision_id,
      answers: parsed.data.answers_json,
    },
  })
}

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  if (context.actor.actorKind !== 'athlete' || !context.actor.subjectId) {
    return trainingJson({ error: 'athlete_self_report_required' }, 403)
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return trainingJson({ error: 'invalid_eligibility_answers' }, 422)
  const sourceRevisionId = randomUUID()
  const answers = {
    ...input.data.answers,
    schemaVersion: ELIGIBILITY_ANSWERS_SCHEMA_VERSION,
    questionnaireSourceVersion: ELIGIBILITY_QUESTIONNAIRE_SOURCE_VERSION,
    submittedAt: new Date().toISOString(),
    origin: { kind: 'athlete_self_report' as const },
  }
  const { data, error } = await context.supabase.rpc('append_training_eligibility_response', {
    p_subject_id: context.actor.subjectId,
    p_expected_revision: input.data.expectedRevision,
    p_source_revision_id: sourceRevisionId,
    p_answers_json: answers,
  })
  if (error) {
    if (isTrainingConflictCode(error.code)) return trainingJson({ error: 'eligibility_answers_revision_conflict', action: 'refresh_answers' }, 409)
    if (error.code === '22023') return trainingJson({ error: 'invalid_eligibility_answers' }, 422)
    if (error.code === '42501' || error.code === 'P0001') return trainingJson({ error: 'eligibility_answers_forbidden' }, 403)
    return trainingJson({ error: 'eligibility_answers_unavailable' }, 503)
  }
  const receipt = z.array(receiptSchema).length(1).safeParse(data)
  if (!receipt.success || receipt.data[0].source_revision_id !== sourceRevisionId
    || receipt.data[0].revision !== input.data.expectedRevision + 1) {
    return trainingJson({ error: 'eligibility_answers_receipt_unavailable' }, 503)
  }
  return trainingJson({
    schemaVersion: 'training-eligibility-answer-receipt.v1',
    subjectId: context.actor.subjectId,
    revision: receipt.data[0].revision,
    sourceRevisionId,
    status: 'answers_saved',
    decisionCreated: false,
  }, 201)
}
