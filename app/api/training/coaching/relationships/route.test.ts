import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), dependencies: vi.fn(() => ({})) }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/coaching-relationships', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/training/persistence/coaching-relationships')>(),
  readTrainingCoachingRelationships: mocks.read,
  createSupabaseTrainingCoachingRelationshipDependencies: mocks.dependencies,
}))

import { TrainingCoachingRelationshipError } from '@/lib/training/persistence/coaching-relationships'
import { GET } from './route'

const subjectId = '42000000-0000-4000-8000-000000000001'
const athlete = { ok: true, actorKind: 'athlete', userId: '41000000-0000-4000-8000-000000000001', subjectId } as const
const coach = { ok: true, actorKind: 'practitioner', userId: '41000000-0000-4000-8000-000000000002', subjectId: null } as const
const projection = { schemaVersion: 'training-coaching-relationship-list.v1', subjectId, viewerRole: 'athlete', relationships: [] }

describe('GET /api/training/coaching/relationships', () => {
  beforeEach(() => {
    mocks.context.mockReset().mockResolvedValue({ ok: true, actor: athlete, supabase: {} })
    mocks.read.mockReset().mockResolvedValue(projection)
    mocks.dependencies.mockClear()
  })

  it('derives an athlete subject without accepting a selector', async () => {
    const response = await GET(new Request('http://localhost/api/training/coaching/relationships'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.read).toHaveBeenCalledWith(subjectId, athlete, {})
  })

  it('requires one canonical subject selector for a practitioner', async () => {
    mocks.context.mockResolvedValue({ ok: true, actor: coach, supabase: {} })
    expect((await GET(new Request('http://localhost/api/training/coaching/relationships'))).status).toBe(400)
    expect((await GET(new Request('http://localhost/api/training/coaching/relationships?subjectId=bad'))).status).toBe(400)
    expect((await GET(new Request(`http://localhost/api/training/coaching/relationships?subjectId=${subjectId}`))).status).toBe(200)
    expect(mocks.read).toHaveBeenLastCalledWith(subjectId, coach, {})
  })

  it('rejects athlete selectors and malformed duplicate query fields', async () => {
    expect((await GET(new Request(`http://localhost/api/training/coaching/relationships?subjectId=${subjectId}`))).status).toBe(400)
    mocks.context.mockResolvedValue({ ok: true, actor: coach, supabase: {} })
    expect((await GET(new Request(`http://localhost/api/training/coaching/relationships?subjectId=${subjectId}&subjectId=${subjectId}`))).status).toBe(400)
  })

  it('preserves actor failures and fails closed for projection errors', async () => {
    const denied = new Response(null, { status: 403 })
    mocks.context.mockResolvedValueOnce({ ok: false, response: denied })
    expect(await GET(new Request('http://localhost/api/'))).toBe(denied)

    mocks.read.mockRejectedValueOnce(new TrainingCoachingRelationshipError('relationship_projection_forbidden'))
    expect((await GET(new Request('http://localhost/api/training/coaching/relationships'))).status).toBe(403)
    mocks.read.mockRejectedValueOnce(new Error('storage'))
    expect((await GET(new Request('http://localhost/api/training/coaching/relationships'))).status).toBe(503)
  })
})

