import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from './route'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { loadProgramWorkspace, programWorkspaceDependencies } from '@/lib/training/persistence/program-workspace'

vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: vi.fn() }))
vi.mock('@/lib/training/persistence/program-workspace', () => ({ loadProgramWorkspace: vi.fn(), programWorkspaceDependencies: vi.fn(() => 'dependencies') }))

const assignmentId = 'assignment-1'
const params = { params: Promise.resolve({ assignmentId }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(trainingRequestContext).mockResolvedValue({ ok: true, supabase: { rpc: vi.fn() }, actor: { actorKind: 'athlete' } } as never)
})

describe('training program workspace route', () => {
  it('requires the existing authenticated training actor context before persistence', async () => {
    vi.mocked(trainingRequestContext).mockResolvedValueOnce({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await GET(new Request('http://localhost/api?view=program'), params)).status).toBe(403)
    expect(loadProgramWorkspace).not.toHaveBeenCalled()
  })

  it('passes a bounded exact view query to the RLS persistence adapter and disables caching', async () => {
    vi.mocked(loadProgramWorkspace).mockResolvedValueOnce({ kind: 'found', value: { schemaVersion: 'training-program-workspace.v1' } as never })
    const response = await GET(new Request('http://localhost/api?view=history&limit=7'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(programWorkspaceDependencies).toHaveBeenCalledTimes(1)
    expect(loadProgramWorkspace).toHaveBeenCalledWith('dependencies', { assignmentId, view: 'history', limit: 7, cursor: null })
  })

  it('rejects unknown, duplicate, and oversized query fields before persistence', async () => {
    for (const query of ['view=program&extra=1', 'view=program&view=history', 'view=program&limit=25']) {
      expect((await GET(new Request(`http://localhost/api?${query}`), params)).status).toBe(400)
    }
    expect(loadProgramWorkspace).not.toHaveBeenCalled()
  })

  it('returns explicit not-found, stale, and unavailable states', async () => {
    vi.mocked(loadProgramWorkspace).mockResolvedValueOnce({ kind: 'not_found' })
    expect((await GET(new Request('http://localhost/api?view=program'), params)).status).toBe(404)
    vi.mocked(loadProgramWorkspace).mockResolvedValueOnce({ kind: 'stale_cursor' })
    const stale = await GET(new Request('http://localhost/api?view=program'), params)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'training_program_changed', action: 'reload_program' })
    vi.mocked(loadProgramWorkspace).mockResolvedValueOnce({ kind: 'unavailable' })
    expect((await GET(new Request('http://localhost/api?view=program'), params)).status).toBe(503)
  })
})
