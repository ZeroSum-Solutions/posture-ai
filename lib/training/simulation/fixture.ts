import { AthleteTrainingProfileV1Schema } from '@/lib/training/contracts/profile'
import {
  SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
  SYNTHETIC_SWAP_JOURNEY_FIXTURE_ID,
} from '@/lib/training/catalog/syntheticSwapJourney'
import {
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
  SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
} from '@/lib/training/catalog/syntheticConditioningJourney'
import {
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
} from '@/lib/training/catalog/syntheticBodyweightAssistance'

// Frozen from SYNTHETIC_STARTER_CATALOG.origin. Program builds use these exact
// values; the profile below keeps its own synthetic-fixture provenance.
export const PRACTICE_SIMULATION_CATALOG_ORIGIN = {
  fixtureId: 'synthetic-starter-catalog.v1',
  fixtureHash: 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
} as const

export const EXERCISE_SWAP_SIMULATION_CATALOG_ORIGIN = {
  fixtureId: SYNTHETIC_SWAP_JOURNEY_FIXTURE_ID,
  fixtureHash: SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
} as const

export const CONDITIONING_SIMULATION_CATALOG_ORIGIN = {
  fixtureId: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
  fixtureHash: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
} as const

export const BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN = {
  fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
  fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
} as const

export type PracticeSimulationCatalogChoice =
  | 'starter'
  | 'exercise-swap'
  | 'conditioning'
  | 'bodyweight-assistance'

const practiceProfileBase = {
  schemaVersion: 'athlete-training-profile.v1',
  origin: {
    kind: 'synthetic_fixture',
    fixtureId: 'practice-strength-profile.v1',
    label: 'Synthetic practice profile',
  },
  goal: 'strength',
  experience: 'beginner',
  recentConsistency: 'consistent',
  cycleLengthWeeks: 8,
  strengthDays: ['monday', 'thursday'],
  localTimezone: 'UTC',
  sessionTimeBudgetMinutes: 45,
  preferredLoadUnit: 'kg',
  startingHistory: [],
} as const

export const BODYWEIGHT_ASSISTANCE_SIMULATION_PROFILE = {
  ...practiceProfileBase,
  equipmentInventory: [
    {
      kind: 'bodyweight_external',
      equipmentId: 'synthetic-bodyweight-station',
      unit: 'kg',
      externalLoads: ['0', '5', '10'],
    },
    {
      kind: 'assistance_machine',
      equipmentId: 'synthetic-assisted-pullup-machine',
      unit: 'kg',
      assistanceLoads: ['10', '20', '30', '40', '50', '60'],
    },
  ],
} as const

export const PRACTICE_SIMULATION_CATALOG_CHOICES = Object.freeze({
  starter: Object.freeze({
    origin: PRACTICE_SIMULATION_CATALOG_ORIGIN,
    reservationRpc: 'reserve_training_simulation_identity' as const,
    profile: undefined,
  }),
  'exercise-swap': Object.freeze({
    origin: EXERCISE_SWAP_SIMULATION_CATALOG_ORIGIN,
    reservationRpc: 'reserve_training_exercise_swap_simulation_identity' as const,
    profile: undefined,
  }),
  conditioning: Object.freeze({
    origin: CONDITIONING_SIMULATION_CATALOG_ORIGIN,
    reservationRpc: 'reserve_training_conditioning_simulation_identity' as const,
    profile: undefined,
  }),
  'bodyweight-assistance': Object.freeze({
    origin: BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN,
    reservationRpc: 'reserve_training_bodyweight_assistance_simulation_identity' as const,
    profile: BODYWEIGHT_ASSISTANCE_SIMULATION_PROFILE,
  }),
})

export const PRACTICE_SIMULATION_FIXTURE = {
  label: 'Practice data',
  profile: {
    ...practiceProfileBase,
    equipmentInventory: [{
      kind: 'dumbbell',
      equipmentId: 'practice-dumbbells',
      unit: 'kg',
      perHandLoads: ['2', '4', '6', '8', '10', '12'],
    }],
    startingHistory: [],
  },
} as const

AthleteTrainingProfileV1Schema.parse(PRACTICE_SIMULATION_FIXTURE.profile)
AthleteTrainingProfileV1Schema.parse(BODYWEIGHT_ASSISTANCE_SIMULATION_PROFILE)
