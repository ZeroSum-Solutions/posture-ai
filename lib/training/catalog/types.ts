import { z } from 'zod'
import { createLoadQuantity, isEnteredLoadAtMostCanonicalKg } from '../quantity'

export const TRAINING_CATALOG_SCHEMA_VERSION = 'training-catalog.v1' as const

const stableIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const syntheticLabelSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .refine(value => /synthetic/i.test(value), 'Synthetic fixtures require a visible synthetic label')

const boundedCanonicalKgSchema = z.string()
  .max(32)
  .regex(/^\d+(?:\.\d+)?$/)
  .refine((value) => {
    const [whole, fraction = ''] = value.split('.')
    const normalizedWhole = whole.replace(/^0+(?=\d)/, '')
    return normalizedWhole.length < 4
      || (normalizedWhole === '1000' && !/[1-9]/.test(fraction))
  }, 'Catalog load bound must not exceed 1000 kg')

export const MovementPatternV1Schema = z.enum(['knee_dominant', 'hinge', 'push', 'pull'])
export type MovementPatternV1 = z.infer<typeof MovementPatternV1Schema>

export const ExerciseProgressionDefaultsV1Schema = z.object({
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  rom: stableIdSchema,
  tempo: stableIdSchema,
  exposureType: stableIdSchema,
}).strict()

export const AuthoredWarmupSetV1Schema = z.object({
  targetReps: z.number().int().min(1).max(100),
  load: z.object({
    value: z.string().max(16),
    unit: z.enum(['kg', 'lb']),
  }).strict(),
}).strict().superRefine((warmup, ctx) => {
  try {
    const quantity = createLoadQuantity(warmup.load)
    if (!isEnteredLoadAtMostCanonicalKg(quantity.entered, '1000')) {
      ctx.addIssue({ code: 'custom', message: 'Warm-up load exceeds 1000 kg', path: ['load'] })
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid exact warm-up load', path: ['load'] })
  }
})

export const TrainingExerciseSwapDifferenceV1Schema = z.object({
  kind: z.enum(['equipment_setup', 'body_position', 'execution']),
  description: z.string().trim().min(1).max(240),
}).strict()

export const TrainingExerciseSwapV1Schema = z.object({
  trainingIntentId: stableIdSchema,
  alternatives: z.array(z.object({
    exerciseVersionId: stableIdSchema,
    differences: z.array(TrainingExerciseSwapDifferenceV1Schema).min(1).max(4),
    recalibrationRequired: z.literal(true),
  }).strict()).max(8),
}).strict()

export const TrainingCatalogOriginV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authored_catalog') }).strict(),
  z.object({
    kind: z.literal('synthetic_fixture'),
    source: z.literal('server_fixture'),
    fixtureId: stableIdSchema,
    fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: syntheticLabelSchema,
  }).strict(),
])

export const BodyweightAssistancePolicyReferenceV1Schema = z.object({
  policyId: stableIdSchema,
  policyVersion: stableIdSchema,
}).strict()

const compatibilityBounds = {
  minimumCanonicalKg: boundedCanonicalKgSchema,
  maximumCanonicalKg: boundedCanonicalKgSchema,
}

