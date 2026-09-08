import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  sessionRpc: vi.fn(),
  serviceRpc: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.sessionRpc })),
  createSupabaseServiceClient: vi.fn(() => ({
    rpc: mocks.serviceRpc,
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
  })),
}))
vi.mock('@/lib/training/access/server-actor', () => ({
  requireTrainingServerActor: mocks.actor,
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: mocks.rateLimit }))

import { POST } from './route'
import {
  PRACTICE_SIMULATION_CATALOG_ORIGIN,
  PRACTICE_SIMULATION_FIXTURE,
} from '@/lib/training/simulation/fixture'

const reservation = {
  status: 'reserved',
  reservationId: '11000000-0000-4000-8000-000000000001',
  invitationId: '12000000-0000-4000-8000-000000000001',
  clientId: '13000000-0000-4000-8000-000000000001',
  subjectId: null,
  provisionedUserId: null,
  simulationRunId: '14000000-0000-4000-8000-000000000001',
  internalEmail: 'simulation+abc@fixtures.invalid',
  fixtureId: PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
  fixtureHash: PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
  label: PRACTICE_SIMULATION_FIXTURE.label,
  expiresAt: '2026-09-08T12:00:00.000Z',
  profileRevision: null,
}
const active = {
  status: 'active',
  subjectId: '15000000-0000-4000-8000-000000000001',
  clientId: reservation.clientId,
  profileRevision: 1,
  simulationRunId: reservation.simulationRunId,
  fixtureId: reservation.fixtureId,
  fixtureHash: reservation.fixtureHash,
  label: reservation.label,
  expiresAt: reservation.expiresAt,
}

describe('POST /api/training/simulation/setup', () => {
  beforeEach(() => {
    mocks.actor.mockReset().mockResolvedValue({
      ok: true, userId: 'coach-user', actorKind: 'practitioner', subjectId: null,
    })
    mocks.rateLimit.mockReset().mockResolvedValue(true)
    mocks.sessionRpc.mockReset().mockResolvedValue({ data: reservation, error: null })
    mocks.serviceRpc.mockReset().mockResolvedValue({ data: active, error: null })
    mocks.createUser.mockReset().mockResolvedValue({
      data: { user: { id: '16000000-0000-4000-8000-000000000001' } }, error: null,
    })
    mocks.deleteUser.mockReset().mockResolvedValue({ error: null })
  })

  test('provisions a distinct no-email fixture identity without exposing server build context', async () => {
    const response = await POST()
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      subjectId: active.subjectId,
      profileRevision: 1,
    })
    expect(mocks.sessionRpc).toHaveBeenCalledWith('reserve_training_simulation_identity')
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: reservation.internalEmail,
      email_confirm: true,
    }))
    expect(mocks.createUser.mock.calls[0][0]).not.toHaveProperty('password')
    expect(mocks.serviceRpc).toHaveBeenCalledWith('activate_training_simulation_identity', {
      p_reservation_id: reservation.reservationId,
      p_provisioned_user_id: '16000000-0000-4000-8000-000000000001',
      p_profile_json: PRACTICE_SIMULATION_FIXTURE.profile,
    })
  })

  test('reuses an active fixture without creating another auth identity', async () => {
    mocks.sessionRpc.mockResolvedValueOnce({
      data: { ...reservation, ...active, reservationId: reservation.reservationId, invitationId: reservation.invitationId, internalEmail: reservation.internalEmail, provisionedUserId: '16000000-0000-4000-8000-000000000001' },
      error: null,
    })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.serviceRpc).not.toHaveBeenCalled()
  })

  test('allows only an active practitioner actor and fails closed on rate-limit storage', async () => {
    mocks.actor.mockResolvedValueOnce({ ok: true, userId: 'athlete', actorKind: 'athlete', subjectId: active.subjectId })
    expect((await POST()).status).toBe(403)
    mocks.rateLimit.mockResolvedValueOnce(false)
    expect((await POST()).status).toBe(429)
    expect(mocks.sessionRpc).not.toHaveBeenCalled()
  })

  test('preserves the database creation cap without attempting Auth provisioning', async () => {
    mocks.sessionRpc.mockResolvedValueOnce({ data: null, error: { code: 'PT429' } })
    const response = await POST()
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ code: 'rate_limited' })
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.serviceRpc).not.toHaveBeenCalled()
  })

  test('cancels reservation when Auth provisioning fails without sending an invitation email', async () => {
    mocks.createUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'failed' } })
    const response = await POST()
    expect(response.status).toBe(503)
    expect(mocks.serviceRpc).toHaveBeenCalledWith('cancel_training_simulation_identity', {
      p_reservation_id: reservation.reservationId,
      p_reason: 'auth provisioning failed',
    })
  })

  test('cancels and deletes a newly created internal user when activation fails', async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'activation failed' } })
      .mockResolvedValueOnce({ data: 'cancelled', error: null })
    const response = await POST()
    expect(response.status).toBe(503)
    expect(mocks.deleteUser).toHaveBeenCalledWith('16000000-0000-4000-8000-000000000001')
  })
})
