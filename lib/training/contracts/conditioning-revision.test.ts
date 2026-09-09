import { describe, expect, it } from 'vitest'
import {
  ConditioningPairingPolicyV1Schema,
  ConditioningRevisionAcceptanceV1Schema,
  ConditioningRevisionProposalProjectionV1Schema,
  ConditioningRevisionResultV1Schema,
  ConditioningRevisionSelectionV1Schema,
  ConditioningRevisionSessionStateV1Schema,
  ConditioningRevisionSourceV1Schema,
} from './conditioning-revision'

const context = {
  kind: 'synthetic_simulation',
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-starter-catalog.v1', fixtureHash: 'a'.repeat(64),
  label: 'Practice data',
} as const

describe('conditioning revision contracts', () => {
  it('accepts explicit per-bout dates, durations, and arrangements without browser authority fields', () => {
    const selection = {
      replacementModalityId: 'cycle.v1',
      futureBouts: [{
        sourceBoutId: 'bout-1', scheduledLocalDate: '2026-09-09',
        acceptedDurationSeconds: 600, arrangement: 'separate',
      }],
    }
    expect(ConditioningRevisionSelectionV1Schema.parse(selection)).toEqual(selection)
    expect(ConditioningRevisionSelectionV1Schema.safeParse({
      ...selection,
      catalogVersion: 'browser-claim',
    }).success).toBe(false)
  })

  it('rejects duplicate source bouts, fractional duration, and invalid calendar dates', () => {
    const bout = {
      sourceBoutId: 'bout-1', scheduledLocalDate: '2026-09-09',
      acceptedDurationSeconds: 600, arrangement: 'separate',
    } as const
    expect(ConditioningRevisionSelectionV1Schema.safeParse({
      replacementModalityId: 'cycle.v1', futureBouts: [bout, bout],
    }).success).toBe(false)
    expect(ConditioningRevisionSelectionV1Schema.safeParse({
      replacementModalityId: 'cycle.v1', futureBouts: [{ ...bout, acceptedDurationSeconds: 600.5 }],
    }).success).toBe(false)
    expect(ConditioningRevisionSelectionV1Schema.safeParse({
      replacementModalityId: 'cycle.v1', futureBouts: [{ ...bout, scheduledLocalDate: '2026-02-30' }],
    }).success).toBe(false)
  })

  it('requires the server-derived prescription state for every session', () => {
    expect(ConditioningRevisionSessionStateV1Schema.parse({
      sessionId: 'bout-1', state: 'scheduled', hasPrescription: true,
    })).toEqual({ sessionId: 'bout-1', state: 'scheduled', hasPrescription: true })
    expect(ConditioningRevisionSessionStateV1Schema.safeParse({
      sessionId: 'bout-1', state: 'scheduled',
    }).success).toBe(false)
  })

  it('keeps source authority and paired policy provenance explicit and closed', () => {
    expect(ConditioningRevisionSourceV1Schema.safeParse({
      schemaVersion: 'conditioning-revision-source.v1', assignmentId: 'assignment-1',
      subjectId: 'subject-1', baseProgramRevisionNumber: 1,
      compiledProgramRevisionId: 'compiled-program-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
      executionContext: context,
      catalogVersion: 'synthetic-starter-catalog.v1', athleteTimezone: 'UTC',
      strengthSessions: [], conditioningBouts: [],
    }).success).toBe(false)
    expect(ConditioningPairingPolicyV1Schema.parse({
      schemaVersion: 'conditioning-pairing-policy.v1',
      modalityId: 'cycle.v1', catalogVersion: 'catalog.v1',
      pairing: 'moderate_strength_first_allowed',
      provenance: {
        kind: 'synthetic_fixture', fixtureId: context.fixtureId,
        fixtureHash: context.fixtureHash, label: context.label,
      },
    }).pairing).toBe('moderate_strength_first_allowed')
  })

  it('requires an explicit acceptance state for ready revisions', () => {
    expect(ConditioningRevisionResultV1Schema.safeParse({
      schemaVersion: 'conditioning-revision.v1',
      result: {
        kind: 'revision_ready', assignmentId: 'assignment-1', subjectId: 'subject-1',
        baseProgramRevisionNumber: 1, executionContext: context,
        preservedBoutIds: [], replacements: [], frequencyChange: 'unchanged',
        intensityChange: 'not_automated', strengthPriority: 'strength_first_when_paired',
      },
    }).success).toBe(false)
  })

  it('binds only ready revisions to proposals and validates immutable acceptance receipts', () => {
    const unavailable = {
      schemaVersion: 'conditioning-revision.v1',
      result: { kind: 'unavailable', reason: 'no_changeable_bouts' },
    } as const
    expect(ConditioningRevisionProposalProjectionV1Schema.parse({
      schemaVersion: 'conditioning-revision-projection.v1', proposalId: null, revision: unavailable,
    }).proposalId).toBeNull()
    expect(ConditioningRevisionProposalProjectionV1Schema.safeParse({
      schemaVersion: 'conditioning-revision-projection.v1',
      proposalId: '22222222-2222-4222-8222-222222222222', revision: unavailable,
    }).success).toBe(false)
    expect(ConditioningRevisionAcceptanceV1Schema.parse({
      schemaVersion: 'conditioning-revision-acceptance.v1',
      proposalId: '22222222-2222-4222-8222-222222222222', assignmentId: 'assignment-1',
      programRevisionNumber: 4, affectedBoutIds: ['bout-1'], evidenceBoundary: 'reset',
    }).programRevisionNumber).toBe(4)
  })
})
