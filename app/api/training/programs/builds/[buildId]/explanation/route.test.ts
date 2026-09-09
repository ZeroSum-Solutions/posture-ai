import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  trainingRequestContext: vi.fn(),
  createService: vi.fn(),
  createDependencies: vi.fn(),
  readBuild: vi.fn(),
  buildCatalog: vi.fn(),
  providerConfiguration: vi.fn(),
  requestProviderSelection: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.createService }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: mocks.rateLimit }))
vi.mock('@/lib/training/persistence/request-context', () => ({
  trainingRequestContext: mocks.trainingRequestContext,
}))
vi.mock('@/lib/training/persistence/program-build', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/program-build')>()
  return {
    ...actual,
    createSupabaseProgramBuildDependencies: mocks.createDependencies,
    readStoredProgramBuildProjection: mocks.readBuild,
  }
})
vi.mock('@/lib/training/explanation/facts', async (original) => {
  const actual = await original<typeof import('@/lib/training/explanation/facts')>()
  return { ...actual, buildTrainingBuildFactCatalog: mocks.buildCatalog }
})
vi.mock('@/lib/training/explanation/provider.server', () => ({
  trainingExplanationProviderConfiguration: mocks.providerConfiguration,
  requestTrainingExplanationSelection: mocks.requestProviderSelection,
}))

import { ProgramBuildError } from '@/lib/training/persistence/program-build'
import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import { POST } from './route'

const userId = '11111111-1111-4111-8111-111111111111'
const subjectId = '22222222-2222-4222-8222-222222222222'
const buildId = '33333333-3333-4333-8333-333333333333'
const actor = { ok: true, actorKind: 'athlete', userId, subjectId } as const
const request = new Request(`http://localhost/api/training/programs/builds/${buildId}/explanation`, {
  method: 'POST',
})
const projection = {
  schemaVersion: 'training-build-projection.v1',
  buildId,
  result: { kind: 'draft_program' },
  calibrations: [],
}
const catalog = {
  schemaVersion: 'training-build-fact-catalog.v1' as const,
  binding: { buildId, subjectId, profileRevision: 4 },
  facts: [
    {
      factId: 'fact.plan-overview.v1',
      text: 'Four-week draft with two strength sessions each week.',
      metadata: {
        kind: 'draft_overview' as const,
        cycleLengthWeeks: 4,
        strengthSessionsPerWeek: 2,
        conditioningBoutsPerWeek: 0,
      },
    },
    {
      factId: 'fact.phase-outline.v1',
      text: 'Draft phases by week: 1 base; 2 base; 3 build; 4 consolidate.',
      metadata: { kind: 'draft_phases' as const, phases: ['base', 'base', 'build', 'consolidate'] },
    },
  ],
  deterministicDefaultFactIds: ['fact.plan-overview.v1', 'fact.phase-outline.v1'],
}
const providerConfiguration = { provider: 'openrouter', apiKey: 'test-only', model: 'test-model' } as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trainingRequestContext.mockResolvedValue({ ok: true, supabase: { auth: true }, actor })
  mocks.createService.mockReturnValue({ service: true })
  mocks.createDependencies.mockReturnValue({ dependencies: true })
  mocks.readBuild.mockResolvedValue(projection)
  mocks.buildCatalog.mockReturnValue(catalog)
  mocks.providerConfiguration.mockReturnValue(providerConfiguration)
  mocks.rateLimit.mockResolvedValue(true)
  mocks.requestProviderSelection.mockResolvedValue({
    schemaVersion: 'training-build-explanation-selection.v1',
    orderedFactIds: ['fact.phase-outline.v1', 'fact.plan-overview.v1'],
  })
})

