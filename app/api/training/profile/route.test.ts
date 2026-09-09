import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getUser, getAuthenticatorAssuranceLevel, rpc, requireTrainingServerActor } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  rpc: vi.fn(),
  requireTrainingServerActor: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } },
    rpc,
  })),
}))
vi.mock('@/lib/training/access/server-actor', () => ({ requireTrainingServerActor }))

import { GET, PATCH } from './route'

const subjectId = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const profile = {
  schemaVersion: 'athlete-training-profile.v1',
  origin: { kind: 'athlete_input' },
  goal: 'strength',
  experience: 'beginner',
  recentConsistency: 'consistent',
  cycleLengthWeeks: 8,
  strengthDays: ['monday', 'thursday'],
  localTimezone: 'UTC',
  sessionTimeBudgetMinutes: 45,
  preferredLoadUnit: 'kg',
  equipmentInventory: [],
  startingHistory: [],
}
const projection = {
  status: 'ok',
  schemaVersion: 'training-profile-projection.v1',
  subjectId,
  clientId,
  permissions: ['profile:read', 'profile:write'],
  current: { revision: 3, profileHash: 'a'.repeat(64), hashEncoding: 'postgres-jsonb-text-utf8.v1', profile },
}

describe('/api/training/profile', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    })
    rpc.mockReset().mockResolvedValue({ data: projection, error: null })
    requireTrainingServerActor.mockReset().mockResolvedValue({
      ok: true, userId: 'user-1', actorKind: 'athlete', subjectId,
    })
  })

  test('GET accepts exactly one UUID selector and resolves legacy client IDs through the RPC', async () => {
    expect((await GET(new NextRequest('http://localhost/api/training/profile'))).status).toBe(400)
    expect((await GET(new NextRequest(`http://localhost/api/training/profile?subjectId=${subjectId}&clientId=${clientId}`))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost/api/training/profile?clientId=client-record'))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()

    const response = await GET(new NextRequest(`http://localhost/api/training/profile?clientId=${clientId}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(projection)
    expect(rpc).toHaveBeenCalledWith('resolve_training_profile_projection', {
      p_subject_id: null,
      p_client_id: clientId,
    })
  })

  test('GET returns explicit setup state instead of creating or equating a subject', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'setup_required', clientId }, error: null })
    const response = await GET(new NextRequest(`http://localhost/api/training/profile?clientId=${clientId}`))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'athlete_setup_required', clientId })
  })

  test('GET requires an authenticated AAL2 actor independently of proxy', async () => {
    requireTrainingServerActor.mockResolvedValueOnce({ ok: false, status: 401, code: 'unauthorized' })
    expect((await GET(new NextRequest(`http://localhost/api/training/profile?subjectId=${subjectId}`))).status).toBe(401)
    requireTrainingServerActor.mockResolvedValueOnce({ ok: false, status: 403, code: 'mfa_required' })
    expect((await GET(new NextRequest(`http://localhost/api/training/profile?subjectId=${subjectId}`))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  test('PATCH accepts only canonical subjectId and sends no client or actor IDs to the append RPC', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ revision: 4 }], error: null })
      .mockResolvedValueOnce({ data: { ...projection, current: { ...projection.current, revision: 4 } }, error: null })

    const response = await PATCH(new NextRequest(
      `http://localhost/api/training/profile?subjectId=${subjectId}`,
      { method: 'PATCH', body: JSON.stringify({ expectedRevision: 3, profile }) },
    ))

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenNthCalledWith(1, 'append_training_profile_revision', {
      p_subject_id: subjectId,
      p_expected_revision: 3,
      p_profile_json: profile,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'resolve_training_profile_projection', {
      p_subject_id: subjectId,
      p_client_id: null,
    })
  })

  test('PATCH rejects legacy client selector and malformed profile before any write', async () => {
    expect((await PATCH(new NextRequest(
      `http://localhost/api/training/profile?clientId=${clientId}`,
      { method: 'PATCH', body: JSON.stringify({ expectedRevision: 0, profile }) },
    ))).status).toBe(400)
    expect((await PATCH(new NextRequest(
      `http://localhost/api/training/profile?subjectId=${subjectId}`,
      { method: 'PATCH', body: JSON.stringify({ expectedRevision: 0, profile: { ...profile, strengthDays: ['monday'] } }) },
    ))).status).toBe(422)
    expect(rpc).not.toHaveBeenCalled()
  })

  test('PATCH returns the current canonical projection on a revision conflict', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'concurrent' } })
      .mockResolvedValueOnce({ data: projection, error: null })
    const response = await PATCH(new NextRequest(
      `http://localhost/api/training/profile?subjectId=${subjectId}`,
      { method: 'PATCH', body: JSON.stringify({ expectedRevision: 2, profile }) },
    ))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'profile_revision_conflict', current: projection })
  })
})
