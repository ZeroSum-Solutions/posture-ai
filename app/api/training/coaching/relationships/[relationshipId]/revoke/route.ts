import { RevokeTrainingCoachingRelationshipInputV1Schema } from '@/lib/training/contracts/coaching-relationship'
import { z } from 'zod'
import {
  TrainingCoachingRelationshipError,
  createSupabaseTrainingCoachingRelationshipDependencies,
  revokeTrainingCoachingRelationship,
} from '@/lib/training/persistence/coaching-relationships'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ relationshipId: string }> },
) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = RevokeTrainingCoachingRelationshipInputV1Schema.safeParse(
    await request.json().catch(() => null),
  )
  if (!body.success) return trainingJson({ error: 'invalid_relationship_revocation' }, 422)
  const { relationshipId } = await params
  if (!z.string().uuid().safeParse(relationshipId).success) {
    return trainingJson({ error: 'invalid_relationship_id' }, 400)
  }
  try {
    return trainingJson(await revokeTrainingCoachingRelationship(
      body.data.requestId,
      relationshipId,
      body.data.expectedRevision,
      context.actor,
      createSupabaseTrainingCoachingRelationshipDependencies(context.supabase),
    ))
  } catch (error) {
    if (error instanceof TrainingCoachingRelationshipError) {
      if (error.code === 'relationship_revision_conflict') {
        return trainingJson({ error: error.code, action: 'reload_relationships' }, 409)
      }
      if (error.code === 'relationship_request_conflict') {
        return trainingJson({ error: error.code, action: 'reload_relationships' }, 409)
      }
      if (error.code === 'relationship_revocation_forbidden') {
        return trainingJson({ error: error.code }, 403)
      }
    }
    return trainingJson({ error: 'relationship_revocation_unavailable' }, 503)
  }
}
