import { beforeEach, expect, it, vi } from 'vitest'
import { GET } from './route'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: vi.fn() }))
const subjectId = '45000000-0000-4000-8000-000000000003'
const limit = vi.fn()
const order = vi.fn(() => ({ limit }))
const eq = vi.fn(() => ({ order }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(trainingRequestContext).mockResolvedValue({ ok: true, supabase: { from }, actor: { ok: true, actorKind: 'athlete', userId: subjectId, subjectId } } as never)
})
it('reads saved programs through one subject-filtered RLS query', async () => {
  limit.mockResolvedValue({ data: [{ id: 'assignment-1', subject_id: subjectId, program_mode: 'self_directed', simulation_run_id: null, status: 'active', created_at: '2026-09-08', training_sessions: [] }], error: null })
  const response = await GET(new Request(`http://localhost/api/training/programs?subjectId=${subjectId}`))
  expect(response.status).toBe(200)
  expect(eq).toHaveBeenCalledWith('subject_id', subjectId)
  expect((await response.json()).programs[0].sessions).toEqual([])
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})
it('does not turn failed reads into an empty list', async () => {
  limit.mockResolvedValue({ data: null, error: { code: 'XX000' } })
  expect((await GET(new Request(`http://localhost/api/training/programs?subjectId=${subjectId}`))).status).toBe(503)
})
it('rejects an ambiguous or extra query before persistence', async () => {
  expect((await GET(new Request(`http://localhost/api/training/programs?subjectId=${subjectId}&subjectId=${subjectId}`))).status).toBe(400)
  expect(from).not.toHaveBeenCalled()
})
