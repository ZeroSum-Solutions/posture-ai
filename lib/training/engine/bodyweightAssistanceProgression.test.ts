import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import type {
  BodyweightAssistanceBenchmarkV1,
  BodyweightAssistanceProgressionPolicyV1,
} from '../contracts/bodyweight-assistance'
import {
  buildBodyweightAssistanceProgression,
  type BuildBodyweightAssistanceProgressionInput,
  type BodyweightAssistancePolicyRegistry,
} from './bodyweightAssistanceProgression'

const context = {
  kind: 'synthetic_simulation', simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'bodyweight-policy-fixture.v1', fixtureHash: 'a'.repeat(64), label: 'Practice data',
} as const

const bodyweightPolicy = {
  schemaVersion: 'bodyweight-assistance-progression-policy.v1',
  policyId: 'synthetic-bodyweight.v1', policyVersion: '1',
  loadBasis: 'bodyweight_external', progressionMode: 'rep_only_same_benchmark',
  provenance: {
    kind: 'synthetic_fixture', fixtureId: context.fixtureId,
    fixtureHash: context.fixtureHash, label: context.label,
  },
} as const satisfies BodyweightAssistanceProgressionPolicyV1

const assistancePolicy = {
  schemaVersion: 'bodyweight-assistance-progression-policy.v1',
  policyId: 'synthetic-assistance.v1', policyVersion: '1',
  loadBasis: 'machine_assistance', progressionMode: 'rep_only_same_benchmark',
  supportedAssistanceRange: {
    equipmentId: 'assisted-pullup-1',
    minimum: createLoadQuantity({ value: '10', unit: 'kg' }),
    maximum: createLoadQuantity({ value: '60', unit: 'kg' }),
  },
  provenance: bodyweightPolicy.provenance,
} as const satisfies BodyweightAssistanceProgressionPolicyV1

const policies = new Map<string, BodyweightAssistanceProgressionPolicyV1>([
  [`${bodyweightPolicy.policyId}:${bodyweightPolicy.policyVersion}`, bodyweightPolicy],
  [`${assistancePolicy.policyId}:${assistancePolicy.policyVersion}`, assistancePolicy],
])
const registry: BodyweightAssistancePolicyRegistry = {
  resolve: (reference, executionContext) => {
    if (executionContext.kind !== 'synthetic_simulation'
      || executionContext.fixtureId !== context.fixtureId
      || executionContext.fixtureHash !== context.fixtureHash) return null
    return policies.get(`${reference.policyId}:${reference.policyVersion}`) ?? null
  },
}

function bodyweightLoad(value = '0') {
  return {
    loadBasis: 'bodyweight_external', equipmentId: 'bodyweight',
    externalLoad: createLoadQuantity({ value, unit: 'kg' }),
  } as const
}

function assistanceLoad(value = '30', equipmentId = 'assisted-pullup-1') {
  return {
    loadBasis: 'machine_assistance', equipmentId,
    assistance: createLoadQuantity({ value, unit: 'kg' }),
  } as const
}

function benchmark(
  loadBasis: 'bodyweight_external' | 'machine_assistance' = 'bodyweight_external',
  overrides: Record<string, unknown> = {},
): BodyweightAssistanceBenchmarkV1 {
  const policy = loadBasis === 'bodyweight_external' ? bodyweightPolicy : assistancePolicy
  return {
    exerciseVersionId: loadBasis === 'bodyweight_external' ? 'pushup.v1' : 'assisted-pullup.v1',
    equipmentId: loadBasis === 'bodyweight_external' ? 'bodyweight' : 'assisted-pullup-1',
    loadBasis, side: 'bilateral', rom: 'catalog_default', tempo: 'catalog_default',
    exposureType: 'standard', workingSetCount: 3,
    repRange: { minimum: 6, maximum: 8 }, targetRir: { minimum: 2, maximum: 3 },
    policyId: policy.policyId, policyVersion: policy.policyVersion, ...overrides,
  }
}

