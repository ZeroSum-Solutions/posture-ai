import { z } from 'zod'
import { createLoadQuantity, isEnteredLoadAtMostCanonicalKg } from '@/lib/training/quantity'

export const MANUAL_REFERENCE_ROUTINE_SCHEMA_VERSION = 'manual-reference-routine.v1' as const
export const MANUAL_REFERENCE_ROUTINE_PROJECTION_SCHEMA_VERSION = 'manual-reference-routine-projection.v1' as const
export const MANUAL_REFERENCE_ROUTINE_LIST_SCHEMA_VERSION = 'manual-reference-routine-list.v1' as const
export const MANUAL_REFERENCE_ROUTINE_ARCHIVE_SCHEMA_VERSION = 'manual-reference-routine-archive.v1' as const
export const MANUAL_REFERENCE_ROUTINE_LIST_PAGE_MAX = 100 as const
export const MANUAL_REFERENCE_LIBRARY_SNAPSHOT_IDS = [
  'wger-english-2026-09-08',
  'wger-1652-media-pilot-2026-09-08',
] as const

const uuidSchema = z.string().uuid()
const referenceIdSchema = z.string().regex(/^wger:[0-9a-f-]{36}$/)
const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const titleSchema = z.string().trim().min(1).max(120)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Routine titles must be plain text')
const restSecondsSchema = z.number().int().min(0).max(3_600).optional()

const enteredLoadSchema = z.object({
  value: z.string(),
  unit: z.enum(['kg', 'lb']),
}).strict().superRefine((load, ctx) => {
  try {
    createLoadQuantity(load)
    if (!isEnteredLoadAtMostCanonicalKg(load, '1000')) {
      ctx.addIssue({ code: 'custom', message: 'Load exceeds 1000 kg', path: ['value'] })
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Load must be an exact nonnegative decimal', path: ['value'] })
  }
})

const itemIdentitySchema = z.object({
  itemId: uuidSchema,
  referenceExerciseId: referenceIdSchema,
})

export const ManualReferenceRoutineWriteItemV1Schema = z.discriminatedUnion('kind', [
  itemIdentitySchema.extend({
    kind: z.literal('strength'),
    sets: z.number().int().min(1).max(20),
    reps: z.number().int().min(1).max(100),
    load: enteredLoadSchema,
    restSeconds: restSecondsSchema,
  }).strict(),
  itemIdentitySchema.extend({
    kind: z.literal('conditioning'),
    durationSeconds: z.number().int().min(1).max(86_400),
    restSeconds: restSecondsSchema,
  }).strict(),
])

const writeItemsSchema = z.array(ManualReferenceRoutineWriteItemV1Schema).min(1).max(280)
  .superRefine((items, ctx) => {
    const itemIds = new Set<string>()
    items.forEach((item, index) => {
      if (itemIds.has(item.itemId)) {
        ctx.addIssue({ code: 'custom', message: 'Routine item IDs must be unique', path: [index, 'itemId'] })
      }
      itemIds.add(item.itemId)
    })
  })

export const CreateManualReferenceRoutineV1Schema = z.object({
  requestId: uuidSchema,
  subjectId: uuidSchema,
  title: titleSchema,
  items: writeItemsSchema,
}).strict()

export const UpdateManualReferenceRoutineV1Schema = z.object({
  expectedRevision: revisionSchema,
  title: titleSchema,
  items: writeItemsSchema,
}).strict()

export const ArchiveManualReferenceRoutineV1Schema = z.object({
  expectedRevision: revisionSchema,
}).strict()

const snapshotIdSchema = z.enum(MANUAL_REFERENCE_LIBRARY_SNAPSHOT_IDS)
const composedSnapshotIdsSchema = z.tuple([
  z.literal(MANUAL_REFERENCE_LIBRARY_SNAPSHOT_IDS[0]),
  z.literal(MANUAL_REFERENCE_LIBRARY_SNAPSHOT_IDS[1]),
])
const provenanceSchema = z.object({
  snapshotId: snapshotIdSchema,
  sourceRecordId: z.number().int().positive(),
  sourceRecordUpdatedAt: z.string().datetime({ offset: true }),
  recordSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

const exerciseDisplaySchema = z.object({
  name: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(4_000),
  equipment: z.array(z.string().trim().min(1).max(160)).max(20),
  media: z.object({
    kind: z.literal('image'),
    posterUrl: z.string().startsWith('/training/reference/'),
    alt: z.string().trim().min(1).max(160),
    width: z.number().int().positive().max(4_096),
    height: z.number().int().positive().max(4_096),
    mimeType: z.literal('image/webp'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.object({
      provider: z.literal('wger'),
      exerciseRecordId: z.number().int().positive(),
      assetId: z.number().int().positive(),
      assetUuid: uuidSchema,
      assetUrl: z.string().url(),
      author: z.string().trim().min(1).max(160),
      authorHistory: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
      license: z.object({ shortName: z.enum(['CC-BY-SA 3', 'CC-BY-SA 4']), url: z.string().url() }).strict(),
      isAiGenerated: z.literal(false),
      modifications: z.literal('none'),
    }).strict(),
  }).strict().nullable(),
  source: z.object({
    provider: z.literal('wger'),
    recordUrl: z.string().url(),
    author: z.string().trim().min(1).max(160),
    license: z.object({ shortName: z.enum(['CC-BY-SA 3', 'CC-BY-SA 4']), url: z.string().url() }).strict(),
  }).strict(),
}).strict()

export const ManualReferenceRoutineItemV1Schema = z.discriminatedUnion('kind', [
  itemIdentitySchema.extend({
    kind: z.literal('strength'),
    sets: z.number().int().min(1).max(20),
    reps: z.number().int().min(1).max(100),
    load: enteredLoadSchema,
    restSeconds: restSecondsSchema,
    provenance: provenanceSchema,
    exerciseDisplay: exerciseDisplaySchema,
  }).strict(),
  itemIdentitySchema.extend({
    kind: z.literal('conditioning'),
    durationSeconds: z.number().int().min(1).max(86_400),
    restSeconds: restSecondsSchema,
    provenance: provenanceSchema,
    exerciseDisplay: exerciseDisplaySchema,
  }).strict(),
])

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

export const ManualReferenceRoutineV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_REFERENCE_ROUTINE_SCHEMA_VERSION),
  routineId: uuidSchema,
  subjectId: uuidSchema,
  revision: revisionSchema,
  status: z.enum(['active', 'archived']),
  title: titleSchema,
  source: z.object({
    kind: z.literal('manual_reference'),
    snapshotIds: composedSnapshotIdsSchema,
    reviewStatus: z.literal('reference_unreviewed'),
    screeningInfluence: z.literal('none'),
  }).strict(),
  items: z.array(ManualReferenceRoutineItemV1Schema).min(1).max(280),
  createdBy: z.object({ kind: z.enum(['athlete', 'coach']), userId: uuidSchema }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((routine, ctx) => {
  if ((routine.status === 'archived') !== (routine.archivedAt !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Archive state and timestamp must match', path: ['archivedAt'] })
  }
  const parsedItems = writeItemsSchema.safeParse(routine.items.map(item => item.kind === 'strength'
    ? {
        itemId: item.itemId, referenceExerciseId: item.referenceExerciseId,
        kind: item.kind, sets: item.sets, reps: item.reps, load: item.load,
        ...(item.restSeconds === undefined ? {} : { restSeconds: item.restSeconds }),
      }
    : {
        itemId: item.itemId, referenceExerciseId: item.referenceExerciseId,
        kind: item.kind, durationSeconds: item.durationSeconds,
        ...(item.restSeconds === undefined ? {} : { restSeconds: item.restSeconds }),
      }))
  if (!parsedItems.success) {
    ctx.addIssue({ code: 'custom', message: 'Stored routine items must remain unique', path: ['items'] })
  }
}).transform(deepFreeze)

export const ManualReferenceRoutineProjectionV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_REFERENCE_ROUTINE_PROJECTION_SCHEMA_VERSION),
  routine: ManualReferenceRoutineV1Schema,
}).strict()

export const ManualReferenceRoutineSummaryV1Schema = z.object({
  routineId: uuidSchema,
  subjectId: uuidSchema,
  revision: revisionSchema,
  status: z.enum(['active', 'archived']),
  title: titleSchema,
  itemCount: z.number().int().min(1).max(280),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
}).strict()

export const ManualReferenceRoutineListPageV1Schema = z.object({
  limit: z.number().int().min(1).max(MANUAL_REFERENCE_ROUTINE_LIST_PAGE_MAX).default(MANUAL_REFERENCE_ROUTINE_LIST_PAGE_MAX),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
}).strict()

export const ManualReferenceRoutineListV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_REFERENCE_ROUTINE_LIST_SCHEMA_VERSION),
  subjectId: uuidSchema,
  routines: z.array(ManualReferenceRoutineSummaryV1Schema).max(MANUAL_REFERENCE_ROUTINE_LIST_PAGE_MAX),
  hasMore: z.boolean().default(false),
  nextCursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
}).strict()

