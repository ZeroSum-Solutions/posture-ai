import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson, trainingMutationError, TrainingStartInputSchema, TrainingStartedPrescriptionSchema } from '@/lib/training/persistence/session-http'

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const { sessionId } = await params
  if (!TrainingStableIdV1Schema.safeParse(sessionId).success) return trainingJson({ error: 'invalid_session_id' }, 400)
  const body = await parseTrainingBody(request, TrainingStartInputSchema)
  if (!body.ok) return body.response
  const { data, error } = await context.supabase.rpc('start_training_session', {
    p_session_id: sessionId, p_expected_revision: body.data.expectedRevision,
  })
  if (error) return trainingMutationError(context.supabase, sessionId, error.code, error.message)
  const prescription = TrainingStartedPrescriptionSchema.safeParse(data)
  if (!prescription.success || prescription.data.sessionId !== sessionId) return trainingJson({ error: 'training_start_unavailable' }, 503)
  return trainingJson({ schemaVersion: 'training-start-ack.v1', prescription: prescription.data })
}
