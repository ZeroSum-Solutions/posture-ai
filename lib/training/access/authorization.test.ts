import { describe, expect, it } from 'vitest'
import { authorizeTrainingActor } from './authorization'

const OWNER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '10000000-0000-4000-8000-000000000002'
const SUBJECT_ID = '20000000-0000-4000-8000-000000000001'
const CLIENT_ID = '30000000-0000-4000-8000-000000000001'
const COACH_ID = '40000000-0000-4000-8000-000000000001'
const RELATIONSHIP_ID = '50000000-0000-4000-8000-000000000001'

const activeSubject = {
  id: SUBJECT_ID,
  ownerUserId: OWNER_ID,
  status: 'active' as const,
  revokedAt: null,
  deletedAt: null,
}

const owner = {
  kind: 'user' as const,
  userId: OWNER_ID,
  assuranceLevel: 'aal2' as const,
}

const coach = {
  kind: 'user' as const,
  userId: COACH_ID,
  assuranceLevel: 'aal2' as const,
}

const activePractitioner = {
  id: COACH_ID,
  role: 'practitioner' as const,
  accessStatus: 'active' as const,
  sessionIsCurrent: true,
}

const activeRelationship = {
  id: RELATIONSHIP_ID,
  subjectId: SUBJECT_ID,
  practitionerId: COACH_ID,
  status: 'active' as const,
  permissions: ['profile:read', 'program:coach_publish'] as const,
  startedAt: '2026-09-07T20:00:00Z',
  endedAt: null,
  revision: 1,
}

