import { createHash } from 'node:crypto'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from './types'

const exercises = [
  {
    exerciseId: 'synthetic-goblet-squat', exerciseVersionId: 'synthetic-goblet-squat.v1',
    label: 'Synthetic goblet squat', movementPattern: 'knee_dominant', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 45, secondsPerRep: 4,
    textInstruction: 'Hold one dumbbell at the chest with both hands. Sit down between the hips, then stand with control.',
    equipmentCompatibility: [{
      kind: 'dumbbell', basis: 'dumbbell_single_implement', implementCount: 1,
      holdingConfiguration: 'two_hands_single_implement', minimumCanonicalKg: '1', maximumCanonicalKg: '100',
    }],
  },
  {
    exerciseId: 'synthetic-two-dumbbell-rdl', exerciseVersionId: 'synthetic-two-dumbbell-rdl.v1',
    label: 'Synthetic two-dumbbell Romanian deadlift', movementPattern: 'hinge', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 45, secondsPerRep: 4,
    textInstruction: 'Hold one dumbbell in each hand. Push the hips back with a long spine, then stand tall with control.',
    equipmentCompatibility: [{
      kind: 'dumbbell', basis: 'dumbbell_per_hand', implementCount: 2,
      holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '1', maximumCanonicalKg: '100',
    }],
  },
  {
    exerciseId: 'synthetic-two-dumbbell-floor-press', exerciseVersionId: 'synthetic-two-dumbbell-floor-press.v1',
    label: 'Synthetic two-dumbbell floor press', movementPattern: 'push', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 60, secondsPerRep: 4,
    textInstruction: 'Lie on the floor with one dumbbell in each hand. Lower until the upper arms meet the floor, then press with control.',
    equipmentCompatibility: [{
      kind: 'dumbbell', basis: 'dumbbell_per_hand', implementCount: 2,
      holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '1', maximumCanonicalKg: '100',
    }],
  },
  {
    exerciseId: 'synthetic-two-dumbbell-bent-row', exerciseVersionId: 'synthetic-two-dumbbell-bent-row.v1',
    label: 'Synthetic two-dumbbell unsupported bent-over row', movementPattern: 'pull', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 45, secondsPerRep: 4,
    textInstruction: 'Hold one dumbbell in each hand and hinge without a bench. Row toward the ribs, then lower with control.',
    equipmentCompatibility: [{
      kind: 'dumbbell', basis: 'dumbbell_per_hand', implementCount: 2,
      holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '1', maximumCanonicalKg: '100',
    }],
  },
] as const

const conditioningModes = [{
  modalityId: 'synthetic-continuous-walking.v1', label: 'Synthetic continuous walking', preferenceRank: 0,
  lifecycle: 'active', contentReviewStatus: 'reviewed_fixture',
  effortCue: 'Use an easy to moderate pace where speaking in full sentences remains comfortable.',
}] as const

export const SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH = createHash('sha256')
  .update(JSON.stringify({ exercises, conditioningModes }))
  .digest('hex')

export const SYNTHETIC_STARTER_PROGRESSION_DEFAULTS = Object.freeze({
  'synthetic-goblet-squat.v1': Object.freeze({ side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled', exposureType: 'standard' }),
  'synthetic-two-dumbbell-rdl.v1': Object.freeze({ side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled', exposureType: 'standard' }),
  'synthetic-two-dumbbell-floor-press.v1': Object.freeze({ side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled', exposureType: 'standard' }),
  'synthetic-two-dumbbell-bent-row.v1': Object.freeze({ side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled', exposureType: 'standard' }),
} as const)

export const SYNTHETIC_STARTER_CATALOG: TrainingCatalogV1 = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1',
  catalogVersion: 'synthetic-starter-catalog.v1',
  origin: {
    kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'synthetic-starter-catalog.v1',
    fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH, label: 'Synthetic starter exercise catalog',
  },
  exercises,
  conditioningModes,
})

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

deepFreeze(SYNTHETIC_STARTER_CATALOG)
