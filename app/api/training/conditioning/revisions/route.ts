import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import {
  ConditioningRevisionError,
  createSupabaseConditioningRevisionReadDependencies,
  readConditioningRevisionOptions,
} from '@/lib/training/persistence/conditioning-revisions'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

export async function GET(request: Request) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const query = new URL(request.url).searchParams
  if (query.size !== 1 || query.getAll('assignmentId').length !== 1) {
    return trainingJson({ error: 'invalid_training_query' }, 400)
  }
  const assignmentId = TrainingStableIdV1Schema.safeParse(query.get('assignmentId'))
  if (!assignmentId.success) return trainingJson({ error: 'invalid_assignment_id' }, 400)
  try {
    return trainingJson(await readConditioningRevisionOptions(
      assignmentId.data,
      context.actor,
      createSupabaseConditioningRevisionReadDependencies(context.supabase),
    ))
  } catch (error) {
    if (error instanceof ConditioningRevisionError && error.code === 'conditioning_revision_forbidden') {
      return trainingJson({ error: error.code }, 403)
    }
    return trainingJson({ error: 'conditioning_revision_unavailable' }, 503)
  }
}
