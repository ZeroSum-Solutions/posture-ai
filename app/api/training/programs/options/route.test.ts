import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  trainingRequestContext: vi.fn(),
  createDependencies: vi.fn(),
  readOptions: vi.fn(),
}))

vi.mock('@/lib/training/persistence/request-context', () => ({
  trainingRequestContext: mocks.trainingRequestContext,
}))
vi.mock('@/lib/training/persistence/program-options', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/program-options')>()
  return {
    ...actual,
    createSupabaseProgramOptionsDependencies: mocks.createDependencies,
    readTrainingProgramOptions: mocks.readOptions,
  }
})

import { ProgramOptionsError } from '@/lib/training/persistence/program-options'
import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import { GET } from './route'

const subjectId = '11111111-1111-4111-8111-111111111111'
const actor = {
  ok: true, actorKind: 'athlete', userId: '22222222-2222-4222-8222-222222222222', subjectId,
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trainingRequestContext.mockResolvedValue({ ok: true, supabase: { auth: true }, actor })
  mocks.createDependencies.mockReturnValue({ dependencies: true })
})

describe('training program options route', () => {
  it('returns the authenticated exact-revision options projection without a write rate-limit', async () => {
    const projection = {
      schemaVersion: 'training-program-options.v1', subjectId, profileRevision: 4,
      executionContext: { kind: 'live' }, catalogVersion: 'authored-general.v1',
      catalogOrigin: { kind: 'authored_catalog' }, conditioningPreference: { status: 'required' },
      conditioningModes: [], exerciseOptions: [],
    }
    mocks.readOptions.mockResolvedValue(projection)

    const response = await GET(new Request(
      `http://localhost/api/training/programs/options?subjectId=${subjectId}&profileRevision=4`,
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(projection)
    expect(mocks.trainingRequestContext).toHaveBeenCalledWith(false)
    expect(mocks.readOptions).toHaveBeenCalledWith(
      { subjectId, profileRevision: 4 }, actor, { dependencies: true },
    )
    expect(mocks.createDependencies).toHaveBeenCalledWith(
      { auth: true }, PROGRAM_LIVE_CATALOG_REGISTRY,
    )
  })

  it('rejects missing, duplicate, malformed, or extra selectors before persistence', async () => {
    for (const query of [
      `subjectId=${subjectId}`,
      `subjectId=${subjectId}&profileRevision=0`,
      `subjectId=${subjectId}&subjectId=${subjectId}&profileRevision=4`,
      `subjectId=${subjectId}&profileRevision=4&catalogVersion=client-choice`,
    ]) {
      expect((await GET(new Request(`http://localhost/api/training/programs/options?${query}`))).status).toBe(400)
    }
    expect(mocks.readOptions).not.toHaveBeenCalled()
  })

  it('stops before persistence when the actor gate fails', async () => {
    mocks.trainingRequestContext.mockResolvedValue({
      ok: false, response: new NextResponse(null, { status: 403 }),
    })
    const response = await GET(new Request(
      `http://localhost/api/training/programs/options?subjectId=${subjectId}&profileRevision=4`,
    ))
    expect(response.status).toBe(403)
    expect(mocks.readOptions).not.toHaveBeenCalled()
  })

  it('maps stale, forbidden, and unavailable projections without returning partial options', async () => {
    for (const [code, status] of [
      ['program_options_stale', 409],
      ['program_options_forbidden', 403],
      ['program_options_unavailable', 503],
    ] as const) {
      mocks.readOptions.mockRejectedValueOnce(new ProgramOptionsError(code))
      const response = await GET(new Request(
        `http://localhost/api/training/programs/options?subjectId=${subjectId}&profileRevision=4`,
      ))
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ error: code })
    }
  })
})
