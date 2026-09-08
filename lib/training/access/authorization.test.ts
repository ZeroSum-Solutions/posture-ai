import { describe, expect, it } from 'vitest'
import { authorizeTrainingActor } from './authorization'

const OWNER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '10000000-0000-4000-8000-000000000002'
const SUBJECT_ID = '20000000-0000-4000-8000-000000000001'
const CLIENT_ID = '30000000-0000-4000-8000-000000000001'

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
})
