import { describe, expect, it } from 'vitest'
import { resolveExerciseSwapAlternatives } from './exerciseSwaps'
import {
  SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
} from './syntheticStarter'
import {
  SYNTHETIC_SWAP_JOURNEY_CATALOG,
  SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
} from './syntheticSwapJourney'
import { TrainingCatalogV1Schema } from './types'
import { PRACTICE_SIMULATION_FIXTURE } from '../simulation/fixture'

describe('synthetic exercise swap journey catalog', () => {
  it('preserves the frozen starter hash and binds a distinct contract-valid fixture', () => {
    expect(SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH).toBe(
      'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
    )
    expect(SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH).toBe(
      '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
    )
    expect(TrainingCatalogV1Schema.safeParse(SYNTHETIC_SWAP_JOURNEY_CATALOG).success).toBe(true)
    expect(SYNTHETIC_SWAP_JOURNEY_CATALOG.origin).toMatchObject({
      kind: 'synthetic_fixture',
      fixtureId: 'synthetic-swap-journey-catalog.v1',
      fixtureHash: SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
    })
  })

  it('offers one explicitly authored recalibration alternative with exact profile loads', () => {
    const alternatives = resolveExerciseSwapAlternatives({
      catalog: SYNTHETIC_SWAP_JOURNEY_CATALOG,
      profile: PRACTICE_SIMULATION_FIXTURE.profile,
      sourceExerciseVersionId: 'synthetic-two-dumbbell-floor-press.v1',
    })

    expect(alternatives).toHaveLength(1)
    expect(alternatives[0]).toMatchObject({
      trainingIntentId: 'synthetic-horizontal-push',
      exercise: {
        exerciseVersionId: 'synthetic-neutral-grip-two-dumbbell-floor-press.v1',
        preferenceRank: 1,
        contentReviewStatus: 'reviewed_fixture',
        mediaStatus: 'missing',
      },
    })
    expect(alternatives[0].loadOptions.map(option => option.quantity.entered)).toEqual([
      { value: '2', unit: 'kg' },
      { value: '4', unit: 'kg' },
      { value: '6', unit: 'kg' },
      { value: '8', unit: 'kg' },
      { value: '10', unit: 'kg' },
      { value: '12', unit: 'kg' },
    ])
  })
})