export const EquipmentCompatibilityV1Schema = z.discriminatedUnion('basis', [
  z.object({ kind: z.literal('barbell'), basis: z.literal('barbell_total'), ...compatibilityBounds }).strict(),
  z.object({
    kind: z.literal('dumbbell'), basis: z.literal('dumbbell_per_hand'),
    implementCount: z.literal(2), holdingConfiguration: z.literal('one_per_hand'), ...compatibilityBounds,
  }).strict(),
  z.object({
    kind: z.literal('dumbbell'), basis: z.literal('dumbbell_single_implement'),
    implementCount: z.literal(1), holdingConfiguration: z.literal('two_hands_single_implement'), ...compatibilityBounds,
  }).strict(),
  z.object({ kind: z.literal('machine'), basis: z.literal('machine_stack'), ...compatibilityBounds }).strict(),
  z.object({
    kind: z.literal('bodyweight_external'),
    basis: z.literal('bodyweight_external'),
    implementCount: z.literal(0),
    holdingConfiguration: z.literal('bodyweight_plus_external_load'),
    bodyweightAssistancePolicy: BodyweightAssistancePolicyReferenceV1Schema,
    ...compatibilityBounds,
  }).strict(),
  z.object({
    kind: z.literal('assistance_machine'),
    basis: z.literal('machine_assistance'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('machine_assistance'),
    bodyweightAssistancePolicy: BodyweightAssistancePolicyReferenceV1Schema,
    ...compatibilityBounds,
  }).strict(),
])

export const TrainingExerciseV1Schema = z.object({
  exerciseId: stableIdSchema,
  exerciseVersionId: stableIdSchema,
  label: z.string().trim().min(1).max(160),
  movementPattern: MovementPatternV1Schema,
  role: z.enum(['primary', 'accessory']),
  preferenceRank: z.number().int().min(0).max(10_000),
  lifecycle: z.enum(['active', 'staged']),
  contentReviewStatus: z.enum(['reviewed', 'reviewed_fixture', 'unreviewed']),
  mediaStatus: z.enum(['reviewed_exact_variant', 'reviewed_static_fixture', 'missing']),
  preparationSeconds: z.number().int().min(0).max(3_600),
  secondsPerRep: z.number().int().min(1).max(60),
  textInstruction: z.string().trim().min(1).max(1_000).optional(),
  progressionDefaults: ExerciseProgressionDefaultsV1Schema.optional(),
  warmupSets: z.array(AuthoredWarmupSetV1Schema).min(1).max(5).optional(),
  swap: TrainingExerciseSwapV1Schema.optional(),
  equipmentCompatibility: z.array(EquipmentCompatibilityV1Schema).min(1).max(20),
}).strict()

export const ConditioningModeV1Schema = z.object({
  modalityId: stableIdSchema,
  label: z.string().trim().min(1).max(160),
  preferenceRank: z.number().int().min(0).max(10_000),
  lifecycle: z.enum(['active', 'staged']),
  contentReviewStatus: z.enum(['reviewed', 'reviewed_fixture', 'unreviewed']),
  effortCue: z.string().trim().min(1).max(240),
}).strict()

export const TrainingCatalogV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_CATALOG_SCHEMA_VERSION),
  catalogVersion: stableIdSchema,
  origin: TrainingCatalogOriginV1Schema,
  exercises: z.array(TrainingExerciseV1Schema).max(200),
  conditioningModes: z.array(ConditioningModeV1Schema).max(50),
}).strict().superRefine((catalog, ctx) => {
  if (catalog.origin.kind === 'synthetic_fixture') {
    catalog.exercises.forEach((exercise, index) => {
      if (!/synthetic/i.test(exercise.label)) {
        ctx.addIssue({ code: 'custom', message: 'Synthetic exercise fixtures require a visible synthetic label', path: ['exercises', index, 'label'] })
      }
    })
    catalog.conditioningModes.forEach((mode, index) => {
      if (!/synthetic/i.test(mode.label)) {
        ctx.addIssue({ code: 'custom', message: 'Synthetic conditioning fixtures require a visible synthetic label', path: ['conditioningModes', index, 'label'] })
      }
    })
  }
  const exerciseIds = new Set<string>()
  catalog.exercises.forEach((exercise, index) => {
    if (exerciseIds.has(exercise.exerciseVersionId)) {
      ctx.addIssue({ code: 'custom', message: 'Exercise version IDs must be unique', path: ['exercises', index, 'exerciseVersionId'] })
    }
    exerciseIds.add(exercise.exerciseVersionId)
    const alternativeIds = new Set<string>()
    exercise.swap?.alternatives.forEach((alternative, alternativeIndex) => {
      const target = catalog.exercises.find(item => item.exerciseVersionId === alternative.exerciseVersionId)
      if (alternativeIds.has(alternative.exerciseVersionId)) {
        ctx.addIssue({ code: 'custom', message: 'Swap alternative IDs must be unique', path: ['exercises', index, 'swap', 'alternatives', alternativeIndex, 'exerciseVersionId'] })
      }
      alternativeIds.add(alternative.exerciseVersionId)
      if (!target || target.exerciseVersionId === exercise.exerciseVersionId) {
        ctx.addIssue({ code: 'custom', message: 'Swap alternative must reference another catalog exercise', path: ['exercises', index, 'swap', 'alternatives', alternativeIndex, 'exerciseVersionId'] })
      } else if (target.movementPattern !== exercise.movementPattern
        || target.role !== exercise.role
        || target.swap?.trainingIntentId !== exercise.swap?.trainingIntentId) {
        ctx.addIssue({ code: 'custom', message: 'Swap alternative must preserve the authored training intent, movement pattern, and role', path: ['exercises', index, 'swap', 'alternatives', alternativeIndex, 'exerciseVersionId'] })
      }
    })
    exercise.equipmentCompatibility.forEach((compatibility, compatibilityIndex) => {
      if (!isEnteredLoadAtMostCanonicalKg(
        { value: compatibility.minimumCanonicalKg, unit: 'kg' },
        compatibility.maximumCanonicalKg,
      )) {
        ctx.addIssue({ code: 'custom', message: 'Minimum load cannot exceed maximum load', path: ['exercises', index, 'equipmentCompatibility', compatibilityIndex, 'minimumCanonicalKg'] })
      }
    })
  })

  const modalityIds = new Set<string>()
  catalog.conditioningModes.forEach((mode, index) => {
    if (modalityIds.has(mode.modalityId)) {
      ctx.addIssue({ code: 'custom', message: 'Conditioning modality IDs must be unique', path: ['conditioningModes', index, 'modalityId'] })
    }
    modalityIds.add(mode.modalityId)
  })
})

export type TrainingExerciseV1 = z.infer<typeof TrainingExerciseV1Schema>
export type ExerciseProgressionDefaultsV1 = z.infer<typeof ExerciseProgressionDefaultsV1Schema>
export type AuthoredWarmupSetV1 = z.infer<typeof AuthoredWarmupSetV1Schema>
export type TrainingExerciseSwapV1 = z.infer<typeof TrainingExerciseSwapV1Schema>
export type TrainingExerciseSwapDifferenceV1 = z.infer<typeof TrainingExerciseSwapDifferenceV1Schema>
export type EquipmentCompatibilityV1 = z.infer<typeof EquipmentCompatibilityV1Schema>
export type BodyweightAssistancePolicyReferenceV1 = z.infer<typeof BodyweightAssistancePolicyReferenceV1Schema>
export type TrainingCatalogOriginV1 = z.infer<typeof TrainingCatalogOriginV1Schema>
export type ConditioningModeV1 = z.infer<typeof ConditioningModeV1Schema>
export type TrainingCatalogV1 = z.infer<typeof TrainingCatalogV1Schema>
