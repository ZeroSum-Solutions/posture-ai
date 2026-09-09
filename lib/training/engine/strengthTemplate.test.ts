import { describe, expect, it } from 'vitest'
import {
  createSyntheticIntermediateUndulatingTemplate,
  IntermediateUndulatingTemplateV1Schema,
  resolveIntermediateUndulatingTemplate,
  strengthTemplateMatchesExecutionContext,
  type StrengthTemplateRegistryV1,
} from './strengthTemplate'

const simulationContext = {
  kind: 'synthetic_simulation',
  simulationRunId: '33333333-3333-4333-8333-333333333333',
  fixtureId: 'compiler-fixture',
  fixtureHash: 'a'.repeat(64),
  label: 'Practice data',
} as const

function template(provenance: unknown = {
  kind: 'synthetic_fixture', fixtureId: 'compiler-fixture',
  fixtureHash: 'a'.repeat(64), label: 'Practice data',
}) {
  return {
    schemaVersion: 'strength-template.v1',
    style: 'intermediate_undulating',
    templateId: 'intermediate-undulating',
    templateVersion: 'intermediate-undulating.v1',
    provenance,
    heavy: {
      exposureType: 'heavy', repRange: { minimum: 6, maximum: 8 },
      targetRir: { minimum: 2, maximum: 3 }, restSeconds: 180,
    },
    volume: {
      exposureType: 'volume', repRange: { minimum: 10, maximum: 12 },
      targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
    },
  }
}

function registry(value: unknown): StrengthTemplateRegistryV1 {
  return { resolve: () => value }
}

describe('intermediate undulating template boundary', () => {
  it('authors distinct synthetic heavy and volume checkpoint prescriptions', () => {
    expect(createSyntheticIntermediateUndulatingTemplate(simulationContext)).toMatchObject({
      heavy: { exposureType: 'heavy', repRange: { minimum: 6, maximum: 8 }, restSeconds: 180 },
      volume: { exposureType: 'volume', repRange: { minimum: 10, maximum: 12 }, restSeconds: 120 },
    })
  })

  it('accepts an exact simulation-bound template resolved by the server registry', () => {
    expect(resolveIntermediateUndulatingTemplate(simulationContext, registry(template())))
      .toMatchObject({ templateVersion: 'intermediate-undulating.v1' })
  })

  it('fails closed on absent, malformed, or mismatched simulation provenance', () => {
    expect(resolveIntermediateUndulatingTemplate(simulationContext, undefined)).toBeNull()
    expect(resolveIntermediateUndulatingTemplate(simulationContext, registry({}))).toBeNull()
    expect(resolveIntermediateUndulatingTemplate(simulationContext, registry(template({
      kind: 'synthetic_fixture', fixtureId: 'other-fixture',
      fixtureHash: 'a'.repeat(64), label: 'Practice data',
    })))).toBeNull()
  })

  it('requires reviewed authored provenance for live compilation', () => {
    expect(resolveIntermediateUndulatingTemplate({ kind: 'live' }, registry(template()))).toBeNull()
    expect(resolveIntermediateUndulatingTemplate({ kind: 'live' }, registry(template({
      kind: 'reviewed_authored_template',
      templateRecordId: 'template-record-1', reviewRecordId: 'review-record-1',
      reviewedAt: '2026-09-08T00:00:00Z',
    })))).toMatchObject({ provenance: { kind: 'reviewed_authored_template' } })
  })

  it('matches immutable template provenance to exact simulation fixture fields', () => {
    const parsed = IntermediateUndulatingTemplateV1Schema.parse(template())
    expect(strengthTemplateMatchesExecutionContext(parsed, simulationContext)).toBe(true)
    expect(strengthTemplateMatchesExecutionContext(parsed, {
      ...simulationContext,
      simulationRunId: '44444444-4444-4444-8444-444444444444',
    })).toBe(true)
    expect(strengthTemplateMatchesExecutionContext(parsed, {
      ...simulationContext,
      fixtureHash: 'b'.repeat(64),
    })).toBe(false)
  })

  it('rejects overlapping heavy and volume rep prescriptions', () => {
    expect(() => IntermediateUndulatingTemplateV1Schema.parse({
      ...template(),
      heavy: { ...template().heavy, repRange: { minimum: 6, maximum: 10 } },
      volume: { ...template().volume, repRange: { minimum: 10, maximum: 12 } },
    })).toThrow()
  })
})
