import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), create: vi.fn(), accept: vi.fn(), dependencies: vi.fn(), service: vi.fn(),
}))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/training/persistence/manual-recalibrations', async original => ({
  ...await original<typeof import('@/lib/training/persistence/manual-recalibrations')>(),
  createStoredManualRecalibrationProposal: mocks.create,
  acceptStoredManualRecalibrationProposal: mocks.accept,
  createSupabaseManualRecalibrationDependencies: mocks.dependencies,
}))

import { ManualRecalibrationError } from '@/lib/training/persistence/manual-recalibrations'
import { POST as create } from './route'
import { POST as accept } from './[proposalId]/accept/route'

const actor = {
  ok: true, actorKind: 'athlete', userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, actor, supabase: {} })
  mocks.dependencies.mockReturnValue({})
  mocks.service.mockReturnValue({})
})

describe('manual recalibration proposal routes', () => {
  it('passes only the bounded source identity to proposal creation', async () => {
    mocks.create.mockResolvedValue({ schemaVersion: 'manual-recalibration-projection.v1', proposalId, offer: {} })
    const response = await create(new Request('http://localhost/api/training/manual-recalibrations/proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, {})
    const forged = await create(new Request('http://localhost/api/training/manual-recalibrations/proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1', selectedLoad: {} }),
    }))
    expect(forged.status).toBe(422)
  })

  it('keeps exact request, option, and acknowledgement on acceptance', async () => {
    mocks.accept.mockResolvedValue({ schemaVersion: 'manual-recalibration-acceptance.v1', proposalId })
    const response = await accept(new Request('http://localhost/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, optionIndex: 2, outlierAcknowledged: true }),
    }), { params: Promise.resolve({ proposalId }) })
    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith(
      proposalId, { requestId, optionIndex: 2, outlierAcknowledged: true }, {},
    )
  })

  it.each([
    ['manual_recalibration_forbidden', 403, undefined],
    ['manual_recalibration_source_stale', 409, 'refresh_manual_recalibration'],
    ['manual_recalibration_request_id_conflict', 409, 'retry_with_new_request'],
    ['manual_recalibration_acknowledgement_required', 409, 'confirm_outlier'],
  ] as const)('maps trusted acceptance error %s', async (code, status, action) => {
    mocks.accept.mockRejectedValue(new ManualRecalibrationError(code))
    const response = await accept(new Request('http://localhost/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, optionIndex: 0, outlierAcknowledged: false }),
    }), { params: Promise.resolve({ proposalId }) })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(action ? { error: code, action } : { error: code })
  })
})