describe('authorizeTrainingActor', () => {
  it('authorizes an AAL2 owner of a self-directed subject without a client bridge', () => {
    expect(authorizeTrainingActor({
      principal: owner,
      subject: activeSubject,
      clientAccount: null,
      action: 'program:self_publish',
    })).toEqual({
      ok: true,
      actorKind: 'athlete',
      userId: OWNER_ID,
      subjectId: SUBJECT_ID,
      clientId: null,
      practitionerId: null,
      permissions: ['program:self_publish'],
    })
  })

  it('derives the optional legacy client id from an active bridge', () => {
    expect(authorizeTrainingActor({
      principal: owner,
      subject: activeSubject,
      clientAccount: {
        subjectId: SUBJECT_ID,
        clientId: CLIENT_ID,
        status: 'active',
        revokedAt: null,
      },
      action: 'history:read',
    })).toMatchObject({
      ok: true,
      actorKind: 'athlete',
      subjectId: SUBJECT_ID,
      clientId: CLIENT_ID,
      practitionerId: null,
    })
  })

  it.each([
    { label: 'an AAL1 owner', principal: { ...owner, assuranceLevel: 'aal1' as const }, code: 'aal2_required' },
    { label: 'another authenticated athlete', principal: { ...owner, userId: OTHER_USER_ID }, code: 'subject_forbidden' },
    { label: 'a practitioner-shaped unrelated user', principal: { ...owner, userId: OTHER_USER_ID }, code: 'subject_forbidden' },
    { label: 'a workout share token', principal: { kind: 'share_token' as const, tokenId: 'opaque-token-id' }, code: 'authenticated_user_required' },
  ])('denies $label', ({ principal, code }) => {
    expect(authorizeTrainingActor({
      principal,
      subject: activeSubject,
      clientAccount: null,
      action: 'session:read',
    })).toEqual({ ok: false, code })
  })

  it.each([
    { status: 'invited' as const, revokedAt: null, deletedAt: null },
    { status: 'suspended' as const, revokedAt: null, deletedAt: null },
    { status: 'revoked' as const, revokedAt: '2026-09-07T20:00:00Z', deletedAt: null },
    { status: 'revoked' as const, revokedAt: '2026-09-07T20:00:00Z', deletedAt: '2026-09-07T21:00:00Z' },
  ])('denies an unavailable $status subject', (state) => {
    expect(authorizeTrainingActor({
      principal: owner,
      subject: { ...activeSubject, ...state },
      clientAccount: null,
      action: 'profile:read',
    })).toEqual({ ok: false, code: 'subject_unavailable' })
  })

  it.each(['program:coach_publish', 'eligibility:clear'] as const)(
    'does not grant an athlete the %s authority',
    (action) => {
      expect(authorizeTrainingActor({
        principal: owner,
        subject: activeSubject,
        clientAccount: null,
        action,
      })).toEqual({ ok: false, code: 'action_forbidden' })
    },
  )

  it('fails closed when a supplied bridge does not belong to the subject', () => {
    expect(authorizeTrainingActor({
      principal: owner,
      subject: activeSubject,
      clientAccount: {
        subjectId: '20000000-0000-4000-8000-000000000099',
        clientId: CLIENT_ID,
        status: 'active',
        revokedAt: null,
      },
      action: 'history:read',
    })).toEqual({ ok: false, code: 'invalid_client_bridge' })
  })

  it('does not derive a client id from a revoked bridge', () => {
    expect(authorizeTrainingActor({
      principal: owner,
      subject: activeSubject,
      clientAccount: {
        subjectId: SUBJECT_ID,
        clientId: CLIENT_ID,
        status: 'revoked',
        revokedAt: '2026-09-07T20:00:00Z',
      },
      action: 'history:read',
    })).toMatchObject({ ok: true, clientId: null })
  })

  it('authorizes an active AAL2 practitioner only through a scoped active relationship', () => {
    expect(authorizeTrainingActor({
      principal: coach,
      subject: activeSubject,
      clientAccount: null,
      practitioner: activePractitioner,
      coachingRelationship: activeRelationship,
      action: 'profile:read',
    })).toEqual({
      ok: true,
      actorKind: 'coach',
      userId: COACH_ID,
      subjectId: SUBJECT_ID,
      clientId: null,
      practitionerId: COACH_ID,
      relationshipId: RELATIONSHIP_ID,
      relationshipRevision: 1,
      permissions: ['profile:read'],
    })
  })

  it.each([
    {
      label: 'an inactive practitioner',
      practitioner: { ...activePractitioner, accessStatus: 'suspended' as const },
      relationship: activeRelationship,
      code: 'practitioner_unavailable',
    },
    {
      label: 'a stale practitioner session',
      practitioner: { ...activePractitioner, sessionIsCurrent: false },
      relationship: activeRelationship,
      code: 'practitioner_unavailable',
    },
    {
      label: 'a revoked relationship',
      practitioner: activePractitioner,
      relationship: {
        ...activeRelationship,
        status: 'revoked' as const,
        endedAt: '2026-09-07T21:00:00Z',
        revision: 2,
      },
      code: 'relationship_unavailable',
    },
  ])('denies $label', ({ practitioner, relationship, code }) => {
    expect(authorizeTrainingActor({
      principal: coach,
      subject: activeSubject,
      clientAccount: null,
      practitioner,
      coachingRelationship: relationship,
      action: 'profile:read',
    })).toEqual({ ok: false, code })
  })

  it('denies a coach action absent from the relationship permission grant', () => {
    expect(authorizeTrainingActor({
      principal: coach,
      subject: activeSubject,
      clientAccount: null,
      practitioner: activePractitioner,
      coachingRelationship: activeRelationship,
      action: 'set_log:write',
    })).toEqual({ ok: false, code: 'action_forbidden' })
  })

  it.each(['program:self_publish', 'eligibility:clear'] as const)(
    'never grants a coach the %s authority even if a malformed relationship lists it',
    (action) => {
      expect(authorizeTrainingActor({
        principal: coach,
        subject: activeSubject,
        clientAccount: null,
        practitioner: activePractitioner,
        coachingRelationship: {
          ...activeRelationship,
          permissions: [...activeRelationship.permissions, action],
        },
        action,
      })).toEqual({ ok: false, code: 'action_forbidden' })
    },
  )

  it('fails closed when the relationship does not bind the principal and subject', () => {
    expect(authorizeTrainingActor({
      principal: coach,
      subject: activeSubject,
      clientAccount: null,
      practitioner: activePractitioner,
      coachingRelationship: {
        ...activeRelationship,
        subjectId: '20000000-0000-4000-8000-000000000099',
      },
      action: 'profile:read',
    })).toEqual({ ok: false, code: 'invalid_coaching_relationship' })
  })
})
