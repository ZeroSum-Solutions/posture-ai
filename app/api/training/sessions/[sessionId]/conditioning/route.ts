import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson, trainingMutationError, TrainingMutationAckSchema, TrainingConditioningMutationInputSchema } from '@/lib/training/persistence/session-http'

export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const { sessionId } = await params
  if (!TrainingStableIdV1Schema.safeParse(sessionId).success) return trainingJson({ error: 'invalid_training_id' }, 400)
  const body = await parseTrainingBody(request, TrainingConditioningMutationInputSchema)
  if (!body.ok) return body.response
  const { data, error } = await context.supabase.rpc('write_training_conditioning_log', {
    p_session_id: sessionId, p_expected_revision: body.data.expectedRevision,
    p_request_id: body.data.requestId, p_actual: body.data.actual,
  })
  if (error) return trainingMutationError(context.supabase, sessionId, error.code, error.message)
  const ack = TrainingMutationAckSchema.safeParse(data)
  if (!ack.success || ack.data.sessionId !== sessionId || ack.data.requestId !== body.data.requestId
    || ack.data.conditioningEvent?.sessionId !== sessionId
    || ack.data.conditioningEvent.actor.userId !== context.actor.userId) {
    return trainingJson({ error: 'training_save_unavailable' }, 503)
  }
  return trainingJson(ack.data)
}
