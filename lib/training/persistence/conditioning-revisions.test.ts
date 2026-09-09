import { describe, expect, it, vi } from 'vitest'
import { SYNTHETIC_CONDITIONING_JOURNEY_CATALOG } from '../catalog/syntheticConditioningJourney'
import { TrainingCatalogV1Schema } from '../catalog/types'
import type { ConditioningRevisionRegistryV1, ConditioningRevisionDependencies } from './conditioning-revisions'
import {
  ConditioningRevisionError,
  DEFAULT_CONDITIONING_REVISION_REGISTRY,
  acceptStoredConditioningRevisionProposal,
  createStoredConditioningRevisionProposal,
  createSupabaseConditioningRevisionDependencies,
  readConditioningRevisionOptions,
} from './conditioning-revisions'

const subjectId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const simulationRunId = '55555555-5555-4555-8555-555555555555'
const origin = {
  kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'conditioning-fixture.v1',
  fixtureHash: 'a'.repeat(64), label: 'Synthetic conditioning fixture',
} as const
const context = {
  kind: 'synthetic_simulation', simulationRunId, fixtureId: origin.fixtureId,
  fixtureHash: origin.fixtureHash, label: 'Practice data',
} as const
const catalog = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1', catalogVersion: 'conditioning-fixture.v1', origin,
  exercises: [],
  conditioningModes: [
    { modalityId: 'synthetic-walk.v1', label: 'Synthetic walking', preferenceRank: 0, lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', effortCue: 'Walk at a synthetic conversational pace.' },
    { modalityId: 'synthetic-cycle.v1', label: 'Synthetic cycle', preferenceRank: 1, lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', effortCue: 'Cycle at a synthetic conversational pace.' },
  ],
})
const dates = ['2026-09-08', '2026-09-11', '2026-09-15', '2026-09-18']

function bout(index: number) {
  return {
    status: 'accepted', acceptanceId: `accept-${index}`, acceptedAt: '2026-09-01T12:00:00Z',
    acceptedByUserId: userId, executionContext: context, boutId: `bout-${index}`,
    modalityId: 'synthetic-walk.v1', scheduledLocalDate: dates[index - 1], athleteTimezone: 'UTC',
    acceptedDurationSeconds: 600, effortCue: 'Walk at a synthetic conversational pace.',
    source: { compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: catalog.catalogVersion, catalogOrigin: origin },
  } as const
}

const program = {
  schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-1', revisionNumber: 3,
  subjectId, programMode: 'self_directed', owningPractitionerId: null, executionContext: context,
  cycleStartLocalDate: '2026-09-01', cycleLengthWeeks: 4, profileRevisionId: '2',
  eligibilitySourceRevisionId: `simulation:${simulationRunId}`,
  compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: catalog.catalogVersion,
  catalogOrigin: origin, ruleVersion: 'strength-progression-v1', compiledProgramRevisionId: 'compiled-1',
  publishedAt: '2026-09-01T12:00:00Z', author: { kind: 'athlete', userId },
  sessions: [{
    sessionId: 'strength-1', scheduledLocalDate: '2026-09-10', athleteTimezone: 'UTC', exercises: [{
      exerciseInstanceId: 'exercise-1', exerciseVersionId: 'synthetic-squat.v1',
      setIds: ['set-1'], repRange: { minimum: 8, maximum: 12 },
      targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
      acceptedInitialLoad: {
        status: 'accepted', acceptanceId: 'load-1', acceptedAt: '2026-09-01T12:00:00Z',
        acceptedByUserId: userId, source: 'equipment_inventory', executionContext: context,
        exerciseInstanceId: 'exercise-1', exerciseVersionId: 'synthetic-squat.v1', equipmentId: 'db-1',
        provenance: { profileRevisionId: '2', compiledProgramRevisionId: 'compiled-1', catalogVersion: catalog.catalogVersion, catalogOrigin: origin },
        quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' },
        loadBasis: 'dumbbell_single_implement', implementCount: 1,
        holdingConfiguration: 'two_hands_single_implement',
      },
    }],
  }],
  conditioningBouts: [bout(1), bout(2), bout(3), bout(4)],
} as const