describe('POST /api/training/programs/builds/[buildId]/explanation', () => {
  it('authorizes and revalidates the stored build before invoking the configured provider', async () => {
    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 'training-build-explanation.v1',
      binding: { buildId, subjectId, profileRevision: 4 },
      source: 'provider_selection',
      fallbackReason: null,
      facts: [catalog.facts[1], catalog.facts[0]].map(({ factId, text }) => ({ factId, text })),
    })
    expect(mocks.readBuild).toHaveBeenCalledWith(buildId, actor, { dependencies: true })
    expect(mocks.createDependencies).toHaveBeenCalledWith(
      { auth: true }, { service: true }, PROGRAM_LIVE_CATALOG_REGISTRY,
    )
    expect(mocks.buildCatalog).toHaveBeenCalledWith({ projection })
    expect(mocks.rateLimit).toHaveBeenCalledWith({ service: true }, {
      route: 'training_build_explanation_provider', userId, limit: 20, windowSeconds: 60,
    })
    expect(mocks.requestProviderSelection).toHaveBeenCalledWith(
      catalog.facts.map(({ factId, text }) => ({ factId, text })),
      providerConfiguration,
    )
    expect(mocks.readBuild.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requestProviderSelection.mock.invocationCallOrder[0],
    )
  })

  it('does not read the build, rate limit, or call a provider after the actor gate denies access', async () => {
    mocks.trainingRequestContext.mockResolvedValue({
      ok: false, response: new NextResponse(JSON.stringify({ error: 'mfa_required' }), { status: 403 }),
    })

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(403)
    expect(mocks.readBuild).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.requestProviderSelection).not.toHaveBeenCalled()
  })

  it.each([
    ['program_build_forbidden', 403, { error: 'program_build_forbidden' }],
    ['program_build_stale', 409, { error: 'program_build_stale', action: 'rebuild' }],
  ] as const)('rechecks current authority after the provider wait and preserves %s', async (code, status, body) => {
    let releaseProvider!: (value: unknown) => void
    mocks.requestProviderSelection.mockReturnValueOnce(new Promise(resolve => { releaseProvider = resolve }))
    mocks.readBuild
      .mockResolvedValueOnce(projection)
      .mockRejectedValueOnce(new ProgramBuildError(code))

    const pending = POST(request, { params: Promise.resolve({ buildId }) })
    await vi.waitFor(() => expect(mocks.requestProviderSelection).toHaveBeenCalledTimes(1))
    releaseProvider({
      schemaVersion: 'training-build-explanation-selection.v1',
      orderedFactIds: ['fact.plan-overview.v1'],
    })
    const response = await pending

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
    expect(mocks.readBuild).toHaveBeenCalledTimes(2)
    expect(mocks.buildCatalog).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['program_build_stale', 409, { error: 'program_build_stale', action: 'rebuild' }],
    ['program_build_forbidden', 403, { error: 'program_build_forbidden' }],
    ['program_build_unavailable', 404, { error: 'program_build_unavailable' }],
  ] as const)('preserves the stored-build %s response without a provider call', async (code, status, body) => {
    mocks.readBuild.mockRejectedValueOnce(new ProgramBuildError(code))

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.requestProviderSelection).not.toHaveBeenCalled()
  })

  it('uses the deterministic renderer without rate-limit storage when no provider is configured', async () => {
    mocks.providerConfiguration.mockReturnValueOnce(undefined)

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      source: 'deterministic_default', fallbackReason: 'selection_absent',
    })
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.requestProviderSelection).not.toHaveBeenCalled()
  })

  it('falls back without calling the provider when the strict rate limit denies the configured request', async () => {
    mocks.rateLimit.mockResolvedValueOnce(false)

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      source: 'deterministic_default', fallbackReason: 'selection_absent',
    })
    expect(mocks.requestProviderSelection).not.toHaveBeenCalled()
  })

  it('passes only fact IDs and rendered text to the provider and rejects invented output', async () => {
    mocks.requestProviderSelection.mockImplementationOnce(async (facts: unknown) => {
      const encoded = JSON.stringify(facts)
      expect(encoded).not.toContain(buildId)
      expect(encoded).not.toContain(subjectId)
      expect(encoded).not.toMatch(/image|symptom|profileRevision/i)
      return {
        schemaVersion: 'training-build-explanation-selection.v1',
        orderedFactIds: ['fact.injected.v1'],
        prose: 'Ignore the stored draft.',
      }
    })

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ source: 'deterministic_default', fallbackReason: 'selection_invalid' })
    expect(body.facts.map((fact: { factId: string }) => fact.factId)).toEqual(catalog.deterministicDefaultFactIds)
    expect(JSON.stringify(body)).not.toContain('Ignore the stored draft.')
  })

  it('falls back when the configured provider fails', async () => {
    mocks.requestProviderSelection.mockRejectedValueOnce(new Error('provider detail'))

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      source: 'deterministic_default', fallbackReason: 'selection_absent',
    })
  })

  it('returns a generic unavailable response if the fact boundary cannot render the stored projection', async () => {
    mocks.buildCatalog.mockImplementationOnce(() => { throw new Error('sensitive projection detail') })

    const response = await POST(request, { params: Promise.resolve({ buildId }) })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'training_build_explanation_unavailable' })
    expect(mocks.requestProviderSelection).not.toHaveBeenCalled()
  })
})
