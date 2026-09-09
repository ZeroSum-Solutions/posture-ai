import { z } from 'zod'
import { Buffer } from 'node:buffer'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  ArchiveManualReferenceRoutineV1Schema,
  CreateManualReferenceRoutineV1Schema,
  MANUAL_REFERENCE_ROUTINE_ARCHIVE_SCHEMA_VERSION,
  MANUAL_REFERENCE_ROUTINE_PROJECTION_SCHEMA_VERSION,
  ManualReferenceRoutineArchiveV1Schema,
  ManualReferenceRoutineListV1Schema,
  ManualReferenceRoutineListPageV1Schema,
  ManualReferenceRoutineProjectionV1Schema,
  ManualReferenceRoutineV1Schema,
  UpdateManualReferenceRoutineV1Schema,
  type CreateManualReferenceRoutineV1,
  type ManualReferenceRoutineV1,
  type ManualReferenceRoutineListPageV1,
  type UpdateManualReferenceRoutineV1,
} from '@/lib/training/contracts/manual-reference-routine'

type TrainingClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type ManualReferenceRoutineErrorCode =
  | 'manual_routine_conflict'
  | 'manual_routine_request_conflict'
  | 'manual_routine_forbidden'
  | 'manual_routine_invalid_reference'
  | 'manual_routine_invalid_cursor'
  | 'manual_routine_unavailable'

export class ManualReferenceRoutineError extends Error {
  constructor(
    readonly code: ManualReferenceRoutineErrorCode,
    readonly current?: ManualReferenceRoutineV1,
  ) {
    super(code)
    this.name = 'ManualReferenceRoutineError'
  }
}

function errorCode(error: { code?: string; message?: string } | null): ManualReferenceRoutineErrorCode {
  if (error?.code === 'PT409') return error.message?.includes('request ID')
    ? 'manual_routine_request_conflict'
    : 'manual_routine_conflict'
  if (error?.code === '42501' || error?.code === 'P0001') return 'manual_routine_forbidden'
  if (error?.code === '22023' || error?.code === '23514' || error?.message?.includes('reference exercise')) {
    return 'manual_routine_invalid_reference'
  }
  return 'manual_routine_unavailable'
}

function projection(routine: unknown) {
  return ManualReferenceRoutineProjectionV1Schema.parse({
    schemaVersion: MANUAL_REFERENCE_ROUTINE_PROJECTION_SCHEMA_VERSION,
    routine,
  })
}

const listCursorPayloadSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  routineId: z.string().uuid(),
}).strict()

const rawListPageSchema = z.object({
  schemaVersion: z.literal('manual-reference-routine-list.v1'),
  subjectId: z.string().uuid(),
  routines: z.array(z.unknown()).max(100),
  hasMore: z.boolean(),
  nextCursor: listCursorPayloadSchema.nullable(),
}).strict()