function input(
  loadBasis: 'bodyweight_external' | 'machine_assistance' = 'bodyweight_external',
): BuildBodyweightAssistanceProgressionInput {
  const policy = loadBasis === 'bodyweight_external' ? bodyweightPolicy : assistancePolicy
  const load = loadBasis === 'bodyweight_external' ? bodyweightLoad() : assistanceLoad()
  const comparison = benchmark(loadBasis)
  return {
    executionContext: context,
    policyReference: { policyId: policy.policyId, policyVersion: policy.policyVersion },
    benchmark: comparison,
    currentTarget: { load, targetReps: [8, 7, 6] },
    latestExposure: {
      sourceExposureRevisionId: 'exposure-1', isComplete: true, benchmark: comparison,
      sets: [8, 7, 6].map((reps, index) => ({
        setOrdinal: index + 1, load, reps, rir: 2 as const, symptomState: 'none' as const,
      })),
    },
    registry,
  }
}

describe('buildBodyweightAssistanceProgression', () => {
  it('adds one rep at the earliest below-ceiling bodyweight set while preserving zero external load', () => {
    expect(buildBodyweightAssistanceProgression(input())).toMatchObject({
      kind: 'rep_proposal', status: 'proposed', reason: 'one_rep_progression',
      loadChange: 'none', targetReps: [8, 8, 6], preservedLoad: bodyweightLoad('0'),
    })
  })

  it('uses the same exact assistance and never proposes a percentage or inverted load change', () => {
    const result = buildBodyweightAssistanceProgression(input('machine_assistance'))
    expect(result).toMatchObject({
      kind: 'rep_proposal', loadChange: 'none', targetReps: [8, 8, 6],
      preservedLoad: assistanceLoad('30'),
    })
    expect(JSON.stringify(result)).not.toMatch(/percent|e1rm|tonnage|loadProposal/i)
  })

  it('returns review at the authored rep ceiling instead of changing external load or assistance', () => {
    const value = input()
    expect(buildBodyweightAssistanceProgression({
      ...value,
      latestExposure: {
        ...value.latestExposure,
        sets: value.latestExposure.sets.map(set => ({ ...set, reps: 8 })),
      },
    })).toMatchObject({
      kind: 'review', status: 'not_proposed', reason: 'benchmark_ceiling_review',
    })
  })

  it.each([
    ['load basis', { loadBasis: 'machine_assistance' }],
    ['equipment', { equipmentId: 'different-machine' }],
    ['ROM', { rom: 'partial' }],
    ['policy', { policyVersion: '2' }],
  ])('starts recalibration when %s changes', (_label, override) => {
    const value = input()
    expect(buildBodyweightAssistanceProgression({
      ...value,
      latestExposure: {
        ...value.latestExposure,
        benchmark: benchmark('bodyweight_external', override),
      },
    })).toMatchObject({
      kind: 'recalibrate', status: 'not_proposed', reason: 'benchmark_changed_recalibration',
    })
  })

  it('fails closed when the policy is not returned by the trusted registry', () => {
    const value = input()
    expect(buildBodyweightAssistanceProgression({
      ...value,
      policyReference: { ...value.policyReference, policyVersion: 'unregistered' },
    })).toMatchObject({
      kind: 'hold', status: 'not_proposed', reason: 'policy_unavailable_hold',
    })
  })

  it('recalibrates assistance outside the authored machine range', () => {
    const value = input('machine_assistance')
    const load = assistanceLoad('61')
    expect(buildBodyweightAssistanceProgression({
      ...value,
      currentTarget: { ...value.currentTarget, load },
      latestExposure: {
        ...value.latestExposure,
        sets: value.latestExposure.sets.map(set => ({ ...set, load })),
      },
    })).toMatchObject({
      kind: 'recalibrate', status: 'not_proposed', reason: 'assistance_range_recalibration',
    })
  })

  it('holds unknown effort and reviews an adverse symptom before performance', () => {
    const unknown = input()
    expect(buildBodyweightAssistanceProgression({
      ...unknown,
      latestExposure: {
        ...unknown.latestExposure,
        sets: unknown.latestExposure.sets.map((set, index) => (
          index === 0 ? { ...set, rir: 'unknown' as const } : set
        )),
      },
    })).toMatchObject({
      kind: 'hold', reason: 'effort_unknown_hold',
    })
    const adverse = input()
    expect(buildBodyweightAssistanceProgression({
      ...adverse,
      latestExposure: {
        ...adverse.latestExposure,
        sets: adverse.latestExposure.sets.map((set, index) => (
          index === 2 ? { ...set, symptomState: 'adverse_reported' as const } : set
        )),
      },
    })).toMatchObject({
      kind: 'review', reason: 'adverse_symptom_review',
    })
  })
})