function candidate() {
  return {
    schemaVersion: 'conditioning-revision-candidate.v1', status: 'ready',
    assignmentId: 'assignment-1', assignmentRevision: 7, subjectId,
    currentLocalDate: '2026-09-08', programHash: 'b'.repeat(64), currentProfileRevision: 2,
    program,
    sessionStates: [1, 2, 3, 4].map(index => ({
      sessionId: `bout-${index}`, state: 'scheduled', revision: 1,
      scheduledLocalDate: dates[index - 1], hasPrescription: false,
    })),
  } as const
}

const registry: ConditioningRevisionRegistryV1 = {
  resolveCatalog: () => catalog,
  resolvePairingPolicies: () => [],
}
const actor = { ok: true, actorKind: 'athlete', userId, subjectId } as const

function dependencies(read: unknown = candidate()): ConditioningRevisionDependencies {
  return {
    now: () => new Date('2026-09-08T12:00:00Z'), newId: () => proposalId,
    loadCandidate: vi.fn().mockResolvedValue(read),
    insertProposal: vi.fn(async proposal => ({ id: proposal.id })),
    acceptProposal: vi.fn(),
  }
}

function selection(modalityId = 'synthetic-cycle.v1') {
  return {
    replacementModalityId: modalityId,
    futureBouts: [1, 2, 3, 4].map(index => ({
      sourceBoutId: `bout-${index}`, scheduledLocalDate: dates[index - 1],
      acceptedDurationSeconds: 600, arrangement: 'separate',
    })),
  }
}

