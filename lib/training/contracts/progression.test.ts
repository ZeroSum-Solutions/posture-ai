import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  CreateProgressionProposalInputV1Schema,
  ProgressionProposalV1Schema,
  TrainingProgressionAcceptanceV1Schema,
} from './progression'

describe('progression persistence contracts', () => {
  it('accepts only server-decision and identifier shaped payloads', () => {
    expect(CreateProgressionProposalInputV1Schema.parse({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }))
      .toEqual({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' })
    expect(() => CreateProgressionProposalInputV1Schema.parse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1', decision: {},
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
