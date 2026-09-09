import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ManualReferenceRoutineError,
  archiveManualReferenceRoutine,
  createManualReferenceRoutine,
  listManualReferenceRoutines,
  readManualReferenceRoutine,
  updateManualReferenceRoutine,
} from './manual-reference-routine'
import { ManualReferenceRoutineV1Schema } from '@/lib/training/contracts/manual-reference-routine'

const subjectId = '54000000-0000-4000-8000-000000000003'
const routineId = '54000000-0000-4000-8000-000000000004'
const requestId = '54000000-0000-4000-8000-000000000006'
const itemId = '54000000-0000-4000-8000-000000000001'
const item = {
  itemId,
  referenceExerciseId: 'wger:d561c00c-436d-47d9-b647-222e7b637abd',
  kind: 'strength' as const,
  sets: 3,
  reps: 8,
  load: { value: '12.500', unit: 'kg' as const },
}
const routine = ManualReferenceRoutineV1Schema.parse({
  schemaVersion: 'manual-reference-routine.v1' as const,
  routineId,
  subjectId,
  revision: 1,
  status: 'active' as const,
  title: 'Tuesday routine',
  source: {
    kind: 'manual_reference' as const,
    snapshotIds: [
      'wger-english-2026-09-08' as const,
      'wger-1652-media-pilot-2026-09-08' as const,
    ],
    reviewStatus: 'reference_unreviewed' as const,
    screeningInfluence: 'none' as const,
  },
  items: [{ ...item, provenance: {
    snapshotId: 'wger-english-2026-09-08' as const,
    sourceRecordId: 1966,
    sourceRecordUpdatedAt: '2026-06-19T18:48:20.207400+02:00',
    recordSha256: 'a'.repeat(64),
  }, exerciseDisplay: {
    name: 'Squat', instructions: 'Use the saved source instructions.', equipment: ['Dumbbell'], media: null,
    source: { provider: 'wger' as const, recordUrl: 'https://wger.de/api/v2/exerciseinfo/1966/', author: 'Author',
      license: { shortName: 'CC-BY-SA 4' as const, url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
  } }],
  createdBy: { kind: 'athlete' as const, userId: '54000000-0000-4000-8000-000000000005' },
  createdAt: '2026-09-08T12:00:00.000Z',
  updatedAt: '2026-09-08T12:00:00.000Z',
  archivedAt: null,
})
const rpc = vi.fn()
const client = { rpc } as never

beforeEach(() => vi.clearAllMocks())

describe('manual reference routine persistence', () => {
  it('creates from user fields only and accepts server-pinned provenance', async () => {
    rpc.mockResolvedValue({ data: routine, error: null })
    const result = await createManualReferenceRoutine(client, {
      requestId, subjectId, title: 'Tuesday routine', items: [item],
    })
    expect(rpc).toHaveBeenCalledWith('create_training_manual_reference_routine', {
      p_request_id: requestId, p_subject_id: subjectId, p_title: 'Tuesday routine', p_items: [item],
    })
    expect(result.routine).toEqual(routine)
  })

  it('reports changed-payload create retries as request conflicts', async () => {
    rpc.mockResolvedValue({ data: null, error: {
      code: 'PT409', message: 'manual routine request ID reused with different content',
    } })
    await expect(createManualReferenceRoutine(client, {
      requestId, subjectId, title: 'Changed', items: [item],
    })).rejects.toMatchObject({ code: 'manual_routine_request_conflict' })
  })

  it('sends optimistic revisions for update and archive', async () => {
    rpc.mockResolvedValueOnce({ data: { ...routine, revision: 2, title: 'Edited' }, error: null })
      .mockResolvedValueOnce({ data: {
        schemaVersion: 'manual-reference-routine-archive.v1', routineId, revision: 3, status: 'archived',
      }, error: null })
    await updateManualReferenceRoutine(client, routineId, {
      expectedRevision: 1, title: 'Edited', items: [item],
    })
    await archiveManualReferenceRoutine(client, routineId, { expectedRevision: 2 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'update_training_manual_reference_routine', {
      p_routine_id: routineId, p_expected_revision: 1, p_title: 'Edited', p_items: [item],
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'archive_training_manual_reference_routine', {
      p_routine_id: routineId, p_expected_revision: 2,
    })
  })

  it('returns not found distinctly from an unavailable read', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(readManualReferenceRoutine(client, routineId)).resolves.toBeNull()
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    await expect(readManualReferenceRoutine(client, routineId)).rejects.toMatchObject({
      code: 'manual_routine_unavailable',
    })
  })

  it('parses an authorized list projection', async () => {
    rpc.mockResolvedValue({ data: {
      schemaVersion: 'manual-reference-routine-list.v1', subjectId,
      routines: [{ routineId, subjectId, revision: 1, status: 'active', title: 'Tuesday routine', itemCount: 1,
        updatedAt: '2026-09-08T12:00:00.000Z', archivedAt: null }],
      hasMore: true,
      nextCursor: { updatedAt: '2026-09-08T12:00:00.000Z', routineId },
    }, error: null })
    const result = await listManualReferenceRoutines(client, subjectId, { limit: 1 })
    expect(result.routines).toHaveLength(1)
    expect(result).toMatchObject({ hasMore: true })
    expect(result.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(rpc).toHaveBeenCalledWith('list_training_manual_reference_routines_page', {
      p_subject_id: subjectId,
      p_limit: 1,
      p_cursor_updated_at: null,
      p_cursor_routine_id: null,
    })

    rpc.mockResolvedValueOnce({ data: {
      schemaVersion: 'manual-reference-routine-list.v1', subjectId,
      routines: [], hasMore: false, nextCursor: null,
    }, error: null })
    await listManualReferenceRoutines(client, subjectId, { limit: 1, cursor: result.nextCursor })
    expect(rpc).toHaveBeenLastCalledWith('list_training_manual_reference_routines_page', {
      p_subject_id: subjectId,
      p_limit: 1,
      p_cursor_updated_at: '2026-09-08T12:00:00.000Z',
      p_cursor_routine_id: routineId,
    })
  })

  it('rejects a structurally invalid opaque list cursor before persistence', async () => {
    await expect(listManualReferenceRoutines(client, subjectId, {
      limit: 10, cursor: 'e30',
    })).rejects.toMatchObject({ code: 'manual_routine_invalid_cursor' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reloads current state after a stale write', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
      .mockResolvedValueOnce({ data: { ...routine, revision: 2 }, error: null })
    await expect(updateManualReferenceRoutine(client, routineId, {
      expectedRevision: 1, title: 'Edited', items: [item],
    })).rejects.toEqual(new ManualReferenceRoutineError('manual_routine_conflict', { ...routine, revision: 2 }))
  })
})
