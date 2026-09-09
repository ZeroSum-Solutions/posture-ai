import { describe, expect, it } from 'vitest'
import {
  TrainingCoachingRelationshipListV1Schema,
  TrainingCoachingRelationshipRevocationV1Schema,
} from './coaching-relationship'

const relationship = {
  relationshipId: '44000000-0000-4000-8000-000000000001',
  subjectId: '42000000-0000-4000-8000-000000000001',
  status: 'active',
  permissions: ['subject:read', 'relationship:revoke'],
  startedAt: '2030-01-01T10:00:00.000Z',
  endedAt: null,
  revision: 1,
  canRevoke: true,
  counterpartyDisplayLabel: null,
  connectionReference: '00000001',
} as const

describe('training coaching relationship contracts', () => {
  it('accepts a subject-bound projection and a scope-bound revocation receipt', () => {
    expect(TrainingCoachingRelationshipListV1Schema.parse({
      schemaVersion: 'training-coaching-relationship-list.v1',
      subjectId: relationship.subjectId,
      viewerRole: 'athlete',
      relationships: [relationship],
    }).relationships).toHaveLength(1)

    expect(TrainingCoachingRelationshipRevocationV1Schema.parse({
      schemaVersion: 'training-coaching-relationship-revocation.v1',
      requestId: '45000000-0000-4000-8000-000000000001',
      relationshipId: relationship.relationshipId,
      subjectId: relationship.subjectId,
      status: 'revoked',
      revision: 2,
      affectedSessionIds: ['session-1', 'session-2'],
    }).revision).toBe(2)
  })

  it('rejects mismatched subjects, duplicate rows and impossible lifecycle state', () => {
    const projection = {
      schemaVersion: 'training-coaching-relationship-list.v1',
      subjectId: relationship.subjectId,
      viewerRole: 'athlete',
      relationships: [relationship, relationship],
    }
    expect(TrainingCoachingRelationshipListV1Schema.safeParse(projection).success).toBe(false)
    expect(TrainingCoachingRelationshipListV1Schema.safeParse({
      ...projection,
      relationships: [{ ...relationship, relationshipId: '44000000-0000-4000-8000-000000000002', subjectId: '42000000-0000-4000-8000-000000000002' }],
    }).success).toBe(false)
    expect(TrainingCoachingRelationshipListV1Schema.safeParse({
      ...projection,
      relationships: [{ ...relationship, status: 'revoked', endedAt: null, canRevoke: true }],
    }).success).toBe(false)
  })

  it('rejects duplicate affected session identifiers', () => {
    expect(TrainingCoachingRelationshipRevocationV1Schema.safeParse({
      schemaVersion: 'training-coaching-relationship-revocation.v1',
      requestId: '45000000-0000-4000-8000-000000000001',
      relationshipId: relationship.relationshipId,
      subjectId: relationship.subjectId,
      status: 'revoked',
      revision: 2,
      affectedSessionIds: ['session-1', 'session-1'],
    }).success).toBe(false)
  })

  it('keeps every individually bounded affected session beyond one program horizon', () => {
    const affectedSessionIds = Array.from({ length: 130 }, (_, index) => `session-${index + 1}`)
    expect(TrainingCoachingRelationshipRevocationV1Schema.parse({
      schemaVersion: 'training-coaching-relationship-revocation.v1',
      requestId: '45000000-0000-4000-8000-000000000001',
      relationshipId: relationship.relationshipId,
      subjectId: relationship.subjectId,
      status: 'revoked',
      revision: 2,
      affectedSessionIds,
    }).affectedSessionIds).toHaveLength(130)
  })
})
