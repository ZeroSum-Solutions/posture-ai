import { createHash } from 'node:crypto'
import {
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_STARTER_PROGRESSION_DEFAULTS,
} from './syntheticStarter'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from './types'

export const SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID = 'synthetic-conditioning-journey-catalog.v1' as const

const exercises = SYNTHETIC_STARTER_CATALOG.exercises.map(exercise => ({
  ...exercise,
  progressionDefaults: SYNTHETIC_STARTER_PROGRESSION_DEFAULTS[
    exercise.exerciseVersionId as keyof typeof SYNTHETIC_STARTER_PROGRESSION_DEFAULTS
  ],
}))

const conditioningModes = [
  ...SYNTHETIC_STARTER_CATALOG.conditioningModes.map(mode => ({ ...mode })),
  {
    modalityId: 'synthetic-stationary-cycling.v1',
    label: 'Synthetic stationary cycling',
    preferenceRank: 1,
    lifecycle: 'active',
    contentReviewStatus: 'reviewed_fixture',
    effortCue: 'Use a steady practice pace where speaking in full sentences remains comfortable.',
  },
] as const

export const SYNTHETIC_CONDITIONING_JOURNEY_PAIRING = Object.freeze({
  'synthetic-continuous-walking.v1': 'off_day_only',
  'synthetic-stationary-cycling.v1': 'moderate_strength_first_allowed',
} as const)

export const SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH = createHash('sha256')
  .update(JSON.stringify({ exercises, conditioningModes, pairing: SYNTHETIC_CONDITIONING_JOURNEY_PAIRING }))
  .digest('hex')

export const SYNTHETIC_CONDITIONING_JOURNEY_CATALOG: TrainingCatalogV1 = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1',
  catalogVersion: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
  origin: {
    kind: 'synthetic_fixture',
    source: 'server_fixture',
    fixtureId: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
    fixtureHash: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
    label: 'Synthetic conditioning revision journey catalog',
  },
  exercises,
  conditioningModes,
})

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

deepFreeze(SYNTHETIC_CONDITIONING_JOURNEY_CATALOG)
