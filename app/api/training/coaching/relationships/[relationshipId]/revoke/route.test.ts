import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), revoke: vi.fn(), dependencies: vi.fn(() => ({})) }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/coaching-relationships', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/training/persistence/coaching-relationships')>(),
  revokeTrainingCoachingRelationship: mocks.revoke,
  createSupabaseTrainingCoachingRelationshipDependencies: mocks.dependencies,
}))

import { TrainingCoachingRelationshipError } from '@/lib/training/persistence/coaching-relationships'
import { POST } from './route'

const relationshipId = '44000000-0000-4000-8000-000000000001'
const subjectId = '42000000-0000-4000-8000-000000000001'
const requestId = '45000000-0000-4000-8000-000000000001'
const actor = { ok: true, actorKind: 'athlete', userId: '41000000-0000-4000-8000-000000000001', subjectId } as const
const receipt = {
  schemaVersion: 'training-coaching-relationship-revocation.v1', requestId, relationshipId, subjectId,
  status: 'revoked', revision: 4, affectedSessionIds: ['session-1'],
}

function request(body: unknown = { requestId, expectedRevision: 3 }) {
  return new Request(`http://localhost/api/training/coaching/relationships/${relationshipId}/revoke`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}
function routeParams(id = relationshipId) {
  return { params: Promise.resolve({ relationshipId: id }) }
}

describe('POST /api/training/coaching/relationships/[relationshipId]/revoke', () => {
  beforeEach(() => {
    mocks.context.mockReset().mockResolvedValue({ ok: true, actor, supabase: {} })
    mocks.revoke.mockReset().mockResolvedValue(receipt)
    mocks.dependencies.mockClear()
  })

  it('applies the exact optimistic revision in an authenticated write context', async () => {
    const response = await POST(request(), routeParams())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(receipt)
    expect(mocks.context).toHaveBeenCalledWith(true)
    expect(mocks.revoke).toHaveBeenCalledWith(requestId, relationshipId, 3, actor, {})
  })

  it('rejects malformed input without calling persistence', async () => {
    expect((await POST(request({ requestId, expectedRevision: 0 }), routeParams())).status).toBe(422)
    expect((await POST(request({ requestId, expectedRevision: 3, subjectId }), routeParams())).status).toBe(422)
    expect((await POST(request(), routeParams('not-a-uuid'))).status).toBe(400)
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it('returns a reload action for a revision conflict and hides authorization details', async () => {
    mocks.revoke.mockRejectedValueOnce(new TrainingCoachingRelationshipError('relationship_revision_conflict'))
    const conflict = await POST(request(), routeParams())
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: 'relationship_revision_conflict', action: 'reload_relationships' })

    mocks.revoke.mockRejectedValueOnce(new TrainingCoachingRelationshipError('relationship_revocation_forbidden'))
    expect((await POST(request(), routeParams())).status).toBe(403)

    mocks.revoke.mockRejectedValueOnce(new TrainingCoachingRelationshipError('relationship_request_conflict'))
    const requestConflict = await POST(request(), routeParams())
    expect(requestConflict.status).toBe(409)
    await expect(requestConflict.json()).resolves.toEqual({ error: 'relationship_request_conflict', action: 'reload_relationships' })
  })

  it('preserves actor failures and fails closed for unavailable storage', async () => {
    const denied = new Response(null, { status: 429 })
    mocks.context.mockResolvedValueOnce({ ok: false, response: denied })
    expect(await POST(request(), routeParams())).toBe(denied)

    mocks.revoke.mockRejectedValueOnce(new Error('storage'))
    expect((await POST(request(), routeParams())).status).toBe(503)
  })
})
