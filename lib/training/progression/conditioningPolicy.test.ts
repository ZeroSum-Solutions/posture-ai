import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC_CONDITIONING_PROGRESSION_POLICY,
  SYNTHETIC_CONDITIONING_PROGRESSION_POLICY_FIXTURE_HASH,
  resolveConditioningProgressionPolicy,
} from './conditioningPolicy'
import { SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'

const simulation = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-starter-catalog.v1', fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  label: 'Practice data' as const,
}

describe('conditioning progression policy registry', () => {
  it('resolves the labeled synthetic walking policy with content provenance', () => {
    const policy = resolveConditioningProgressionPolicy('synthetic-continuous-walking.v1', simulation)
    expect(policy).toEqual(SYNTHETIC_CONDITIONING_PROGRESSION_POLICY)
    expect(policy?.origin).toMatchObject({
      kind: 'synthetic_fixture', fixtureHash: SYNTHETIC_CONDITIONING_PROGRESSION_POLICY_FIXTURE_HASH,
    })
  })

  it('does not infer a live policy or apply the fixture policy to another modality', () => {
    expect(resolveConditioningProgressionPolicy('synthetic-continuous-walking.v1', { kind: 'live' })).toBeNull()
    expect(resolveConditioningProgressionPolicy('rowing.v1', simulation)).toBeNull()
    expect(resolveConditioningProgressionPolicy('synthetic-continuous-walking.v1', {
      ...simulation, fixtureHash: 'a'.repeat(64),
    })).toBeNull()
  })
})
