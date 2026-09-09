import { createHash } from 'node:crypto'
import {
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_STARTER_PROGRESSION_DEFAULTS,
} from './syntheticStarter'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from './types'

export const SYNTHETIC_SWAP_JOURNEY_FIXTURE_ID = 'synthetic-swap-journey-catalog.v1' as const

const SOURCE_PRESS_VERSION = 'synthetic-two-dumbbell-floor-press.v1' as const
const NEUTRAL_PRESS_VERSION = 'synthetic-neutral-grip-two-dumbbell-floor-press.v1' as const
const TRAINING_INTENT_ID = 'synthetic-horizontal-push' as const

const sourceDifferences = [
  {
    kind: 'execution',
    description: 'Uses a neutral grip with the palms facing each other.',
  },
  {
    kind: 'body_position',
    description: 'Keeps the upper arms closer to the torso than the standard fixture press.',
  },
] as const

const returnDifferences = [
  {
    kind: 'execution',
    description: 'Uses the standard fixture grip instead of palms facing each other.',
  },
  {
    kind: 'body_position',
    description: 'Allows the upper arms to move farther from the torso than the neutral-grip fixture press.',
  },
] as const

const exercises = [
  ...SYNTHETIC_STARTER_CATALOG.exercises.map((exercise) => ({
    ...exercise,
    progressionDefaults: SYNTHETIC_STARTER_PROGRESSION_DEFAULTS[
      exercise.exerciseVersionId as keyof typeof SYNTHETIC_STARTER_PROGRESSION_DEFAULTS
    ],
    ...(exercise.exerciseVersionId === SOURCE_PRESS_VERSION
      ? {
          swap: {
            trainingIntentId: TRAINING_INTENT_ID,
            alternatives: [{
              exerciseVersionId: NEUTRAL_PRESS_VERSION,
              differences: sourceDifferences,
              recalibrationRequired: true as const,
            }],
          },
        }
      : {}),
  })),
  {
    exerciseId: 'synthetic-neutral-grip-two-dumbbell-floor-press',
    exerciseVersionId: NEUTRAL_PRESS_VERSION,
    label: 'Synthetic neutral-grip two-dumbbell floor press',
    movementPattern: 'push',
    role: 'primary',
    preferenceRank: 1,
    lifecycle: 'active',
    contentReviewStatus: 'reviewed_fixture',
    mediaStatus: 'missing',
    preparationSeconds: 60,
    secondsPerRep: 4,
    textInstruction: 'Lie on the floor with one dumbbell in each hand and palms facing each other. Keep the upper arms close to the torso, lower until they meet the floor, then press with control.',
    progressionDefaults: {
      side: 'bilateral',
      rom: 'catalog_default',
      tempo: 'self_selected_controlled',
      exposureType: 'standard',
    },
    swap: {
      trainingIntentId: TRAINING_INTENT_ID,
      alternatives: [{
        exerciseVersionId: SOURCE_PRESS_VERSION,
        differences: returnDifferences,
        recalibrationRequired: true,
      }],
    },
    equipmentCompatibility: [{
      kind: 'dumbbell',
      basis: 'dumbbell_per_hand',
      implementCount: 2,
      holdingConfiguration: 'one_per_hand',
      minimumCanonicalKg: '1',
      maximumCanonicalKg: '100',
    }],
  },
] as const

const conditioningModes = SYNTHETIC_STARTER_CATALOG.conditioningModes.map(mode => ({ ...mode }))

export const SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH = createHash('sha256')
  .update(JSON.stringify({ exercises, conditioningModes }))
  .digest('hex')

export const SYNTHETIC_SWAP_JOURNEY_CATALOG: TrainingCatalogV1 = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1',
  catalogVersion: SYNTHETIC_SWAP_JOURNEY_FIXTURE_ID,
  origin: {
    kind: 'synthetic_fixture',
    source: 'server_fixture',
    fixtureId: SYNTHETIC_SWAP_JOURNEY_FIXTURE_ID,
    fixtureHash: SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
    label: 'Synthetic exercise swap journey catalog',
  },
  exercises,
  conditioningModes,
})

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

deepFreeze(SYNTHETIC_SWAP_JOURNEY_CATALOG)
