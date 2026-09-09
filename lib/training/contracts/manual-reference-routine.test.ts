import { describe, expect, it } from 'vitest'
import {
  CreateManualReferenceRoutineV1Schema,
  ManualReferenceRoutineListPageV1Schema,
  ManualReferenceRoutineListV1Schema,
  ManualReferenceRoutineV1Schema,
  UpdateManualReferenceRoutineV1Schema,
} from './manual-reference-routine'

const strengthItem = {
  itemId: '54000000-0000-4000-8000-000000000001',
  referenceExerciseId: 'wger:d561c00c-436d-47d9-b647-222e7b637abd',
  kind: 'strength' as const,
  sets: 3,
  reps: 8,
  load: { value: '0012.500', unit: 'kg' as const },
  restSeconds: 90,
}

const conditioningItem = {
  itemId: '54000000-0000-4000-8000-000000000002',
  referenceExerciseId: 'wger:65d12ecf-54b8-466d-a412-e55c396cad69',
  kind: 'conditioning' as const,
  durationSeconds: 600,
}

describe('manual reference routine writes', () => {
  it('preserves ordered stable item IDs and exact entered loads', () => {
    const parsed = CreateManualReferenceRoutineV1Schema.parse({
      requestId: '54000000-0000-4000-8000-000000000006',
      subjectId: '54000000-0000-4000-8000-000000000003',
      title: '  Tuesday routine  ',
      items: [strengthItem, conditioningItem],
    })

    expect(parsed.title).toBe('Tuesday routine')
    expect(parsed.items.map(item => item.itemId)).toEqual([
      strengthItem.itemId,
      conditioningItem.itemId,
    ])
    expect(parsed.items[0]).toMatchObject({ load: { value: '0012.500', unit: 'kg' } })
  })

  it('rejects duplicate item IDs while allowing repeated reference selections', () => {
    expect(CreateManualReferenceRoutineV1Schema.safeParse({
      requestId: '54000000-0000-4000-8000-000000000006',
      subjectId: '54000000-0000-4000-8000-000000000003', title: 'Duplicates',
      items: [strengthItem, { ...conditioningItem, itemId: strengthItem.itemId }],
    }).success).toBe(false)
    expect(CreateManualReferenceRoutineV1Schema.safeParse({
      requestId: '54000000-0000-4000-8000-000000000006',
      subjectId: '54000000-0000-4000-8000-000000000003', title: 'Duplicates',
      items: [strengthItem, { ...conditioningItem, referenceExerciseId: strengthItem.referenceExerciseId }],
    }).success).toBe(true)
  })

  it('enforces exact load precision and the canonical 1000 kg bound', () => {
    for (const value of ['-1', '1.0001', '1000.001']) {
      expect(CreateManualReferenceRoutineV1Schema.safeParse({
        requestId: '54000000-0000-4000-8000-000000000006',
        subjectId: '54000000-0000-4000-8000-000000000003', title: 'Bad load',
        items: [{ ...strengthItem, load: { value, unit: 'kg' } }],
      }).success).toBe(false)
    }
    expect(CreateManualReferenceRoutineV1Schema.safeParse({
      requestId: '54000000-0000-4000-8000-000000000006',
      subjectId: '54000000-0000-4000-8000-000000000003', title: 'Boundary',
      items: [{ ...strengthItem, load: { value: '1000', unit: 'kg' } }],
    }).success).toBe(true)
  })

  it('does not accept client provenance or scan and progression claims', () => {
    for (const extra of [
      { provenance: { snapshotId: 'forged' } },
      { scanInfluence: 'approved' },
      { progressionRule: 'automatic' },
    ]) {
      expect(CreateManualReferenceRoutineV1Schema.safeParse({
        requestId: '54000000-0000-4000-8000-000000000006',
        subjectId: '54000000-0000-4000-8000-000000000003', title: 'Strict',
        items: [{ ...strengthItem, ...extra }],
      }).success).toBe(false)
    }
  })

  it('requires an optimistic revision on edits', () => {
    expect(UpdateManualReferenceRoutineV1Schema.safeParse({
      title: 'Edited', items: [strengthItem],
    }).success).toBe(false)
    expect(UpdateManualReferenceRoutineV1Schema.safeParse({
      expectedRevision: 2, title: 'Edited', items: [strengthItem],
    }).success).toBe(true)
  })
})

describe('manual reference routine projections', () => {
  it('keeps old first-page projections compatible while bounding pagination', () => {
    expect(ManualReferenceRoutineListV1Schema.parse({
      schemaVersion: 'manual-reference-routine-list.v1',
      subjectId: '54000000-0000-4000-8000-000000000003',
      routines: [],
    })).toMatchObject({ hasMore: false, nextCursor: null })
    expect(ManualReferenceRoutineListPageV1Schema.parse({})).toEqual({ limit: 100, cursor: null })
    expect(ManualReferenceRoutineListPageV1Schema.safeParse({ limit: 101 }).success).toBe(false)
    expect(ManualReferenceRoutineListPageV1Schema.safeParse({ cursor: 'not+a+cursor' }).success).toBe(false)
  })

  it('pins unreviewed manual source provenance without clinical claims', () => {
    const routine = ManualReferenceRoutineV1Schema.parse({
      schemaVersion: 'manual-reference-routine.v1',
      routineId: '54000000-0000-4000-8000-000000000004',
      subjectId: '54000000-0000-4000-8000-000000000003',
      revision: 1,
      status: 'active',
      title: 'Tuesday routine',
      source: {
        kind: 'manual_reference',
        snapshotIds: ['wger-english-2026-09-08', 'wger-1652-media-pilot-2026-09-08'],
        reviewStatus: 'reference_unreviewed',
        screeningInfluence: 'none',
      },
      items: [
        { ...strengthItem, provenance: {
          snapshotId: 'wger-english-2026-09-08', sourceRecordId: 1966,
          sourceRecordUpdatedAt: '2026-06-19T18:48:20.207400+02:00',
          recordSha256: 'a'.repeat(64),
        }, exerciseDisplay: {
          name: 'Squat', instructions: 'Use the saved source instructions.', equipment: ['Dumbbell'], media: null,
          source: { provider: 'wger', recordUrl: 'https://wger.de/api/v2/exerciseinfo/1966/', author: 'Author',
            license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
        } },
        { ...conditioningItem, provenance: {
          snapshotId: 'wger-1652-media-pilot-2026-09-08', sourceRecordId: 1652,
          sourceRecordUpdatedAt: '2026-06-19T18:49:43.204115+02:00',
          recordSha256: 'b'.repeat(64),
        }, exerciseDisplay: {
          name: 'RDL', instructions: 'Use the saved source instructions.', equipment: ['Dumbbell'], media: null,
          source: { provider: 'wger', recordUrl: 'https://wger.de/api/v2/exerciseinfo/1652/', author: 'Author',
            license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
        } },
      ],
      createdBy: { kind: 'athlete', userId: '54000000-0000-4000-8000-000000000005' },
      createdAt: '2026-09-08T12:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
      archivedAt: null,
    })

    expect(routine.source).toEqual({
      kind: 'manual_reference',
      snapshotIds: ['wger-english-2026-09-08', 'wger-1652-media-pilot-2026-09-08'],
      reviewStatus: 'reference_unreviewed',
      screeningInfluence: 'none',
    })
    expect(Object.isFrozen(routine)).toBe(true)
    expect(Object.isFrozen(routine.items[0])).toBe(true)
  })
})
