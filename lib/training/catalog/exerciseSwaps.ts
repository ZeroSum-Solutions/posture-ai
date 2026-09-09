import { enumerateEquipmentLoadsWithinBounds, type EquipmentInventory } from '../equipment'
import { compareCanonicalKgDecimals, compareEnteredLoadQuantities } from '../quantity'
import {
  TrainingCatalogV1Schema,
  type EquipmentCompatibilityV1,
  type TrainingCatalogV1,
  type TrainingExerciseV1,
} from './types'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import { ExerciseSwapLoadOptionV1Schema, type ExerciseSwapLoadOptionV1 } from '../contracts/exercise-swap'
import {
  BodyweightAssistanceProgressionPolicyV1Schema,
  type BodyweightAssistancePolicyRegistryV1,
  type BodyweightAssistanceProgressionPolicyV1,
} from '../contracts/bodyweight-assistance'
import {
  ExecutionContextV1Schema,
  catalogOriginMatchesExecutionContext,
  type ExecutionContextV1,
} from '../contracts/program'

export const MAX_EXERCISE_SWAP_LOAD_OPTIONS = 64

function contentIsSelectable(exercise: TrainingExerciseV1, catalog: TrainingCatalogV1): boolean {
  if (exercise.lifecycle !== 'active' || !exercise.progressionDefaults) return false
  if (catalog.origin.kind === 'synthetic_fixture') {
    return exercise.contentReviewStatus === 'reviewed_fixture'
      && (exercise.mediaStatus === 'reviewed_static_fixture'
        || (exercise.mediaStatus === 'missing' && typeof exercise.textInstruction === 'string'))
  }
  return exercise.contentReviewStatus === 'reviewed'
    && exercise.mediaStatus === 'reviewed_exact_variant'
}

function loadConfiguration(basis: ExerciseSwapLoadOptionV1['loadBasis']) {
  if (basis === 'dumbbell_single_implement') {
    return { implementCount: 1 as const, holdingConfiguration: 'two_hands_single_implement' as const }
  }
  if (basis === 'dumbbell_per_hand') {
    return { implementCount: 2 as const, holdingConfiguration: 'one_per_hand' as const }
  }
  if (basis === 'barbell_total') {
    return { implementCount: 1 as const, holdingConfiguration: 'both_hands_barbell' as const }
  }
  if (basis === 'machine_stack') {
    return { implementCount: 1 as const, holdingConfiguration: 'machine_defined' as const }
  }
  if (basis === 'bodyweight_external') {
    return { implementCount: 0 as const, holdingConfiguration: 'bodyweight_plus_external_load' as const }
  }
  return { implementCount: 1 as const, holdingConfiguration: 'machine_assistance' as const }
}

function policyMatchesContext(
  policy: BodyweightAssistanceProgressionPolicyV1,
  context: ExecutionContextV1,
): boolean {
  if (context.kind === 'live') return policy.provenance.kind === 'reviewed_authored_policy'
  return policy.provenance.kind === 'synthetic_fixture'
    && policy.provenance.fixtureId === context.fixtureId
    && policy.provenance.fixtureHash === context.fixtureHash
    && policy.provenance.label === context.label
}

function resolveDedicatedPolicy(
  compatibility: EquipmentCompatibilityV1,
  equipment: EquipmentInventory,
  context: ExecutionContextV1 | null,
  registry: BodyweightAssistancePolicyRegistryV1 | undefined,
) {
  if (compatibility.basis !== 'bodyweight_external'
    && compatibility.basis !== 'machine_assistance') return undefined
  if (!context || !registry) return null
  const parsed = BodyweightAssistanceProgressionPolicyV1Schema.safeParse(
    registry.resolve(compatibility.bodyweightAssistancePolicy, context),
  )
  if (!parsed.success
    || parsed.data.policyId !== compatibility.bodyweightAssistancePolicy.policyId
    || parsed.data.policyVersion !== compatibility.bodyweightAssistancePolicy.policyVersion
    || parsed.data.loadBasis !== compatibility.basis
    || !policyMatchesContext(parsed.data, context)) return null
  if (parsed.data.loadBasis === 'machine_assistance' && (
    equipment.kind !== 'assistance_machine'
    || parsed.data.supportedAssistanceRange.equipmentId !== equipment.equipmentId
    || compareCanonicalKgDecimals(
      compatibility.minimumCanonicalKg,
      parsed.data.supportedAssistanceRange.minimum.canonicalKg,
    ) < 0
    || compareCanonicalKgDecimals(
      compatibility.maximumCanonicalKg,
      parsed.data.supportedAssistanceRange.maximum.canonicalKg,
    ) > 0
  )) return null
  return compatibility.bodyweightAssistancePolicy
}

