import { describe, expect, it } from 'vitest'
import {
  AcceptExerciseSwapProposalInputV1Schema,
  ExerciseSwapProposalProjectionV1Schema,
} from './exercise-swap'

const loadOption = {
  optionIndex: 0, equipmentId: 'db-home', loadBasis: 'dumbbell_per_hand',
  implementCount: 2, holdingConfiguration: 'one_per_hand',
  quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' },
} as const
const proposal = {
  schemaVersion: 'training-exercise-swap-proposal.v1',
  proposalId: '11111111-1111-4111-8111-111111111111', assignmentId: 'assignment-1',
  baseProgramRevisionNumber: 1,
  sourceExercise: { exerciseVersionId: 'synthetic-row-a.v1', label: 'Synthetic row A' },
  replacementExercise: {
    exerciseVersionId: 'synthetic-row-b.v1', label: 'Synthetic row B',
    trainingIntentId: 'synthetic-horizontal-pull', recalibrationRequired: true,
    differences: [{ kind: 'body_position', description: 'The replacement uses a supported torso position.' }],
  },
  loadOptions: [loadOption],
  affectedFutureSessions: [{
    sessionId: 'session-2', exerciseInstanceId: 'exercise-2', scheduledLocalDate: '2026-09-10',
  }],
  catalogVersion: 'synthetic-swap-catalog.v1',
  catalogOrigin: {
    kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'synthetic-swap-catalog.v1',
    fixtureHash: 'a'.repeat(64), label: 'Synthetic swap catalog fixture',
  },
} as const

describe('exercise swap contracts', () => {
  it('preserves explicit differences, future targets, and immutable load choices', () => {
    expect(ExerciseSwapProposalProjectionV1Schema.parse({
      schemaVersion: 'training-exercise-swap-projection.v1',
      result: { kind: 'proposals', proposals: [proposal] },
    }).result).toMatchObject({ kind: 'proposals', proposals: [{ loadOptions: [loadOption] }] })
  })

  it('rejects noncontiguous load indexes and arbitrary acceptance fields', () => {
    expect(ExerciseSwapProposalProjectionV1Schema.safeParse({
      schemaVersion: 'training-exercise-swap-projection.v1',
      result: { kind: 'proposals', proposals: [{
        ...proposal, loadOptions: [{ ...loadOption, optionIndex: 1 }],
      }] },
    }).success).toBe(false)
    expect(AcceptExerciseSwapProposalInputV1Schema.safeParse({
      requestId: '22222222-2222-4222-8222-222222222222', selectedLoadOptionIndex: 0,
      exerciseVersionId: 'arbitrary.v1', quantity: loadOption.quantity,
    }).success).toBe(false)
  })

  it('binds dedicated bodyweight and assistance choices to an exact policy reference', () => {
    const policy = { policyId: 'reviewed-rep-only.v1', policyVersion: '1' }
    for (const option of [{
      ...loadOption, loadBasis: 'bodyweight_external', implementCount: 0,
      holdingConfiguration: 'bodyweight_plus_external_load', bodyweightAssistancePolicy: policy,
    }, {
      ...loadOption, loadBasis: 'machine_assistance', implementCount: 1,
      holdingConfiguration: 'machine_assistance', bodyweightAssistancePolicy: policy,
    }] as const) {
      expect(ExerciseSwapProposalProjectionV1Schema.safeParse({
        schemaVersion: 'training-exercise-swap-projection.v1',
        result: { kind: 'proposals', proposals: [{ ...proposal, loadOptions: [option] }] },
      }).success).toBe(true)
      const { bodyweightAssistancePolicy: _policy, ...missingPolicy } = option
      expect(_policy).toEqual(policy)
      expect(ExerciseSwapProposalProjectionV1Schema.safeParse({
        schemaVersion: 'training-exercise-swap-projection.v1',
        result: { kind: 'proposals', proposals: [{ ...proposal, loadOptions: [missingPolicy] }] },
      }).success).toBe(false)
    }
    expect(ExerciseSwapProposalProjectionV1Schema.safeParse({
      schemaVersion: 'training-exercise-swap-projection.v1',
      result: { kind: 'proposals', proposals: [{
        ...proposal, loadOptions: [{ ...loadOption, bodyweightAssistancePolicy: policy }],
      }] },
    }).success).toBe(false)
  })
})