describe('conditioning revision persistence', () => {
  it('uses only the exact registered conditioning fixture for pairing permissions', () => {
    const registered = DEFAULT_CONDITIONING_REVISION_REGISTRY.resolveCatalog(
      SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.catalogVersion,
      SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.origin,
    )
    expect(registered).toBe(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG)
    const parsedCatalog = TrainingCatalogV1Schema.parse(registered)
    expect(parsedCatalog).not.toBe(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG)
    const fixtureOrigin = SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.origin
    expect(fixtureOrigin.kind).toBe('synthetic_fixture')
    if (fixtureOrigin.kind !== 'synthetic_fixture') throw new Error('expected synthetic fixture origin')
    const exactContext = {
      kind: 'synthetic_simulation' as const,
      simulationRunId,
      fixtureId: fixtureOrigin.fixtureId,
      fixtureHash: fixtureOrigin.fixtureHash,
      label: 'Practice data' as const,
    }
    expect(DEFAULT_CONDITIONING_REVISION_REGISTRY.resolvePairingPolicies(
      exactContext,
      parsedCatalog,
    ).map(policy => [policy.modalityId, policy.pairing])).toEqual([
      ['synthetic-continuous-walking.v1', 'off_day_only'],
      ['synthetic-stationary-cycling.v1', 'moderate_strength_first_allowed'],
    ])
    expect(DEFAULT_CONDITIONING_REVISION_REGISTRY.resolvePairingPolicies(
      { ...exactContext, fixtureHash: '0'.repeat(64) },
      parsedCatalog,
    )).toEqual([])
    expect(DEFAULT_CONDITIONING_REVISION_REGISTRY.resolveCatalog(
      'unknown-authored.v1',
      { kind: 'authored_catalog' },
    )).toBeNull()
  })

  it('projects only browser-safe changeable bouts and trusted modality options', async () => {
    const result = await readConditioningRevisionOptions('assignment-1', actor, dependencies(), registry)
    expect(result).toMatchObject({
      result: {
        kind: 'options', assignmentId: 'assignment-1', subjectId,
        changeableBouts: expect.arrayContaining([
          expect.objectContaining({ boutId: 'bout-1', arrangement: 'separate' }),
        ]),
        modalities: expect.arrayContaining([
          expect.objectContaining({ modalityId: 'synthetic-walk.v1' }),
          expect.objectContaining({ modalityId: 'synthetic-cycle.v1' }),
        ]),
      },
    })
    expect(JSON.stringify(result)).not.toContain('programHash')
  })

  it('stores a server-derived reset boundary and exact target revisions', async () => {
    const deps = dependencies()
    const result = await createStoredConditioningRevisionProposal(
      { assignmentId: 'assignment-1', selection: selection() }, actor, deps, registry,
    )
    expect(result.proposalId).toBe(proposalId)
    expect(deps.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      proposalKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      subjectId, assignmentId: 'assignment-1', baseProgramRevisionNumber: 3,
      targetRevisions: [
        { sessionId: 'bout-1', sessionRevision: 1, scheduledLocalDate: dates[0] },
        { sessionId: 'bout-2', sessionRevision: 1, scheduledLocalDate: dates[1] },
        { sessionId: 'bout-3', sessionRevision: 1, scheduledLocalDate: dates[2] },
        { sessionId: 'bout-4', sessionRevision: 1, scheduledLocalDate: dates[3] },
      ],
      revision: expect.objectContaining({
        kind: 'revision_ready', replacements: expect.arrayContaining([
          expect.objectContaining({
            evidenceBoundary: { kind: 'reset', reason: 'modality_changed' },
            progressionIdentity: { progressionSeriesId: expect.stringMatching(/^conditioning:/), evidenceEpoch: 0 },
          }),
        ]),
      }),
    }))
  })

  it('does not require a selected replacement for a scheduled bout that already has a prescription', async () => {
    const read = candidate()
    read.sessionStates[1].hasPrescription = true
    const selected = selection()
    selected.futureBouts = selected.futureBouts.filter(bout => bout.sourceBoutId !== 'bout-2')
    const deps = dependencies(read)
    const result = await createStoredConditioningRevisionProposal(
      { assignmentId: 'assignment-1', selection: selected }, actor, deps, registry,
    )
    expect(result.proposalId).toBe(proposalId)
    expect(deps.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      targetRevisions: expect.not.arrayContaining([
        expect.objectContaining({ sessionId: 'bout-2' }),
      ]),
    }))
  })

  it('returns a reschedule conflict without persisting and denies a crossed athlete subject', async () => {
    const deps = dependencies()
    const collision = selection()
    collision.futureBouts[0].scheduledLocalDate = '2026-09-10'
    const result = await createStoredConditioningRevisionProposal(
      { assignmentId: 'assignment-1', selection: collision }, actor, deps, registry,
    )
    expect(result).toMatchObject({ proposalId: null, revision: { result: { kind: 'reschedule_required' } } })
    expect(deps.insertProposal).not.toHaveBeenCalled()
    await expect(readConditioningRevisionOptions(
      'assignment-1', { ...actor, subjectId: '66666666-6666-4666-8666-666666666666' },
      dependencies(), registry,
    )).rejects.toEqual(expect.objectContaining({ code: 'conditioning_revision_forbidden' }))
  })

  it('validates the proposal-bound acceptance receipt and maps distinct conflicts', async () => {
    const deps = dependencies()
    deps.acceptProposal = vi.fn().mockResolvedValue({
      schemaVersion: 'conditioning-revision-acceptance.v1', proposalId,
      assignmentId: 'assignment-1', programRevisionNumber: 4,
      affectedBoutIds: ['bout-1'], evidenceBoundary: 'reset',
    })
    await expect(acceptStoredConditioningRevisionProposal(
      proposalId, { requestId }, deps,
    )).resolves.toMatchObject({ proposalId, evidenceBoundary: 'reset' })

    for (const [code, message, expected] of [
      ['PT409', 'conditioning revision request ID reused', 'conditioning_revision_request_id_conflict'],
      ['40001', 'conditioning revision source changed', 'conditioning_revision_source_stale'],
      ['42501', 'conditioning revision not authorized', 'conditioning_revision_forbidden'],
    ] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message } })
      const rpcDeps = createSupabaseConditioningRevisionDependencies({ rpc } as never, {} as never)
      await expect(rpcDeps.acceptProposal(proposalId, requestId)).rejects.toEqual(
        new ConditioningRevisionError(expected),
      )
    }
  })
})
