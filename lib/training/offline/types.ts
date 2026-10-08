import { z } from 'zod'
import { TrainingConditioningActualInputV1Schema } from '@/lib/training/contracts/logs'
import { ExactLoadQuantityV1Schema, TrainingStableIdV1Schema } from '@/lib/training/contracts/program'

const uuidSchema = z.string().uuid()
const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const TrainingOfflineSetActualV1Schema = z.object({
  quantity: ExactLoadQuantityV1Schema,
  reps: z.number().int().min(0).max(100),
  rir: z.union([z.number().int().min(0).max(5), z.literal('6_plus'), z.literal('unknown')]),
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  symptomState: z.enum(['none', 'adverse_reported']),
  occurredAt: z.string().datetime({ offset: true }),
}).strict()

export const TrainingOfflineMutationV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set_actual'),
    setId: TrainingStableIdV1Schema,
    expectedRevision: revisionSchema,
    actual: TrainingOfflineSetActualV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('conditioning_actual'),
    expectedRevision: revisionSchema,
    actual: TrainingConditioningActualInputV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('session_completion'),
    expectedRevision: revisionSchema,
    finishMode: z.enum(['complete', 'finish_with_omissions', 'abort']),
  }).strict(),
])

export const TrainingOfflineEnvelopeInputV1Schema = z.object({
  userId: uuidSchema,
  subjectId: uuidSchema,
  sessionId: TrainingStableIdV1Schema,
  requestId: uuidSchema,
  mutation: TrainingOfflineMutationV1Schema,
}).strict()

export const TrainingOfflineEnvelopeV1Schema = TrainingOfflineEnvelopeInputV1Schema.extend({
  schemaVersion: z.literal('training-offline-envelope.v1'),
  queuedAt: z.string().datetime({ offset: true }),
}).strict()

export const TrainingOfflineStoredEntrySchema = z.object({
  sequence: z.number().int().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['pending', 'conflict']),
  envelope: TrainingOfflineEnvelopeV1Schema,
}).strict()

export type TrainingOfflineEnvelopeInputV1 = z.infer<typeof TrainingOfflineEnvelopeInputV1Schema>
export type TrainingOfflineEnvelopeV1 = z.infer<typeof TrainingOfflineEnvelopeV1Schema>
export type TrainingOfflineStoredEntry = z.infer<typeof TrainingOfflineStoredEntrySchema>
export type TrainingOfflineStoredEntryInput = Omit<TrainingOfflineStoredEntry, 'sequence'>

export type TrainingOfflineEnqueueResult =
  | { readonly kind: 'inserted'; readonly entry: TrainingOfflineStoredEntry }
  | { readonly kind: 'existing'; readonly entry: TrainingOfflineStoredEntry }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'inactive' }

export type TrainingOfflineClearScope = {
  readonly userId: string
  readonly subjectId?: string
  readonly sessionId?: string
}

export interface TrainingOfflineStorage {
  readActiveUser(): Promise<string | null>
  switchActiveUser(userId: string | null): Promise<{ previousUserId: string | null; clearedCount: number }>
  enqueue(entry: TrainingOfflineStoredEntryInput): Promise<TrainingOfflineEnqueueResult>
  list(userId: string): Promise<TrainingOfflineStoredEntry[]>
  markConflict(userId: string, requestId: string): Promise<boolean>
  remove(userId: string, requestId: string): Promise<boolean>
  clear(scope: TrainingOfflineClearScope): Promise<number>
  acquireDrainLease(userId: string, ownerId: string, now: number, expiresAt: number): Promise<boolean>
  releaseDrainLease(userId: string, ownerId: string): Promise<void>
  /** When another owner holds the drain lease, its expiry (epoch ms); otherwise null. */
  readDrainLeaseExpiry?(userId: string, ownerId: string): Promise<number | null>
}
