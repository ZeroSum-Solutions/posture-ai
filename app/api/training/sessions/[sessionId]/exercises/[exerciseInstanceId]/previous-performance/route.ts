import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { readPreviousComparablePerformance } from '@/lib/training/persistence/previous-performance'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; exerciseInstanceId: string }> },
) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const { sessionId, exerciseInstanceId } = await params
  if (!TrainingStableIdV1Schema.safeParse(sessionId).success
    || !TrainingStableIdV1Schema.safeParse(exerciseInstanceId).success) {
    return trainingJson({ error: 'invalid_training_resource_id' }, 400)
  }
  const result = await readPreviousComparablePerformance(
    context.supabase, sessionId, exerciseInstanceId,
  )
  if ('kind' in result && result.kind === 'invalid_request') {
    return trainingJson({ error: 'invalid_training_resource_id' }, 400)
  }
  if ('kind' in result && result.kind === 'not_found') {
    return trainingJson({ error: 'training_session_unavailable' }, 404)
  }
  const status = result.result.kind === 'unavailable'
    && result.result.reason === 'persistence_unavailable' ? 503 : 200
  return trainingJson(result, status)
}
