import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  CreateProgressionProposalInputV1Schema,
  ProgressionNoChangeDecisionV1Schema,
  ProgressionProposalDecisionV1Schema,
  ProgressionProposalV1Schema,
  TrainingProgressionAcceptanceV1Schema,
  TrainingProgressionProjectionV1Schema,
} from './progression'

describe('progression persistence contracts', () => {
  it('accepts only server-decision and identifier shaped payloads', () => {
    expect(CreateProgressionProposalInputV1Schema.parse({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }))
      .toEqual({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' })
    expect(() => CreateProgressionProposalInputV1Schema.parse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1', decision: {},
    })).toThrow()
  })

  it('accepts an optional recovery submission without changing the legacy input', () => {
    const report = {
      schemaVersion: 'recovery-context.v1', capturedAt: '2026-09-09T18:00:00.000Z',
      sleep: 'unknown', fatigue: 'concern_reported', schedule: 'unknown', illness: 'unknown',
    }
    expect(CreateProgressionProposalInputV1Schema.parse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
      recoveryContext: {
        requestId: '11111111-1111-4111-8111-111111111111',
        context: { report, choice: 'request_review' },
      },
    })).toMatchObject({ recoveryContext: { context: { choice: 'request_review' } } })
    expect(() => CreateProgressionProposalInputV1Schema.parse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
      recoveryContext: { requestId: 'bad', context: { report, choice: 'automatic_deload' } },
    })).toThrow()
  })

  it('validates a bounded recovery review projection without a progression proposal', () => {
    const report = {
      schemaVersion: 'recovery-context.v1', capturedAt: '2026-09-09T18:00:00.000Z',
      sleep: 'unknown', fatigue: 'concern_reported', schedule: 'unknown', illness: 'unknown',
    }
    const projection = {
      schemaVersion: 'training-progression-projection.v1',
      result: {
        kind: 'recovery_review', proposalId: null,
        requestBinding: {
          sessionId: 'session-3', exerciseInstanceId: 'exercise-3',
        },
        record: {
          schemaVersion: 'training-recovery-context-record.v1',
          recordId: '11111111-1111-4111-8111-111111111111',
          subjectId: 'subject-1', assignmentId: 'assignment-1',
          sourceProgramRevisionNumber: 3, sourceProgramHash: 'a'.repeat(64),
          sourceSessionId: 'session-2', sourceSessionRevision: 4,
          exerciseInstanceId: 'exercise-2', progressionSeriesId: 'series-push',
          executionContext: { kind: 'live' }, context: { report, choice: 'hold' },
          recordedAt: '2026-09-09T18:01:00.000Z',
        },
        review: { kind: 'hold', reason: 'explicit_recovery_hold', report },
      },
    }
    expect(TrainingProgressionProjectionV1Schema.parse(projection)).toEqual(projection)
    for (const context of [{ report }, { report, choice: 'request_review' }]) {
      expect(TrainingProgressionProjectionV1Schema.safeParse({
        ...projection,
        result: { ...projection.result, record: { ...projection.result.record, context } },
      }).success).toBe(false)
    }
    expect(TrainingProgressionProjectionV1Schema.safeParse({
      ...projection,
      result: {
        ...projection.result,
        review: { ...projection.result.review, report: { ...report, fatigue: 'no_concern_reported' } },
      },
    }).success).toBe(false)
    expect(() => TrainingProgressionProjectionV1Schema.parse({
      ...projection,
      result: { ...projection.result, proposalId: '11111111-1111-4111-8111-111111111111' },
    })).toThrow()
    expect(() => TrainingProgressionProjectionV1Schema.parse({
      ...projection,
      result: { ...projection.result, requestBinding: { sessionId: 'session-3' } },
    })).toThrow()
  })

  it('validates exact proposed loads and bounded target reps', () => {
    const decision = {
      kind: 'load_proposal', status: 'proposed', policyVersion: 'strength-progression-v1',
      executionContext: { kind: 'live' }, decisionKey: `strength-progression-v1:sha256:${'a'.repeat(64)}`,
      subjectId: 'subject-1', prescriptionId: 'session-1:exercise-1', exerciseVersionId: 'press.v1',
      equipmentId: 'machine-1', loadBasis: 'machine_stack', programRevisionId: 'program-1',
      sourceProfileRevisionId: '1', sourceEligibilityRevisionId: 'eligibility-1', loadEpoch: 1,
      reasonCodes: ['two_ceiling_successes'], sourceExposureRevisionIds: ['exposure-1', 'exposure-2'],
      sourceAcknowledgementRevisionIds: [], proposal: {
        load: { equipmentId: 'machine-1', basis: 'machine_stack', quantity: createLoadQuantity({ value: '52', unit: 'kg' }) },
        targetReps: [6, 6],
      },
    } as const
    expect(ProgressionProposalV1Schema.parse(decision)).toEqual(decision)
    expect(() => ProgressionProposalV1Schema.parse({
      ...decision, proposal: { ...decision.proposal, targetReps: [6.5] },
    })).toThrow()
  })

  it('validates dedicated bodyweight and assistance decisions without granting load authority', () => {
    const bodyweightProposal = {
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      kind: 'rep_proposal', status: 'proposed', reason: 'one_rep_progression',
      loadChange: 'none',
      preservedLoad: {
        loadBasis: 'bodyweight_external', equipmentId: 'bodyweight-station',
        externalLoad: createLoadQuantity({ value: '0', unit: 'kg' }),
      },
      targetReps: [8, 7], policyId: 'bodyweight-rep-only.v1', policyVersion: '1',
      sourceExposureRevisionId: 'session-evidence:abc',
    } as const
    expect(ProgressionProposalDecisionV1Schema.parse(bodyweightProposal)).toEqual(bodyweightProposal)
    expect(TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: {
        kind: 'proposal', proposalId: '11111111-1111-4111-8111-111111111111',
        executionContext: {
          kind: 'synthetic_simulation',
          simulationRunId: '22222222-2222-4222-8222-222222222222',
          fixtureId: 'bodyweight-fixture.v1', fixtureHash: 'b'.repeat(64), label: 'Practice data',
        },
        target: {
          assignmentId: 'assignment-1', baseProgramRevisionNumber: 1,
          sessionId: 'session-3', exerciseInstanceId: 'exercise-3',
          scheduledLocalDate: '2026-09-10',
        },
        decision: bodyweightProposal,
      },
    })).toMatchObject({
      result: {
        executionContext: { kind: 'synthetic_simulation', label: 'Practice data' },
        decision: { loadChange: 'none' },
      },
    })
    expect(() => TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: {
        kind: 'proposal', proposalId: '11111111-1111-4111-8111-111111111111',
        target: {
          assignmentId: 'assignment-1', baseProgramRevisionNumber: 1,
          sessionId: 'session-3', exerciseInstanceId: 'exercise-3',
          scheduledLocalDate: '2026-09-10',
        },
        decision: bodyweightProposal,
      },
    })).toThrow('Dedicated progression decisions require explicit execution context')
    expect(() => ProgressionProposalDecisionV1Schema.parse({
      ...bodyweightProposal, loadChange: 'increase',
    })).toThrow()

    const assistanceHold = {
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      kind: 'recalibrate', status: 'not_proposed', reason: 'assistance_range_recalibration',
      policyId: 'assistance-rep-only.v1', policyVersion: '1',
      sourceExposureRevisionId: 'session-evidence:def',
    } as const
    expect(ProgressionNoChangeDecisionV1Schema.parse(assistanceHold)).toEqual(assistanceHold)
    expect(() => ProgressionProposalDecisionV1Schema.parse(assistanceHold)).toThrow()
  })

  it('keeps acceptance acknowledgement free of prescription authority', () => {
    const value = {
      schemaVersion: 'training-progression-acceptance.v1',
      proposalId: '11111111-1111-4111-8111-111111111111', assignmentId: 'assignment-1',
      programRevisionNumber: 2, targetSessionId: 'session-3', targetExerciseInstanceId: 'exercise-3',
    } as const
    expect(TrainingProgressionAcceptanceV1Schema.parse(value)).toEqual(value)
    expect(() => TrainingProgressionAcceptanceV1Schema.parse({ ...value, program: {} })).toThrow()
  })
})
