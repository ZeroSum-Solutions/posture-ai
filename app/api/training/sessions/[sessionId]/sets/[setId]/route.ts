import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson, trainingMutationError, TrainingMutationAckSchema, TrainingSetMutationInputSchema } from '@/lib/training/persistence/session-http'

export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string; setId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const { sessionId, setId } = await params
  if (![sessionId, setId].every(id => TrainingStableIdV1Schema.safeParse(id).success)) return trainingJson({ error: 'invalid_training_id' }, 400)
  const body = await parseTrainingBody(request, TrainingSetMutationInputSchema)
  if (!body.ok) return body.response
  const { data, error } = await context.supabase.rpc('write_training_set_log', {
    p_session_id: sessionId, p_set_id: setId, p_expected_revision: body.data.expectedRevision,
    p_request_id: body.data.requestId, p_actual: body.data.actual,
  })
  if (error) return trainingMutationError(context.supabase, sessionId, error.code, error.message)
  const ack = TrainingMutationAckSchema.safeParse(data)
  if (!ack.success || ack.data.sessionId !== sessionId || ack.data.requestId !== body.data.requestId
    || ack.data.event?.sessionId !== sessionId || ack.data.event.setId !== setId
    || ack.data.event.actor.userId !== context.actor.userId) {
    return trainingJson({ error: 'training_save_unavailable' }, 503)
  }
  return trainingJson(ack.data)
}
