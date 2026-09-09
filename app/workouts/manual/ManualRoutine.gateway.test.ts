import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createManualRoutine,
  createManualRoutineAttempt,
  loadManualRoutine,
  loadManualRoutines,
  ManualRoutineConflictError,
  ManualRoutineCreateError,
  updateManualRoutine,
} from './ManualRoutine.gateway'
import type { ManualRoutine } from './ManualRoutine.types'

const subjectId = '54000000-0000-4000-8000-000000000003'
const routineId = '54000000-0000-4000-8000-000000000004'
const routine = {
  schemaVersion: 'manual-reference-routine.v1', routineId, subjectId, revision: 1, status: 'active', title: 'Basics',
  source: { kind: 'manual_reference', snapshotIds: ['wger-english-2026-09-08', 'wger-1652-media-pilot-2026-09-08'], reviewStatus: 'reference_unreviewed', screeningInfluence: 'none' },
  items: [{
    itemId: '54000000-0000-4000-8000-000000000001', referenceExerciseId: 'wger:d561c00c-436d-47d9-b647-222e7b637abd',
    kind: 'strength', sets: 3, reps: 8, load: { value: '12.5', unit: 'kg' },
    provenance: { snapshotId: 'wger-english-2026-09-08', sourceRecordId: 1966, sourceRecordUpdatedAt: '2026-06-19T18:48:20.207400+02:00', recordSha256: 'a'.repeat(64) },
    exerciseDisplay: { name: 'Squat', instructions: 'Use the saved source instructions.', equipment: ['Dumbbell'], media: null, source: { provider: 'wger', recordUrl: 'https://wger.de/api/v2/exerciseinfo/1966/', author: 'Author', license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } } },
  }],
  createdBy: { kind: 'athlete', userId: '54000000-0000-4000-8000-000000000005' },
  createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', archivedAt: null,
}

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

beforeEach(() => vi.unstubAllGlobals())

describe('manual routine gateway', () => {
  it('replays the exact frozen create envelope after an ambiguous response', async () => {
    const requestId = '54000000-0000-4000-8000-000000000006'
    const attempt = createManualRoutineAttempt(subjectId, { title: 'Basics', items: [] }, () => requestId)
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockImplementationOnce(() => response({ schemaVersion: 'manual-reference-routine-projection.v1', routine }))
    vi.stubGlobal('fetch', fetch)

    await expect(createManualRoutine(attempt)).rejects.toMatchObject({ uncertain: true })
    await expect(createManualRoutine(attempt)).resolves.toMatchObject({ routineId })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ requestId, subjectId, title: 'Basics', items: [] })
  })

  it('marks a known validation rejection deterministic and validates the requested subject projection', async () => {
    const attempt = createManualRoutineAttempt(subjectId, { title: 'Basics', items: [] }, () => '54000000-0000-4000-8000-000000000006')
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => response({ error: 'invalid_training_payload' }, 422)))
    await expect(createManualRoutine(attempt)).rejects.toEqual(expect.objectContaining<Partial<ManualRoutineCreateError>>({ uncertain: false }))

    const fetch = vi.fn().mockImplementation(() => response({ schemaVersion: 'manual-reference-routine-projection.v1', routine }))
    vi.stubGlobal('fetch', fetch)
    const result = await createManualRoutine(attempt)
    expect(result.routineId).toBe(routineId)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({ subjectId, title: 'Basics', requestId: attempt.requestId })
  })

  it.each([
    ['a request timeout', () => response({ error: 'request_timeout' }, 408)],
    ['a server failure', () => response({ error: 'manual_routine_unavailable' }, 503)],
    ['a malformed success', () => response({ status: 'created' })],
  ])('keeps the frozen attempt after %s', async (_label, nextResponse) => {
    const attempt = createManualRoutineAttempt(subjectId, { title: 'Basics', items: [] })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(nextResponse))

    await expect(createManualRoutine(attempt)).rejects.toMatchObject({ uncertain: true })
  })

  it('rejects a mismatched routine identity and exposes optimistic conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => response({
      schemaVersion: 'manual-reference-routine-projection.v1', routine: { ...routine, routineId: '54000000-0000-4000-8000-000000000005' },
    })))
    await expect(loadManualRoutine(routineId)).rejects.toThrow('invalid')

    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => response({ error: 'manual_routine_conflict', current: { ...routine, revision: 2 } }, 409)))
    await expect(updateManualRoutine(routine as unknown as ManualRoutine, { title: 'Changed', items: [] })).rejects.toBeInstanceOf(ManualRoutineConflictError)
  })

  it('requests a bounded page, preserves the opaque cursor, and validates the subject', async () => {
    const fetch = vi.fn().mockImplementation(() => response({
      schemaVersion: 'manual-reference-routine-list.v1',
      subjectId,
      routines: [{ routineId, subjectId, revision: 1, status: 'active', title: 'Basics', itemCount: 1, updatedAt: '2026-09-08T00:00:00Z', archivedAt: null }],
      hasMore: true,
      nextCursor: 'b3BhcXVlLW5leHQ',
    }))
    vi.stubGlobal('fetch', fetch)

    const page = await loadManualRoutines(subjectId, 'b3BhcXVlLWN1cnJlbnQ')

    const url = new URL(fetch.mock.calls[0][0], 'https://posture.test')
    expect(url.pathname).toBe('/api/training/manual-routines')
    expect(Object.fromEntries(url.searchParams)).toEqual({ subjectId, limit: '20', cursor: 'b3BhcXVlLWN1cnJlbnQ' })
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'b3BhcXVlLW5leHQ' })

    fetch.mockImplementationOnce(() => response({
      schemaVersion: 'manual-reference-routine-list.v1',
      subjectId: '54000000-0000-4000-8000-000000000007',
      routines: [],
      hasMore: false,
      nextCursor: null,
    }))
    await expect(loadManualRoutines(subjectId)).rejects.toThrow('invalid')
  })
})
