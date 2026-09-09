import { describe, expect, it } from 'vitest'
import { TrainingCatalogV1Schema } from './types'
import {
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
  SYNTHETIC_CONDITIONING_JOURNEY_PAIRING,
} from './syntheticConditioningJourney'
import { SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from './syntheticStarter'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH } from './syntheticSwapJourney'

describe('synthetic conditioning revision journey catalog', () => {
  it('preserves established fixture identities and binds a distinct valid catalog', () => {
    expect(SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH).toBe(
      'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
    )
    expect(SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH).toBe(
      '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
    )
    expect(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH).toBe(
      'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e',
    )
    expect(TrainingCatalogV1Schema.parse(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG))
      .toEqual(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG)
    expect(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.origin).toMatchObject({
      kind: 'synthetic_fixture', fixtureId: 'synthetic-conditioning-journey-catalog.v1',
      fixtureHash: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
    })
  })

  it('offers exactly walking and stationary cycling with fixture-only cues and pairing', () => {
    expect(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.conditioningModes).toEqual([
      expect.objectContaining({ modalityId: 'synthetic-continuous-walking.v1', contentReviewStatus: 'reviewed_fixture' }),
      expect.objectContaining({ modalityId: 'synthetic-stationary-cycling.v1', contentReviewStatus: 'reviewed_fixture' }),
    ])
    expect(SYNTHETIC_CONDITIONING_JOURNEY_PAIRING).toEqual({
      'synthetic-continuous-walking.v1': 'off_day_only',
      'synthetic-stationary-cycling.v1': 'moderate_strength_first_allowed',
    })
    expect(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.conditioningModes.every(mode => (
      mode.label.includes('Synthetic') && mode.effortCue.length > 0
    ))).toBe(true)
  })

  it('freezes the catalog and nested fixture policy data', () => {
    expect(Object.isFrozen(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG)).toBe(true)
    expect(Object.isFrozen(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.conditioningModes)).toBe(true)
    expect(Object.isFrozen(SYNTHETIC_CONDITIONING_JOURNEY_PAIRING)).toBe(true)
  })
})
