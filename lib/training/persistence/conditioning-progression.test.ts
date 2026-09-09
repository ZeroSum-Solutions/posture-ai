import { describe, expect, it, vi } from 'vitest'
import {
  ConditioningProgressionError,
  acceptStoredConditioningProgressionProposal,
  createStoredConditioningProgressionProposal,
  type ConditioningProgressionDependencies,
} from './conditioning-progression'
import { SYNTHETIC_CONDITIONING_PROGRESSION_POLICY } from '../progression/conditioningPolicy'
import { SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'

const actor = {
  ok: true, actorKind: 'practitioner', userId: '11111111-1111-4111-8111-111111111111', subjectId: null,
} as const
const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '22222222-2222-4222-8222-222222222222',
  fixtureId: 'synthetic-starter-catalog.v1', fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  label: 'Practice data',
}
const source = (id: string, date: string) => ({
  sessionId: id, sessionRevision: 4, boutId: id, modalityId: 'synthetic-continuous-walking.v1',
  scheduledLocalDate: date, sessionState: 'completed' as const,
  actual: { eventRevision: 1, durationSeconds: 600, perceivedEffort: 4, symptomState: 'none' as const },
})
const candidate = {
  schemaVersion: 'conditioning-progression-candidate.v1', status: 'ready', subjectId: 'subject-1', assignmentId: 'assignment-1',
  assignmentRevision: 1, baseProgramRevisionNumber: 1, sourceProfileRevision: 1,
  sourceEligibilityRevisionId: 'simulation:eligibility-1', programHash: 'b'.repeat(64),
  executionContext: context, modalityId: 'synthetic-continuous-walking.v1',
  sourceBouts: [source('bout-1', '2026-09-01'), source('bout-2', '2026-09-04')],
  targetBouts: [
    { sessionId: 'bout-3', sessionRevision: 1, boutId: 'bout-3', modalityId: 'synthetic-continuous-walking.v1', scheduledLocalDate: '2026-09-08', acceptedDurationSeconds: 600, authoredMaximumDurationSeconds: 1_200 },
    { sessionId: 'bout-4', sessionRevision: 1, boutId: 'bout-4', modalityId: 'synthetic-continuous-walking.v1', scheduledLocalDate: '2026-09-11', acceptedDurationSeconds: 600, authoredMaximumDurationSeconds: 1_200 },
  ], plannedWeeklyDurationSeconds: 1_200,
}

function dependencies(overrides: Partial<ConditioningProgressionDependencies> = {}): ConditioningProgressionDependencies {
  return {
    now: () => new Date('2026-09-08T00:00:00.000Z'),
    newId: () => '33333333-3333-4333-8333-333333333333',
    loadCandidate: vi.fn().mockResolvedValue(candidate),
    insertProposal: vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' }),
    acceptProposal: vi.fn(),
    ...overrides,
  }
}

describe('conditioning progression persistence', () => {
  it('persists exact revisions and trusted policy provenance for a synthetic proposal', async () => {
    const deps = dependencies()
    const result = await createStoredConditioningProgressionProposal({ sessionId: 'bout-2' }, actor, deps)
    expect(result.result).toMatchObject({ kind: 'proposal', proposalId: '33333333-3333-4333-8333-333333333333' })
    expect(deps.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      policy: SYNTHETIC_CONDITIONING_PROGRESSION_POLICY,
      sourceSessionRevisions: [
        { sessionId: 'bout-1', sessionRevision: 4, conditioningEventRevision: 1 },
        { sessionId: 'bout-2', sessionRevision: 4, conditioningEventRevision: 1 },
      ],
      mutableTargetRevisions: [
        expect.objectContaining({ sessionId: 'bout-3', sessionRevision: 1, acceptedDurationSeconds: 600 }),
        expect.objectContaining({ sessionId: 'bout-4', sessionRevision: 1, acceptedDurationSeconds: 600 }),
      ],
    }))
  })

  it('returns an explainable hold without persisting it', async () => {
    const deps = dependencies({ loadCandidate: vi.fn().mockResolvedValue({
      ...candidate, sourceBouts: [source('bout-1', '2026-09-01'), { ...source('bout-2', '2026-09-04'), actual: null }],
    }) })
    const result = await createStoredConditioningProgressionProposal({ sessionId: 'bout-2' }, actor, deps)
    expect(result.result).toMatchObject({ kind: 'not_proposed', decision: { reason: 'source_incomplete_hold' } })
    expect(deps.insertProposal).not.toHaveBeenCalled()
  })

  it.each(['insufficient_history', 'no_pending_targets'] as const)(
    'returns the normal %s read outcome without resolving policy or persisting',
    async (status) => {
      const resolvePolicy = vi.fn()
      const deps = dependencies({
        loadCandidate: vi.fn().mockResolvedValue({
          schemaVersion: 'conditioning-progression-candidate.v1', status,
        }),
        resolvePolicy,
      })
      await expect(createStoredConditioningProgressionProposal({ sessionId: 'bout-1' }, actor, deps))
        .resolves.toEqual({
          schemaVersion: 'conditioning-progression-projection.v1',
          result: { kind: status, proposalId: null },
        })
      expect(resolvePolicy).not.toHaveBeenCalled()
      expect(deps.insertProposal).not.toHaveBeenCalled()
    },
  )

  it('keeps malformed candidate metadata unavailable', async () => {
    const deps = dependencies({ loadCandidate: vi.fn().mockResolvedValue({
      schemaVersion: 'conditioning-progression-candidate.v1', status: 'ready', subjectId: 'subject-1',
    }) })
    await expect(createStoredConditioningProgressionProposal({ sessionId: 'bout-1' }, actor, deps))
      .rejects.toEqual(new ConditioningProgressionError('conditioning_progression_unavailable'))
  })

  it('does not infer a live numeric effort policy', async () => {
    const deps = dependencies({ loadCandidate: vi.fn().mockResolvedValue({ ...candidate, executionContext: { kind: 'live' } }) })
    await expect(createStoredConditioningProgressionProposal({ sessionId: 'bout-2' }, actor, deps))
      .rejects.toEqual(new ConditioningProgressionError('conditioning_progression_policy_unavailable'))
    expect(deps.insertProposal).not.toHaveBeenCalled()
  })

  it('fails closed when an athlete candidate belongs to another subject', async () => {
    const athlete = { ...actor, actorKind: 'athlete' as const, subjectId: 'other-subject' }
    await expect(createStoredConditioningProgressionProposal({ sessionId: 'bout-2' }, athlete, dependencies()))
      .rejects.toEqual(new ConditioningProgressionError('conditioning_progression_forbidden'))
  })

  it('accepts only the exact proposal and returns policy provenance from the database', async () => {
    const proposalId = '33333333-3333-4333-8333-333333333333'
    const requestId = '44444444-4444-4444-8444-444444444444'
    const deps = dependencies({ acceptProposal: vi.fn().mockResolvedValue({
      schemaVersion: 'conditioning-progression-acceptance.v1', proposalId, assignmentId: 'assignment-1',
      programRevisionNumber: 2, targetBoutIds: ['bout-3', 'bout-4'],
      policyVersion: SYNTHETIC_CONDITIONING_PROGRESSION_POLICY.policyVersion,
      policyOrigin: SYNTHETIC_CONDITIONING_PROGRESSION_POLICY.origin,
    }) })
    await expect(acceptStoredConditioningProgressionProposal(proposalId, { requestId }, deps))
      .resolves.toMatchObject({ proposalId, policyOrigin: { kind: 'synthetic_fixture' } })
    expect(deps.acceptProposal).toHaveBeenCalledWith(proposalId, requestId)
  })
})
