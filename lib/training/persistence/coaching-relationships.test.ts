import { describe, expect, it, vi } from 'vitest'
import {
  TrainingCoachingRelationshipError,
  readTrainingCoachingRelationships,
  revokeTrainingCoachingRelationship,
  type TrainingCoachingRelationshipDependencies,
} from './coaching-relationships'

const subjectId = '42000000-0000-4000-8000-000000000001'
const athleteId = '41000000-0000-4000-8000-000000000001'
const coachId = '41000000-0000-4000-8000-000000000002'
const relationshipId = '44000000-0000-4000-8000-000000000001'
const requestId = '45000000-0000-4000-8000-000000000001'
const row = {
  id: relationshipId,
  subject_id: subjectId,
  practitioner_id: coachId,
  status: 'active',
  permissions: ['subject:read', 'relationship:revoke'],
  started_at: '2030-01-01T10:00:00.000Z',
  ended_at: null,
  revision: 3,
}
const athlete = { ok: true, actorKind: 'athlete', userId: athleteId, subjectId } as const
const coach = { ok: true, actorKind: 'practitioner', userId: coachId, subjectId: null } as const
const receipt = {
  schemaVersion: 'training-coaching-relationship-revocation.v1', requestId,
  relationshipId, subjectId, status: 'revoked', revision: 4,
  affectedSessionIds: ['session-1', 'session-2'],
}

function dependencies(overrides: Partial<TrainingCoachingRelationshipDependencies> = {}): TrainingCoachingRelationshipDependencies {
  return {
    loadRelationships: vi.fn(async () => ({ data: [row], error: null })),
    revokeRelationship: vi.fn(async () => ({ data: receipt, error: null })),
    ...overrides,
  }
}

describe('training coaching relationship persistence', () => {
  it('builds an athlete projection without stale cleanup scope', async () => {
    const projection = await readTrainingCoachingRelationships(subjectId, athlete, dependencies())
    expect(projection).toEqual({
      schemaVersion: 'training-coaching-relationship-list.v1', subjectId, viewerRole: 'athlete',
      relationships: [{
        relationshipId, subjectId, status: 'active', permissions: row.permissions,
        startedAt: row.started_at, endedAt: null, revision: 3, canRevoke: true,
        counterpartyDisplayLabel: null, connectionReference: '00000001',
      }],
    })
  })

  it('lets only the exact permissioned coach project a revocation action', async () => {
    expect((await readTrainingCoachingRelationships(subjectId, coach, dependencies())).relationships[0].canRevoke).toBe(true)
    const readOnly = dependencies({
      loadRelationships: vi.fn(async () => ({ data: [{ ...row, permissions: ['subject:read'] }], error: null })),
    })
    expect((await readTrainingCoachingRelationships(subjectId, coach, readOnly)).relationships[0].canRevoke).toBe(false)
    await expect(readTrainingCoachingRelationships(subjectId, {
      ...coach, userId: '41000000-0000-4000-8000-000000000003',
    }, dependencies())).rejects.toMatchObject({ code: 'relationship_projection_unavailable' })
  })

  it('returns the transaction-bound cleanup scope and supports exact receipt replay', async () => {
    const deps = dependencies()
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, coach, deps)).resolves.toEqual(receipt)
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, coach, deps)).resolves.toEqual(receipt)
    expect(deps.revokeRelationship).toHaveBeenNthCalledWith(1, requestId, relationshipId, 3)
    expect(deps.revokeRelationship).toHaveBeenNthCalledWith(2, requestId, relationshipId, 3)
  })

  it('rejects an unbound receipt without returning cleanup scope', async () => {
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, athlete, dependencies({
      revokeRelationship: vi.fn(async () => ({ data: { ...receipt, requestId: '45000000-0000-4000-8000-000000000002' }, error: null })),
    }))).rejects.toMatchObject({ code: 'relationship_revocation_unavailable' })
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, athlete, dependencies({
      revokeRelationship: vi.fn(async () => ({ data: { ...receipt, subjectId: '42000000-0000-4000-8000-000000000002' }, error: null })),
    }))).rejects.toMatchObject({ code: 'relationship_revocation_unavailable' })
  })

  it('distinguishes request conflicts, revision conflicts and denials', async () => {
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, coach, dependencies({
      revokeRelationship: vi.fn(async () => ({ data: null, error: { code: 'PT409', message: 'training relationship revocation request conflict' } })),
    }))).rejects.toMatchObject({ code: 'relationship_request_conflict' })
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, coach, dependencies({
      revokeRelationship: vi.fn(async () => ({ data: null, error: { code: 'PT409', message: 'coaching relationship changed concurrently' } })),
    }))).rejects.toMatchObject({ code: 'relationship_revision_conflict' })
    await expect(revokeTrainingCoachingRelationship(requestId, relationshipId, 3, coach, dependencies({
      revokeRelationship: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    }))).rejects.toBeInstanceOf(TrainingCoachingRelationshipError)
  })
})
