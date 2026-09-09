import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireTrainingServerActor } from './server-actor'

const getUser = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const maybeSingle = vi.fn()
const rpc = vi.fn(() => ({ maybeSingle }))
const client = { auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } }, rpc }

describe('requireTrainingServerActor', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null,
    })
    maybeSingle.mockReset().mockResolvedValue({
      data: {
        actor_kind: 'athlete', subject_id: '11111111-1111-4111-8111-111111111111', access_status: 'active',
        role: 'athlete', session_is_current: true,
      },
      error: null,
    })
    rpc.mockClear()
  })

  it('returns the current actor using only server-authenticated identity', async () => {
    await expect(requireTrainingServerActor(client as never)).resolves.toEqual({
      ok: true, userId: 'user-1', actorKind: 'athlete', subjectId: '11111111-1111-4111-8111-111111111111',
    })
    expect(rpc).toHaveBeenCalledWith('current_application_actor')
  })

  it.each([
    { actor_kind: 'other', subject_id: null },
    { actor_kind: 'athlete', subject_id: undefined },
    { actor_kind: 'athlete', subject_id: 'not-a-uuid' },
    { actor_kind: 'practitioner', subject_id: '11111111-1111-4111-8111-111111111111', role: 'practitioner' },
  ])('fails closed for malformed actor row %#', async (malformed) => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        access_status: 'active', role: 'athlete', session_is_current: true,
        ...malformed,
      },
      error: null,
    })
    await expect(requireTrainingServerActor(client as never)).resolves.toEqual({
      ok: false, status: 403, code: 'training_actor_required',
    })
  })

  it('returns a practitioner without manufacturing a subject identity', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        actor_kind: 'practitioner', subject_id: null, access_status: 'active',
        role: 'practitioner', session_is_current: true,
      },
      error: null,
    })
    await expect(requireTrainingServerActor(client as never)).resolves.toMatchObject({
      ok: true, actorKind: 'practitioner', subjectId: null,
    })
  })

  it('distinguishes missing auth, AAL1, and unavailable authority', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    await expect(requireTrainingServerActor(client as never)).resolves.toEqual({
      ok: false, status: 401, code: 'unauthorized',
    })

    getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null,
    })
    await expect(requireTrainingServerActor(client as never)).resolves.toEqual({
      ok: false, status: 403, code: 'mfa_required',
    })

    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    await expect(requireTrainingServerActor(client as never)).resolves.toEqual({
      ok: false, status: 503, code: 'actor_unavailable',
    })
  })

  it.each([
    { actor_kind: 'ambiguous', subject_id: null, access_status: 'denied', role: null, session_is_current: false },
    { actor_kind: 'athlete', subject_id: 'subject-1', access_status: 'suspended', role: 'athlete', session_is_current: true },
    { actor_kind: 'athlete', subject_id: 'subject-1', access_status: 'active', role: 'athlete', session_is_current: false },
    { actor_kind: 'athlete', subject_id: null, access_status: 'active', role: 'athlete', session_is_current: true },
  ])('fails closed for invalid actor state %#', async (actor) => {
    maybeSingle.mockResolvedValueOnce({ data: actor, error: null })
    await expect(requireTrainingServerActor(client as never)).resolves.toEqual({
      ok: false, status: 403, code: 'training_actor_required',
    })
  })
})
