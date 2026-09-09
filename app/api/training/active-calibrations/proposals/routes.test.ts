import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), create: vi.fn(), accept: vi.fn(), dependencies: vi.fn(), service: vi.fn(),
}))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/training/persistence/active-calibrations', async original => ({
  ...await original<typeof import('@/lib/training/persistence/active-calibrations')>(),
  createStoredActiveCalibrationProposal: mocks.create,
  acceptStoredActiveCalibrationProposal: mocks.accept,
  createSupabaseActiveCalibrationDependencies: mocks.dependencies,
}))

import { ActiveCalibrationError } from '@/lib/training/persistence/active-calibrations'
import { POST as create } from './route'
import { POST as accept } from './[proposalId]/accept/route'

const actor = {
  ok: true, actorKind: 'athlete', userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, actor, supabase: {} })
  mocks.dependencies.mockReturnValue({})
  mocks.service.mockReturnValue({})
})

describe('active calibration proposal routes', () => {
  it('passes only the bounded source identity to the server proposal facade', async () => {
    mocks.create.mockResolvedValue({ schemaVersion: 'active-calibration-projection.v1', proposalId, offer: {} })
    const response = await create(new Request('http://localhost/api/training/active-calibrations/proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(
      { sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, {},
    )
    const forged = await create(new Request('http://localhost/api/training/active-calibrations/proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1', optionIndex: 0 }),
    }))
    expect(forged.status).toBe(422)
  })

  it('keeps request identity and exact option index on authenticated acceptance', async () => {
    mocks.accept.mockResolvedValue({ schemaVersion: 'active-calibration-acceptance.v1', proposalId })
    const requestId = '44444444-4444-4444-8444-444444444444'
    const response = await accept(new Request('http://localhost/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, optionIndex: 2 }),
    }), { params: Promise.resolve({ proposalId }) })
    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith(proposalId, { requestId, optionIndex: 2 }, {})
  })

  it.each([
    ['active_calibration_forbidden', 403, undefined],
    ['active_calibration_source_stale', 409, 'refresh_active_calibration'],
    ['active_calibration_request_id_conflict', 409, 'retry_with_new_request'],
  ] as const)('maps trusted acceptance error %s', async (code, status, action) => {
    mocks.accept.mockRejectedValue(new ActiveCalibrationError(code))
    const response = await accept(new Request('http://localhost/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: '44444444-4444-4444-8444-444444444444', optionIndex: 0 }),
    }), { params: Promise.resolve({ proposalId }) })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(action ? { error: code, action } : { error: code })
  })
})
