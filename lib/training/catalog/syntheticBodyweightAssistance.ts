import { createHash } from 'node:crypto'
import { createLoadQuantity } from '../quantity'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from './types'

export const SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID =
  'synthetic-bodyweight-assistance-catalog.v1' as const

export const SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE = Object.freeze({
  policyId: 'synthetic-bodyweight-rep-only.v1',
  policyVersion: '1',
})

export const SYNTHETIC_ASSISTANCE_POLICY_REFERENCE = Object.freeze({
  policyId: 'synthetic-assistance-rep-only.v1',
  policyVersion: '1',
})

const bodyweightCompatibility = {
  kind: 'bodyweight_external' as const,
  basis: 'bodyweight_external' as const,
  implementCount: 0 as const,
  holdingConfiguration: 'bodyweight_plus_external_load' as const,
  bodyweightAssistancePolicy: SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
  minimumCanonicalKg: '0',
  maximumCanonicalKg: '20',
}

const progressionDefaults = {
  side: 'bilateral' as const,
  rom: 'catalog_default',
  tempo: 'self_selected_controlled',
  exposureType: 'standard',
}

const exercises = [
  {
    exerciseId: 'synthetic-bodyweight-squat',
    exerciseVersionId: 'synthetic-bodyweight-squat.v1',
    label: 'Synthetic bodyweight squat',
    movementPattern: 'knee_dominant', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 30, secondsPerRep: 4,
    textInstruction: 'Use the same recorded setup and range for each practice exposure.',
    progressionDefaults,
    equipmentCompatibility: [bodyweightCompatibility],
  },
  {
    exerciseId: 'synthetic-bodyweight-bridge',
    exerciseVersionId: 'synthetic-bodyweight-bridge.v1',
    label: 'Synthetic bodyweight bridge',
    movementPattern: 'hinge', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 30, secondsPerRep: 4,
    textInstruction: 'Use the same recorded setup and range for each practice exposure.',
    progressionDefaults,
    equipmentCompatibility: [bodyweightCompatibility],
  },
  {
    exerciseId: 'synthetic-bodyweight-pushup',
    exerciseVersionId: 'synthetic-bodyweight-pushup.v1',
    label: 'Synthetic bodyweight push-up',
    movementPattern: 'push', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 30, secondsPerRep: 4,
    textInstruction: 'Use the same recorded hand position and range for each practice exposure.',
    progressionDefaults,
    equipmentCompatibility: [bodyweightCompatibility],
  },
  {
    exerciseId: 'synthetic-assisted-pullup',
    exerciseVersionId: 'synthetic-assisted-pullup.v1',
    label: 'Synthetic assisted pull-up',
    movementPattern: 'pull', role: 'primary', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
    preparationSeconds: 45, secondsPerRep: 4,
    textInstruction: 'Use the same assistance machine, grip, and range for each practice exposure.',
    progressionDefaults,
    equipmentCompatibility: [{
      kind: 'assistance_machine',
      basis: 'machine_assistance',
      implementCount: 1,
      holdingConfiguration: 'machine_assistance',
      bodyweightAssistancePolicy: SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
      minimumCanonicalKg: '10',
      maximumCanonicalKg: '60',
    }],
  },
] as const

const conditioningModes = [{
  modalityId: 'synthetic-continuous-walking.v1',
  label: 'Synthetic continuous walking',
  preferenceRank: 0,
  lifecycle: 'active',
  contentReviewStatus: 'reviewed_fixture',
  effortCue: 'Use a comfortable practice pace.',
}] as const

export const SYNTHETIC_BODYWEIGHT_ASSISTANCE_POLICY_DEFINITIONS = Object.freeze([
  Object.freeze({
    schemaVersion: 'bodyweight-assistance-progression-policy.v1' as const,
    ...SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
    loadBasis: 'bodyweight_external' as const,
    progressionMode: 'rep_only_same_benchmark' as const,
  }),
  Object.freeze({
    schemaVersion: 'bodyweight-assistance-progression-policy.v1' as const,
    ...SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
    loadBasis: 'machine_assistance' as const,
    progressionMode: 'rep_only_same_benchmark' as const,
    supportedAssistanceRange: Object.freeze({
      equipmentId: 'synthetic-assisted-pullup-machine',
      minimum: createLoadQuantity({ value: '10', unit: 'kg' }),
      maximum: createLoadQuantity({ value: '60', unit: 'kg' }),
    }),
  }),
])

export const SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH = createHash('sha256')
  .update(JSON.stringify({
    exercises,
    conditioningModes,
    progressionPolicies: SYNTHETIC_BODYWEIGHT_ASSISTANCE_POLICY_DEFINITIONS,
  }))
  .digest('hex')

export const SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG: TrainingCatalogV1 =
  TrainingCatalogV1Schema.parse({
    schemaVersion: 'training-catalog.v1',
    catalogVersion: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
    origin: {
      kind: 'synthetic_fixture',
      source: 'server_fixture',
      fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
      fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
      label: 'Synthetic bodyweight and assistance catalog',
    },
    exercises,
    conditioningModes,
  })

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

deepFreeze(SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG)
