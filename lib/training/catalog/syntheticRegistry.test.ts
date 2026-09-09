import { describe, expect, it } from 'vitest'
import { SYNTHETIC_STARTER_CATALOG } from './syntheticStarter'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG } from './syntheticSwapJourney'
import { SYNTHETIC_CONDITIONING_JOURNEY_CATALOG } from './syntheticConditioningJourney'
import { TrainingCatalogV1Schema } from './types'
import {
  resolveSyntheticConditioningPairingPolicies,
  resolveSyntheticTrainingCatalog,
  resolveSyntheticTrainingCatalogByFixture,
} from './syntheticRegistry'

describe('synthetic training catalog registry', () => {
  it('resolves only exact catalog version and origin pairs', () => {
    expect(resolveSyntheticTrainingCatalog(
      SYNTHETIC_STARTER_CATALOG.catalogVersion,
      SYNTHETIC_STARTER_CATALOG.origin,
    )).toBe(SYNTHETIC_STARTER_CATALOG)
    expect(resolveSyntheticTrainingCatalog(
      SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
      SYNTHETIC_SWAP_JOURNEY_CATALOG.origin,
    )).toBe(SYNTHETIC_SWAP_JOURNEY_CATALOG)
    expect(resolveSyntheticTrainingCatalog(
      SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.catalogVersion,
      SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.origin,
    )).toBe(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG)
    expect(resolveSyntheticTrainingCatalog(
      SYNTHETIC_STARTER_CATALOG.catalogVersion,
      SYNTHETIC_SWAP_JOURNEY_CATALOG.origin,
    )).toBeNull()
  })

  it('returns fixture-bound pairing policies for an exact parsed catalog clone and rejects altered content', () => {
    const origin = SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.origin
    expect(origin.kind).toBe('synthetic_fixture')
    if (origin.kind !== 'synthetic_fixture') throw new Error('expected synthetic fixture')
    const context = {
      kind: 'synthetic_simulation' as const,
      simulationRunId: '11111111-1111-4111-8111-111111111111',
      fixtureId: origin.fixtureId,
      fixtureHash: origin.fixtureHash,
      label: 'Practice data' as const,
    }
    const policies = resolveSyntheticConditioningPairingPolicies(
      context,
      TrainingCatalogV1Schema.parse(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG),
    )
    expect(policies.map(policy => [policy.modalityId, policy.pairing])).toEqual([
      ['synthetic-continuous-walking.v1', 'off_day_only'],
      ['synthetic-stationary-cycling.v1', 'moderate_strength_first_allowed'],
    ])
    expect(policies.every(policy => policy.provenance.kind === 'synthetic_fixture'
      && policy.provenance.fixtureHash === context.fixtureHash)).toBe(true)
    expect(Object.isFrozen(policies)).toBe(true)
    expect(resolveSyntheticConditioningPairingPolicies(
      { ...context, fixtureHash: '0'.repeat(64) },
      SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
    )).toEqual([])
    expect(resolveSyntheticConditioningPairingPolicies(
      context,
      TrainingCatalogV1Schema.parse({
        ...SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
        conditioningModes: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.conditioningModes.map(mode => (
          mode.modalityId === 'synthetic-stationary-cycling.v1'
            ? { ...mode, label: 'Synthetic altered cycling label' }
            : mode
        )),
      }),
    )).toEqual([])
    expect(resolveSyntheticConditioningPairingPolicies(
      context,
      TrainingCatalogV1Schema.parse({
        ...SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
        catalogVersion: 'synthetic-conditioning-journey-catalog.v2',
      }),
    )).toEqual([])
  })

  it('fails closed for a mismatched fixture hash', () => {
    expect(resolveSyntheticTrainingCatalogByFixture(
      SYNTHETIC_SWAP_JOURNEY_CATALOG.origin.kind === 'synthetic_fixture'
        ? SYNTHETIC_SWAP_JOURNEY_CATALOG.origin.fixtureId
        : '',
      '0'.repeat(64),
    )).toBeNull()
  })
})
