import { z } from 'zod'
import { TrainingCoachPermissionSchema } from '@/lib/training/invitations/prepare'

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const stableIdSchema = z.string().trim().min(1).max(128)

export const TrainingCoachingRelationshipV1Schema = z.object({
  relationshipId: z.string().uuid(),
  subjectId: z.string().uuid(),
  status: z.enum(['active', 'revoked']),
  permissions: z.array(TrainingCoachPermissionSchema).min(1).max(10),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  revision: revisionSchema,
  canRevoke: z.boolean(),
  counterpartyDisplayLabel: z.string().trim().min(1).max(120).nullable(),
  connectionReference: z.string().regex(/^[A-F0-9]{8}$/),
}).strict().superRefine((relationship, context) => {
  if ((relationship.status === 'active') !== (relationship.endedAt === null)) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'Relationship lifecycle fields do not match.' })
  }
  if (relationship.status === 'revoked' && relationship.canRevoke) {
    context.addIssue({ code: 'custom', path: ['canRevoke'], message: 'A revoked relationship cannot be revoked again.' })
  }
})

export const TrainingCoachingRelationshipListV1Schema = z.object({
  schemaVersion: z.literal('training-coaching-relationship-list.v1'),
  subjectId: z.string().uuid(),
  viewerRole: z.enum(['athlete', 'coach']),
  relationships: z.array(TrainingCoachingRelationshipV1Schema).max(100),
}).strict().superRefine((projection, context) => {
  const ids = new Set<string>()
  projection.relationships.forEach((relationship, index) => {
    if (relationship.subjectId !== projection.subjectId) {
      context.addIssue({ code: 'custom', path: ['relationships', index, 'subjectId'], message: 'Relationship subject does not match projection.' })
    }
    if (ids.has(relationship.relationshipId)) {
      context.addIssue({ code: 'custom', path: ['relationships', index, 'relationshipId'], message: 'Relationship identifiers must be unique.' })
    }
    ids.add(relationship.relationshipId)
  })
})

export const RevokeTrainingCoachingRelationshipInputV1Schema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: revisionSchema,
}).strict()

export const TrainingCoachingRelationshipRevocationV1Schema = z.object({
  schemaVersion: z.literal('training-coaching-relationship-revocation.v1'),
  requestId: z.string().uuid(),
  relationshipId: z.string().uuid(),
  subjectId: z.string().uuid(),
  status: z.literal('revoked'),
  revision: revisionSchema,
  affectedSessionIds: z.array(stableIdSchema),
}).strict().superRefine((receipt, context) => {
  if (new Set(receipt.affectedSessionIds).size !== receipt.affectedSessionIds.length) {
    context.addIssue({ code: 'custom', path: ['affectedSessionIds'], message: 'Affected session identifiers must be unique.' })
  }
})

export type TrainingCoachingRelationshipV1 = z.infer<typeof TrainingCoachingRelationshipV1Schema>
export type TrainingCoachingRelationshipListV1 = z.infer<typeof TrainingCoachingRelationshipListV1Schema>
export type TrainingCoachingRelationshipRevocationV1 = z.infer<typeof TrainingCoachingRelationshipRevocationV1Schema>
