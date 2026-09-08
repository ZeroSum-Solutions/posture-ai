import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { readTrainingSessionProjection, trainingJson } from '@/lib/training/persistence/session-http'

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const { sessionId } = await params
  if (!TrainingStableIdV1Schema.safeParse(sessionId).success) return trainingJson({ error: 'invalid_session_id' }, 400)
  const result = await readTrainingSessionProjection(context.supabase, sessionId)
  if (result.kind !== 'found') return trainingJson({ error: 'training_session_unavailable' }, result.kind === 'not_found' ? 404 : 503)
  return trainingJson(result.value)
}
