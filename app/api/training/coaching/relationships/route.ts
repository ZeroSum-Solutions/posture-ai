import { z } from 'zod'
import {
  TrainingCoachingRelationshipError,
  createSupabaseTrainingCoachingRelationshipDependencies,
  readTrainingCoachingRelationships,
} from '@/lib/training/persistence/coaching-relationships'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

const subjectIdSchema = z.string().uuid()

export async function GET(request: Request) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const query = new URL(request.url).searchParams
  let subjectId: string
  if (context.actor.actorKind === 'athlete') {
    if (query.size !== 0 || !context.actor.subjectId) {
      return trainingJson({ error: 'invalid_relationship_query' }, 400)
    }
    subjectId = context.actor.subjectId
  } else {
    if (query.size !== 1 || query.getAll('subjectId').length !== 1) {
      return trainingJson({ error: 'invalid_relationship_query' }, 400)
    }
    const parsed = subjectIdSchema.safeParse(query.get('subjectId'))
    if (!parsed.success) return trainingJson({ error: 'invalid_subject_id' }, 400)
    subjectId = parsed.data
  }

  try {
    return trainingJson(await readTrainingCoachingRelationships(
      subjectId,
      context.actor,
      createSupabaseTrainingCoachingRelationshipDependencies(context.supabase),
    ))
  } catch (error) {
    if (error instanceof TrainingCoachingRelationshipError
      && error.code === 'relationship_projection_forbidden') {
      return trainingJson({ error: error.code }, 403)
    }
    return trainingJson({ error: 'relationship_projection_unavailable' }, 503)
  }
}