export const ManualReferenceRoutineArchiveV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_REFERENCE_ROUTINE_ARCHIVE_SCHEMA_VERSION),
  routineId: uuidSchema,
  revision: revisionSchema,
  status: z.literal('archived'),
}).strict()

export type CreateManualReferenceRoutineV1 = z.infer<typeof CreateManualReferenceRoutineV1Schema>
export type UpdateManualReferenceRoutineV1 = z.infer<typeof UpdateManualReferenceRoutineV1Schema>
export type ArchiveManualReferenceRoutineV1 = z.infer<typeof ArchiveManualReferenceRoutineV1Schema>
export type ManualReferenceRoutineWriteItemV1 = z.infer<typeof ManualReferenceRoutineWriteItemV1Schema>
export type ManualReferenceRoutineItemV1 = z.infer<typeof ManualReferenceRoutineItemV1Schema>
export type ManualReferenceRoutineV1 = z.infer<typeof ManualReferenceRoutineV1Schema>
export type ManualReferenceRoutineProjectionV1 = z.infer<typeof ManualReferenceRoutineProjectionV1Schema>
export type ManualReferenceRoutineListV1 = z.infer<typeof ManualReferenceRoutineListV1Schema>
export type ManualReferenceRoutineSummaryV1 = z.infer<typeof ManualReferenceRoutineSummaryV1Schema>
export type ManualReferenceRoutineListPageV1 = z.infer<typeof ManualReferenceRoutineListPageV1Schema>
