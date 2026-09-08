import { AthleteTrainingProfileV1Schema } from '@/lib/training/contracts/profile'

// Frozen from SYNTHETIC_STARTER_CATALOG.origin. Program builds use these exact
// values; the profile below keeps its own synthetic-fixture provenance.
export const PRACTICE_SIMULATION_CATALOG_ORIGIN = {
  fixtureId: 'synthetic-starter-catalog.v1',
  fixtureHash: 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
} as const

export const PRACTICE_SIMULATION_FIXTURE = {
  label: 'Practice data',
  profile: {
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