function exactLoadOptions(
  exercise: TrainingExerciseV1,
  inventory: readonly EquipmentInventory[],
  context: ExecutionContextV1 | null,
  policyRegistry: BodyweightAssistancePolicyRegistryV1 | undefined,
): readonly ExerciseSwapLoadOptionV1[] | null {
  const options: Omit<ExerciseSwapLoadOptionV1, 'optionIndex'>[] = []
  for (const compatibility of exercise.equipmentCompatibility) {
    for (const equipment of inventory) {
      if (equipment.kind !== compatibility.kind) continue
      const policy = resolveDedicatedPolicy(compatibility, equipment, context, policyRegistry)
      if (policy === null) continue
      let loads
      try {
        loads = enumerateEquipmentLoadsWithinBounds(equipment, compatibility.basis, compatibility)
      } catch {
        return null
      }
      const warmupsAreRepresentable = (exercise.warmupSets ?? []).every(warmup => (
        loads.some(load => (
          load.quantity.entered.unit === warmup.load.unit
          && compareEnteredLoadQuantities(load.quantity.entered, warmup.load) === 0
        ))
      ))
      if (!warmupsAreRepresentable) continue
      for (const load of loads) {
        options.push({
          equipmentId: load.equipmentId,
          loadBasis: load.basis,
          quantity: load.quantity,
          ...loadConfiguration(load.basis),
          ...(policy ? { bodyweightAssistancePolicy: policy } : {}),
        })
        if (options.length > MAX_EXERCISE_SWAP_LOAD_OPTIONS) return null
      }
    }
  }
  const deduplicated = [...new Map(options.map(option => [
    JSON.stringify([option.equipmentId, option.loadBasis, option.quantity.entered]), option,
  ])).values()]
  if (deduplicated.length === 0 || deduplicated.length > MAX_EXERCISE_SWAP_LOAD_OPTIONS) return null
  return Object.freeze(deduplicated.map((option, optionIndex) => (
    ExerciseSwapLoadOptionV1Schema.parse({ ...option, optionIndex })
  )))
}

export type ResolvedExerciseSwapAlternative = Readonly<{
  exercise: TrainingExerciseV1
  trainingIntentId: string
  differences: NonNullable<TrainingExerciseV1['swap']>['alternatives'][number]['differences']
  loadOptions: readonly ExerciseSwapLoadOptionV1[]
}>

export function resolveExerciseSwapAlternatives(rawInput: {
  catalog: unknown
  profile: unknown
  sourceExerciseVersionId: string
  executionContext?: unknown
  bodyweightAssistancePolicyRegistry?: BodyweightAssistancePolicyRegistryV1
}): readonly ResolvedExerciseSwapAlternative[] {
  const catalog = TrainingCatalogV1Schema.safeParse(rawInput.catalog)
  const profile = AthleteTrainingProfileV1Schema.safeParse(rawInput.profile)
  if (!catalog.success || !profile.success) return []
  const context = ExecutionContextV1Schema.safeParse(rawInput.executionContext)
  const trustedContext = context.success
    && catalogOriginMatchesExecutionContext(catalog.data.origin, context.data)
    ? context.data
    : null
  const source = catalog.data.exercises.find(exercise => (
    exercise.exerciseVersionId === rawInput.sourceExerciseVersionId
  ))
  if (!source?.swap || !contentIsSelectable(source, catalog.data)) return []
  return Object.freeze(source.swap.alternatives.flatMap((link) => {
    const target = catalog.data.exercises.find(exercise => (
      exercise.exerciseVersionId === link.exerciseVersionId
    ))
    if (!target?.swap
      || target.swap.trainingIntentId !== source.swap?.trainingIntentId
      || target.movementPattern !== source.movementPattern
      || target.role !== source.role
      || !contentIsSelectable(target, catalog.data)) return []
    const loadOptions = exactLoadOptions(
      target,
      profile.data.equipmentInventory,
      trustedContext,
      rawInput.bodyweightAssistancePolicyRegistry,
    )
    return loadOptions ? [{
      exercise: target,
      trainingIntentId: source.swap.trainingIntentId,
      differences: link.differences,
      loadOptions,
    }] : []
  }))
}
