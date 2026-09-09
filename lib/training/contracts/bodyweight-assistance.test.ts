import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  BodyweightAssistanceBenchmarkV1Schema,
  BodyweightAssistanceLoadV1Schema,
  BodyweightAssistanceProgressionDecisionV1Schema,
  BodyweightAssistanceProgressionPolicyV1Schema,
} from './bodyweight-assistance'

const syntheticProvenance = {
  kind: 'synthetic_fixture', fixtureId: 'bodyweight-policy-fixture.v1',
  fixtureHash: 'a'.repeat(64), label: 'Practice data',
} as const

describe('bodyweight and assistance contracts', () => {
  it('preserves zero as an exact external bodyweight load', () => {
    const load = {
      loadBasis: 'bodyweight_external', equipmentId: 'bodyweight',
      externalLoad: createLoadQuantity({ value: '0', unit: 'kg' }),
    }
    expect(BodyweightAssistanceLoadV1Schema.parse(load)).toEqual(load)
  })

  it('rejects negative assistance instead of encoding it as a negative external load', () => {
    expect(BodyweightAssistanceLoadV1Schema.safeParse({
      loadBasis: 'machine_assistance', equipmentId: 'assisted-pullup-1',
      assistance: { entered: { value: '-5', unit: 'kg' }, canonicalKg: '-5' },
    }).success).toBe(false)
  })

  it('binds assistance policy to one machine range and rejects inverted bounds', () => {
    const policy = {
      schemaVersion: 'bodyweight-assistance-progression-policy.v1',
      policyId: 'synthetic-assisted-pullup.v1', policyVersion: '1',
      loadBasis: 'machine_assistance', progressionMode: 'rep_only_same_benchmark',
      supportedAssistanceRange: {
        equipmentId: 'assisted-pullup-1',
        minimum: createLoadQuantity({ value: '10', unit: 'kg' }),
        maximum: createLoadQuantity({ value: '60', unit: 'kg' }),
      },
      provenance: syntheticProvenance,
    } as const
    expect(BodyweightAssistanceProgressionPolicyV1Schema.parse(policy)).toEqual(policy)
    expect(BodyweightAssistanceProgressionPolicyV1Schema.safeParse({
      ...policy,
      supportedAssistanceRange: {
        ...policy.supportedAssistanceRange,
        minimum: createLoadQuantity({ value: '61', unit: 'kg' }),
      },
    }).success).toBe(false)
  })

  it('keeps policy identity inside the exact comparison benchmark', () => {
    const benchmark = {
      exerciseVersionId: 'assisted-pullup.v1', equipmentId: 'assisted-pullup-1',
      loadBasis: 'machine_assistance', side: 'bilateral', rom: 'catalog_default',
      tempo: 'catalog_default', exposureType: 'standard', workingSetCount: 3,
      repRange: { minimum: 6, maximum: 8 }, targetRir: { minimum: 2, maximum: 3 },
      policyId: 'synthetic-assisted-pullup.v1', policyVersion: '1',
    }
    expect(BodyweightAssistanceBenchmarkV1Schema.parse(benchmark)).toEqual(benchmark)
    expect(BodyweightAssistanceBenchmarkV1Schema.safeParse({
      ...benchmark, loadBasis: 'machine_stack',
    }).success).toBe(false)
  })

  it('allows only a same-load rep proposal in this policy family', () => {
    const proposal = {
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      kind: 'rep_proposal', status: 'proposed', policyId: 'policy-1', policyVersion: '1',
      reason: 'one_rep_progression', sourceExposureRevisionId: 'exposure-1',
      loadChange: 'none',
      preservedLoad: {
        loadBasis: 'bodyweight_external', equipmentId: 'bodyweight',
        externalLoad: createLoadQuantity({ value: '0', unit: 'kg' }),
      },
      targetReps: [8, 8, 6],
    } as const
    expect(BodyweightAssistanceProgressionDecisionV1Schema.safeParse(proposal).success).toBe(true)
    expect(BodyweightAssistanceProgressionDecisionV1Schema.safeParse({
      ...proposal, preservedLoad: undefined,
    }).success).toBe(false)
    expect(BodyweightAssistanceProgressionDecisionV1Schema.safeParse({
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      kind: 'load_proposal', status: 'proposed', policyId: 'policy-1', policyVersion: '1',
      reason: 'one_rep_progression', sourceExposureRevisionId: 'exposure-1',
      targetReps: [8, 8, 6], percentIncrease: 5,
    }).success).toBe(false)
  })
})