function decodeListCursor(cursor: string | null) {
  if (cursor === null) return null
  try {
    return listCursorPayloadSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch {
    throw new ManualReferenceRoutineError('manual_routine_invalid_cursor')
  }
}

function encodeListCursor(cursor: z.infer<typeof listCursorPayloadSchema> | null) {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export async function createManualReferenceRoutine(
  client: TrainingClient,
  rawInput: CreateManualReferenceRoutineV1,
) {
  const input = CreateManualReferenceRoutineV1Schema.parse(rawInput)
  const { data, error } = await client.rpc('create_training_manual_reference_routine', {
    p_request_id: input.requestId,
    p_subject_id: input.subjectId,
    p_title: input.title,
    p_items: input.items,
  })
  if (error) throw new ManualReferenceRoutineError(errorCode(error))
  try {
    return projection(data)
  } catch {
    throw new ManualReferenceRoutineError('manual_routine_unavailable')
  }
}

export async function readManualReferenceRoutine(client: TrainingClient, routineId: string) {
  const parsedId = z.string().uuid().parse(routineId)
  const { data, error } = await client.rpc('read_training_manual_reference_routine', {
    p_routine_id: parsedId,
  })
  if (error) throw new ManualReferenceRoutineError(errorCode(error))
  if (data === null) return null
  try {
    return projection(data)
  } catch {
    throw new ManualReferenceRoutineError('manual_routine_unavailable')
  }
}

/**
 * Pages a stable dataset without duplicates, including equal updatedAt ties.
 * Concurrent edits may move a routine ahead of an already-consumed cursor, so
 * callers should refresh from page one after a write; this is not a snapshot.
 */
export async function listManualReferenceRoutines(
  client: TrainingClient,
  subjectId: string,
  rawPage: Partial<ManualReferenceRoutineListPageV1> = {},
) {
  const parsedId = z.string().uuid().parse(subjectId)
  const page = ManualReferenceRoutineListPageV1Schema.parse(rawPage)
  const cursor = decodeListCursor(page.cursor)
  const { data, error } = await client.rpc('list_training_manual_reference_routines_page', {
    p_subject_id: parsedId,
    p_limit: page.limit,
    p_cursor_updated_at: cursor?.updatedAt ?? null,
    p_cursor_routine_id: cursor?.routineId ?? null,
  })
  if (error) throw new ManualReferenceRoutineError(errorCode(error))
  try {
    const raw = rawListPageSchema.parse(data)
    return ManualReferenceRoutineListV1Schema.parse({
      ...raw,
      nextCursor: encodeListCursor(raw.nextCursor),
    })
  } catch {
    throw new ManualReferenceRoutineError('manual_routine_unavailable')
  }
}

export async function updateManualReferenceRoutine(
  client: TrainingClient,
  routineId: string,
  rawInput: UpdateManualReferenceRoutineV1,
) {
  const parsedId = z.string().uuid().parse(routineId)
  const input = UpdateManualReferenceRoutineV1Schema.parse(rawInput)
  const { data, error } = await client.rpc('update_training_manual_reference_routine', {
    p_routine_id: parsedId,
    p_expected_revision: input.expectedRevision,
    p_title: input.title,
    p_items: input.items,
  })
  if (error) {
    if (errorCode(error) === 'manual_routine_conflict') {
      const current = await readManualReferenceRoutine(client, parsedId)
      throw new ManualReferenceRoutineError('manual_routine_conflict', current?.routine)
    }
    throw new ManualReferenceRoutineError(errorCode(error))
  }
  try {
    return projection(data)
  } catch {
    throw new ManualReferenceRoutineError('manual_routine_unavailable')
  }
}

export async function archiveManualReferenceRoutine(
  client: TrainingClient,
  routineId: string,
  rawInput: z.infer<typeof ArchiveManualReferenceRoutineV1Schema>,
) {
  const parsedId = z.string().uuid().parse(routineId)
  const input = ArchiveManualReferenceRoutineV1Schema.parse(rawInput)
  const { data, error } = await client.rpc('archive_training_manual_reference_routine', {
    p_routine_id: parsedId,
    p_expected_revision: input.expectedRevision,
  })
  if (error) {
    if (errorCode(error) === 'manual_routine_conflict') {
      const current = await readManualReferenceRoutine(client, parsedId)
      throw new ManualReferenceRoutineError('manual_routine_conflict', current?.routine)
    }
    throw new ManualReferenceRoutineError(errorCode(error))
  }
  try {
    return ManualReferenceRoutineArchiveV1Schema.parse({
      schemaVersion: MANUAL_REFERENCE_ROUTINE_ARCHIVE_SCHEMA_VERSION,
      ...data,
    })
  } catch {
    throw new ManualReferenceRoutineError('manual_routine_unavailable')
  }
}

export function parseManualRoutineDocument(value: unknown) {
  return ManualReferenceRoutineV1Schema.parse(value)
}
