import { z } from 'zod'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import type { TrainingServerActor } from '@/lib/training/access/server-actor'
import {
  TrainingCoachingRelationshipListV1Schema,
  TrainingCoachingRelationshipRevocationV1Schema,
  type TrainingCoachingRelationshipListV1,
  type TrainingCoachingRelationshipRevocationV1,
} from '@/lib/training/contracts/coaching-relationship'
import { TrainingCoachPermissionSchema } from '@/lib/training/invitations/prepare'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>
type TrainingClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type DatabaseError = { readonly code?: string; readonly message?: string }
type DatabaseResult = { readonly data: unknown; readonly error: DatabaseError | null }

const relationshipRowSchema = z.object({
  id: z.string().uuid(),
  subject_id: z.string().uuid(),
  practitioner_id: z.string().uuid(),
  status: z.enum(['active', 'revoked']),
  permissions: z.array(TrainingCoachPermissionSchema).min(1).max(10),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()

export interface TrainingCoachingRelationshipDependencies {
  loadRelationships(subjectId: string): Promise<DatabaseResult>
  revokeRelationship(requestId: string, relationshipId: string, expectedRevision: number): Promise<DatabaseResult>
}

export type TrainingCoachingRelationshipErrorCode =
  | 'relationship_projection_forbidden'
  | 'relationship_projection_unavailable'
  | 'relationship_revocation_forbidden'
  | 'relationship_revision_conflict'
  | 'relationship_request_conflict'
  | 'relationship_revocation_unavailable'

export class TrainingCoachingRelationshipError extends Error {
  constructor(readonly code: TrainingCoachingRelationshipErrorCode) {
    super(code)
    this.name = 'TrainingCoachingRelationshipError'
  }
}

function parseRows(result: DatabaseResult) {
  if (result.error) throw new TrainingCoachingRelationshipError('relationship_projection_unavailable')
  const parsed = z.array(relationshipRowSchema).max(100).safeParse(result.data)
  if (!parsed.success) throw new TrainingCoachingRelationshipError('relationship_projection_unavailable')
  return parsed.data
}

function actorMayRevoke(row: z.infer<typeof relationshipRowSchema>, actor: AllowedActor) {
  if (row.status !== 'active') return false
  if (actor.actorKind === 'athlete') return actor.subjectId === row.subject_id
  return actor.userId === row.practitioner_id && row.permissions.includes('relationship:revoke')
}

function connectionReference(relationshipId: string) {
  return relationshipId.replaceAll('-', '').slice(-8).toUpperCase()
}

function assertActorScope(subjectId: string, rows: readonly z.infer<typeof relationshipRowSchema>[], actor: AllowedActor) {
  if (actor.actorKind === 'athlete' && actor.subjectId !== subjectId) {
    throw new TrainingCoachingRelationshipError('relationship_projection_forbidden')
  }
  if (rows.some(row => row.subject_id !== subjectId
    || (actor.actorKind === 'practitioner' && row.practitioner_id !== actor.userId))) {
    throw new TrainingCoachingRelationshipError('relationship_projection_unavailable')
  }
}

export async function readTrainingCoachingRelationships(
  subjectId: string,
  actor: AllowedActor,
  dependencies: TrainingCoachingRelationshipDependencies,
): Promise<TrainingCoachingRelationshipListV1> {
  const parsedSubjectId = z.string().uuid().safeParse(subjectId)
  if (!parsedSubjectId.success) throw new TrainingCoachingRelationshipError('relationship_projection_forbidden')
  if (actor.actorKind === 'athlete' && actor.subjectId !== parsedSubjectId.data) {
    throw new TrainingCoachingRelationshipError('relationship_projection_forbidden')
  }
  const rows = parseRows(await dependencies.loadRelationships(parsedSubjectId.data))
  assertActorScope(parsedSubjectId.data, rows, actor)
  return TrainingCoachingRelationshipListV1Schema.parse({
    schemaVersion: 'training-coaching-relationship-list.v1',
    subjectId: parsedSubjectId.data,
    viewerRole: actor.actorKind === 'athlete' ? 'athlete' : 'coach',
    relationships: rows.map(row => ({
      relationshipId: row.id,
      subjectId: row.subject_id,
      status: row.status,
      permissions: row.permissions,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      revision: row.revision,
      canRevoke: actorMayRevoke(row, actor),
      counterpartyDisplayLabel: null,
      connectionReference: connectionReference(row.id),
    })),
  })
}

function revocationError(error: DatabaseError): TrainingCoachingRelationshipError {
  if (error.code === 'PT409' && error.message?.includes('request')) {
    return new TrainingCoachingRelationshipError('relationship_request_conflict')
  }
  if (error.code === '40001' || error.code === 'PT409'
    || (error.code === 'P0001' && error.message?.includes('unavailable'))) {
    return new TrainingCoachingRelationshipError('relationship_revision_conflict')
  }
  if (error.code === '42501'
    || (error.code === 'P0001' && error.message?.includes('not authorized'))) {
    return new TrainingCoachingRelationshipError('relationship_revocation_forbidden')
  }
  return new TrainingCoachingRelationshipError('relationship_revocation_unavailable')
}

export async function revokeTrainingCoachingRelationship(
  requestId: string,
  relationshipId: string,
  expectedRevision: number,
  actor: AllowedActor,
  dependencies: TrainingCoachingRelationshipDependencies,
): Promise<TrainingCoachingRelationshipRevocationV1> {
  const parsedRequestId = z.string().uuid().safeParse(requestId)
  const parsedId = z.string().uuid().safeParse(relationshipId)
  const parsedRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(expectedRevision)
  if (!parsedRequestId.success || !parsedId.success || !parsedRevision.success) {
    throw new TrainingCoachingRelationshipError('relationship_revocation_forbidden')
  }
  const result = await dependencies.revokeRelationship(parsedRequestId.data, parsedId.data, parsedRevision.data)
  if (result.error) throw revocationError(result.error)
  const revoked = TrainingCoachingRelationshipRevocationV1Schema.safeParse(result.data)
  if (!revoked.success
    || revoked.data.requestId !== parsedRequestId.data
    || revoked.data.relationshipId !== parsedId.data
    || revoked.data.revision !== parsedRevision.data + 1
    || (actor.actorKind === 'athlete' && revoked.data.subjectId !== actor.subjectId)) {
    throw new TrainingCoachingRelationshipError('relationship_revocation_unavailable')
  }
  return revoked.data
}

export function createSupabaseTrainingCoachingRelationshipDependencies(
  client: TrainingClient,
): TrainingCoachingRelationshipDependencies {
  return {
    async loadRelationships(subjectId) {
      return client.from('coaching_relationships')
        .select('id,subject_id,practitioner_id,status,permissions,started_at,ended_at,revision')
        .eq('subject_id', subjectId)
        .order('started_at', { ascending: false })
        .limit(100)
    },
    async revokeRelationship(requestId, relationshipId, expectedRevision) {
      return client.rpc('revoke_training_coaching_relationship_transactional', {
        p_request_id: requestId,
        p_relationship_id: relationshipId,
        p_expected_revision: expectedRevision,
      })
    },
  }
}

