import { z } from 'zod'
import { TrainingStableIdV1Schema } from '../contracts/program'
import { getTrainingOfflineBrowserOutbox, type TrainingOfflineBrowserOutbox } from './browser'

const relationshipRevocationCleanupSchema = z.object({
  subjectId: z.string().uuid(),
  relationshipId: TrainingStableIdV1Schema,
  affectedSessionIds: z.array(TrainingStableIdV1Schema),
}).strict().superRefine((receipt, context) => {
  if (new Set(receipt.affectedSessionIds).size !== receipt.affectedSessionIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Affected session IDs must be unique.',
      path: ['affectedSessionIds'],
    })
  }
})

type SessionScopeClearer = Pick<TrainingOfflineBrowserOutbox, 'clearSessionScopes'>

/**
 * Clears browser mutations only for the exact session IDs bound into a validated
 * relationship-revocation receipt. Server history and other local scopes are untouched.
 */
export async function clearOfflineSessionsAfterRelationshipRevocation(
  rawReceipt: unknown,
  outbox: SessionScopeClearer = getTrainingOfflineBrowserOutbox(),
) {
  const receipt = relationshipRevocationCleanupSchema.parse(rawReceipt)
  return outbox.clearSessionScopes(receipt.subjectId, receipt.affectedSessionIds)
}
