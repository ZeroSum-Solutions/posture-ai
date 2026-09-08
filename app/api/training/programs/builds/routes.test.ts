import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  trainingRequestContext: vi.fn(),
  createService: vi.fn(),
  createDependencies: vi.fn(),
  createBuild: vi.fn(),
  readBuild: vi.fn(),
  acceptBuild: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.createService }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.trainingRequestContext }))
vi.mock('@/lib/training/persistence/program-build', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/program-build')>()
  return {
    ...actual,
    createSupabaseProgramBuildDependencies: mocks.createDependencies,
    createStoredProgramBuild: mocks.createBuild,
    readStoredProgramBuildProjection: mocks.readBuild,
    acceptStoredProgramBuild: mocks.acceptBuild,
  }
})

import { ProgramBuildError } from '@/lib/training/persistence/program-build'
import { POST as create } from './route'
import { GET as read } from './[buildId]/route'
import { POST as accept } from './[buildId]/accept/route'

const subjectId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const buildId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const actor = { ok: true, actorKind: 'athlete', userId, subjectId } as const
const request = (body: unknown) => new Request('http://localhost/api/training/programs/builds', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createService.mockReturnValue({ service: true })
  mocks.createDependencies.mockReturnValue({ dependencies: true })
  mocks.trainingRequestContext.mockResolvedValue({ ok: true, supabase: { auth: true }, actor })
})

describe('training program build routes', () => {
  it('accepts only the fixed server-owned build request contract', async () => {
    for (const extra of [
      { simulationRunId: buildId },
      { executionContext: { kind: 'live' } },
      { profile: {} },
      { catalog: {} },
    ]) {
      const response = await create(request({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08', ...extra }))
      expect(response.status).toBe(422)
    }
    expect(mocks.createBuild).not.toHaveBeenCalled()
  })

  it('returns the stable stored-build projection', async () => {
    const projection = {
      schemaVersion: 'training-build-projection.v1', buildId,
      result: { kind: 'draft_program' }, calibrations: [{ exerciseLabel: 'Synthetic goblet squat', calibration: {} }],
    }
    mocks.createBuild.mockResolvedValue(projection)
    const response = await create(request({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(projection)
    expect(mocks.createBuild).toHaveBeenCalledWith(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, { dependencies: true },
    )
  })

  it('does not invoke persistence after the actor gate denies the request', async () => {
    mocks.trainingRequestContext.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await create(request({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }))).status).toBe(403)
    expect(mocks.createBuild).not.toHaveBeenCalled()
  })

  it('reloads a stored build through the authenticated projection route', async () => {
    const projection = { schemaVersion: 'training-build-projection.v1', buildId, result: { kind: 'draft_program' }, calibrations: [] }
    mocks.readBuild.mockResolvedValue(projection)
    const response = await read(request({}), { params: Promise.resolve({ buildId }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(projection)
    expect(mocks.readBuild).toHaveBeenCalledWith(buildId, actor, { dependencies: true })
  })

  it('accepts only representative load and conditioning choice fields', async () => {
    const fixed = {
      loadChoices: [{ exerciseInstanceId: 'exercise-1', optionIndex: 0 }],
      conditioningChoices: [{ boutId: 'bout-1', acceptedDurationSeconds: 600 }],
    }
    mocks.acceptBuild.mockResolvedValue({ schemaVersion: 'training-build-acceptance.v1', buildId, draftId })
    const response = await accept(request(fixed), { params: Promise.resolve({ buildId }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ schemaVersion: 'training-build-acceptance.v1', buildId, draftId })
    expect(mocks.acceptBuild).toHaveBeenCalledWith(buildId, fixed, actor, { dependencies: true })

    const rejected = await accept(request({ loadSelections: fixed.loadChoices, conditioningChoices: fixed.conditioningChoices }), {
      params: Promise.resolve({ buildId }),
    })
    expect(rejected.status).toBe(422)
  })

  it('maps stale and selection conflicts without silently replacing a draft', async () => {
    mocks.acceptBuild.mockRejectedValueOnce(new ProgramBuildError('program_build_selection_conflict'))
    const response = await accept(request({ loadChoices: [], conditioningChoices: [] }), { params: Promise.resolve({ buildId }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'program_build_selection_conflict' })

    mocks.createBuild.mockRejectedValueOnce(new ProgramBuildError('program_build_stale'))
    const stale = await create(request({ subjectId, profileRevision: 2, cycleStartLocalDate: '2026-09-08' }))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'program_build_stale', action: 'reload_profile' })
  })
})
