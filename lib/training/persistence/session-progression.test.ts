import { describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { readPersistedStrengthSessionEvidence } from './session-progression'

const subjectId = '47000000-0000-4000-8000-000000000003'

function projection(metadata: unknown = {
  schemaVersion: 'strength-session-progression-metadata.v1',
  prescriptionSourceRevisionId: `training-session-prescription.v1:sha256:${'a'.repeat(64)}`,
  progressionSeriesId: 'strength-slot:push',
  startedAt: '2026-09-08T17:00:00.000000Z',
  completedAt: '2026-09-08T17:30:00.000000Z',
  comparator: {
    side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled',
    exposureType: 'standard', loadEpoch: 1,
  },
}) {
  const quantity = createLoadQuantity({ value: '2.5', unit: 'lb' })
  const acceptedInitialLoad = {
    status: 'accepted' as const, acceptanceId: 'accept-1', acceptedAt: '2026-09-08T16:00:00Z',
    acceptedByUserId: 'athlete-1', source: 'equipment_inventory' as const,
    executionContext: { kind: 'live' as const }, exerciseInstanceId: 'press-1',
    exerciseVersionId: 'floor-press.v1', equipmentId: 'db-1', loadBasis: 'dumbbell_per_hand' as const,
    implementCount: 2 as const, holdingConfiguration: 'one_per_hand' as const, quantity,
    provenance: {
      profileRevisionId: '1', compiledProgramRevisionId: 'compiled-1', catalogVersion: 'catalog-1',
      catalogOrigin: { kind: 'authored_catalog' as const },
    },
  }
  return {
    session: { sessionId: 'session-1', revision: 4, state: 'completed', stoppedForSymptoms: false },
    executionContext: { kind: 'live' },
    prescription: {
      schemaVersion: 'training-session-prescription.v1', sessionId: 'session-1', assignmentId: 'assignment-1',
      programRevisionNumber: 1, subjectId, executionContext: { kind: 'live' },
      scheduledLocalDate: '2026-09-08', athleteTimezone: 'UTC', profileRevisionId: '1',
      eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'eight-week-compiler.v2',
      catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' }, ruleVersion: 'progression.v1',
      compiledProgramRevisionId: 'compiled-1', exercises: [{
        exerciseInstanceId: 'press-1', exerciseVersionId: 'floor-press.v1', setIds: ['press-set-1'],
        repRange: { minimum: 6, maximum: 8 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
        progression: {
          progressionSeriesId: 'strength-slot:push', side: 'bilateral', rom: 'catalog_default',
          tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 1,
        },
        acceptedInitialLoad,
      }],
    },
    exerciseInstanceId: 'press-1',
    currentEvents: [{
      schemaVersion: 'training-set-log-event.v1', eventId: '47000000-0000-4000-8000-000000000010',
      eventType: 'set_actual_corrected', eventRevision: 2,
      replacesEventId: '47000000-0000-4000-8000-000000000009', subjectId, sessionId: 'session-1',
      exerciseInstanceId: 'press-1', setId: 'press-set-1', setKind: 'working', workingSetOrdinal: 1,
      executionContext: { kind: 'live' }, equipmentId: 'db-1', loadBasis: 'dumbbell_per_hand',
      quantity, reps: 8, rir: 'unknown', side: 'bilateral', symptomState: 'none',
      actor: { kind: 'athlete', userId: 'athlete-1' }, occurredAt: '2026-09-08T17:20:00Z',
      serverAt: '2026-09-08T17:20:01Z',
    }],
    metadata,
  }
}

describe('readPersistedStrengthSessionEvidence', () => {
  it('reads the exact RLS projection and returns validated corrected evidence', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: projection(), error: null })
    const result = await readPersistedStrengthSessionEvidence({ rpc }, 'session-1', 'press-1')

    expect(rpc).toHaveBeenCalledWith('read_training_strength_evidence_projection', {
      p_session_id: 'session-1', p_exercise_instance_id: 'press-1',
    })
    expect(result).toMatchObject({
      kind: 'ready', progressionSeriesId: 'strength-slot:push',
      exposure: {
        startedAt: '2026-09-08T17:00:00.000000Z',
        completedAt: '2026-09-08T17:30:00.000000Z',
        sets: [{ actualReps: 8, actualRir: 'unknown', load: { quantity: createLoadQuantity({ value: '2.5', unit: 'lb' }) } }],
      },
    })
  })

  it('keeps legacy missing metadata visibly unavailable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: projection(null), error: null })
    await expect(readPersistedStrengthSessionEvidence({ rpc }, 'session-1', 'press-1'))
      .resolves.toMatchObject({ kind: 'unavailable', reason: 'missing_server_metadata' })
  })

  it('rejects a projection whose top-level execution context differs from the prescription', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...projection(), executionContext: {
        kind: 'synthetic_simulation', simulationRunId: '11111111-1111-4111-8111-111111111111',
        fixtureId: 'fixture-1', fixtureHash: 'b'.repeat(64), label: 'Practice data',
      } },
      error: null,
    })
    await expect(readPersistedStrengthSessionEvidence({ rpc }, 'session-1', 'press-1'))
      .resolves.toMatchObject({ kind: 'unavailable', reason: 'invalid_server_projection' })
  })

  it('distinguishes unavailable persistence, invisible rows, and invalid identifiers', async () => {
    const failed = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000' } })
    await expect(readPersistedStrengthSessionEvidence({ rpc: failed }, 'session-1', 'press-1'))
      .resolves.toEqual({ kind: 'unavailable', reason: 'persistence_unavailable', missingFields: [] })

    const hidden = vi.fn().mockResolvedValue({ data: null, error: null })
    await expect(readPersistedStrengthSessionEvidence({ rpc: hidden }, 'session-1', 'press-1'))
      .resolves.toEqual({ kind: 'not_found' })

    const untouched = vi.fn()
    await expect(readPersistedStrengthSessionEvidence({ rpc: untouched }, 'bad id', 'press-1'))
      .resolves.toEqual({ kind: 'unavailable', reason: 'invalid_server_projection', missingFields: [] })
    expect(untouched).not.toHaveBeenCalled()
  })
})
