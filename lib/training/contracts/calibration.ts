import { z } from 'zod'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from '../catalog/types'
import { enumerateEquipmentLoadsWithinBounds, type EquipmentLoad, type EquipmentLoadBasis } from '../equipment'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from './profile'
import type { CompilationResultV1, CompiledExerciseV1 } from '../engine/compileProgram'
import {
  AcceptedInitialLoadV1Schema,
  TrainingStableIdV1Schema,
  catalogOriginMatchesExecutionContext,
  catalogOriginsMatch,
  type AcceptedInitialLoadV1,
  type ExecutionContextV1,
} from './program'

export const INITIAL_LOAD_CALIBRATION_SCHEMA_VERSION = 'initial-load-calibration.v1' as const

type CompiledProgramDraftV1 = Extract<CompilationResultV1, { kind: 'draft_program' }>

export interface CompiledExerciseCalibrationInputV1 {
  readonly draft: CompiledProgramDraftV1
  readonly exerciseInstanceId: string
  readonly catalog: TrainingCatalogV1
  readonly profile: AthleteTrainingProfileV1
}

export interface InitialLoadCalibrationV1 {
  readonly schemaVersion: typeof INITIAL_LOAD_CALIBRATION_SCHEMA_VERSION
  readonly status: 'requires_explicit_acceptance'
  readonly subjectId: string
  readonly profileRevisionId: string
  readonly programRevisionId: string
  readonly catalogVersion: string
  readonly catalogOrigin: TrainingCatalogV1['origin']
  readonly exerciseInstanceId: string
  readonly exerciseVersionId: string
  readonly executionContext: ExecutionContextV1
  readonly loadBasis: EquipmentLoadBasis
  readonly options: readonly EquipmentLoad[]
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

function findCompiledExercise(draft: CompiledProgramDraftV1, exerciseInstanceId: string): CompiledExerciseV1 {
  const matches = draft.weeks.flatMap(week => week.strengthSessions)
    .flatMap(session => session.exercises)
    .filter(exercise => exercise.exerciseInstanceId === exerciseInstanceId)
  if (matches.length !== 1) throw new Error('Compiled exercise instance is missing or ambiguous')
  return matches[0]
}

function validateCalibrationSource(input: CompiledExerciseCalibrationInputV1): {
  readonly draft: CompiledProgramDraftV1
  readonly exercise: CompiledExerciseV1
  readonly catalog: TrainingCatalogV1
  readonly profile: AthleteTrainingProfileV1
} {
  const exerciseInstanceId = TrainingStableIdV1Schema.parse(input.exerciseInstanceId)
  const catalog = TrainingCatalogV1Schema.parse(input.catalog)
  const profile = AthleteTrainingProfileV1Schema.parse(input.profile)
  const { draft } = input
  if (draft.kind !== 'draft_program') throw new Error('Initial load calibration requires a compiled draft')
  if (draft.status !== 'requires_explicit_acceptance') throw new Error('Compiled draft is not awaiting acceptance')
  if (draft.profileRevisionId.trim().length === 0 || draft.programRevisionId.trim().length === 0) {
    throw new Error('Compiled draft source revisions are required')
  }
  if (draft.catalogVersion !== catalog.catalogVersion
    || !catalogOriginMatchesExecutionContext(catalog.origin, draft.executionContext)
    || !catalogOriginsMatch(draft.catalogOrigin, catalog.origin)) {
    throw new Error('Compiled draft catalog does not match calibration source')
  }
  if (draft.athleteTimezone !== profile.localTimezone) {
    throw new Error('Compiled draft profile does not match calibration source')
  }
  const exercise = findCompiledExercise(draft, exerciseInstanceId)
  const catalogExercise = catalog.exercises.find(item => item.exerciseVersionId === exercise.exerciseVersionId)
  const compatibility = catalogExercise?.equipmentCompatibility.find(option => (
    option.basis === exercise.loadBasis
    && option.minimumCanonicalKg === exercise.loadSelection.minimumCanonicalKg
    && option.maximumCanonicalKg === exercise.loadSelection.maximumCanonicalKg
  ))
  if (!compatibility) throw new Error('Compiled exercise compatibility is not catalog-attested')
  if ('implementCount' in compatibility && (
    compatibility.implementCount !== exercise.implementCount
    || compatibility.holdingConfiguration !== exercise.holdingConfiguration
  )) {
    throw new Error('Compiled exercise implement configuration is not catalog-attested')
  }
  return { draft, exercise, catalog, profile }
}

export function buildCompiledExerciseInitialLoadCalibration(
  input: CompiledExerciseCalibrationInputV1,
): InitialLoadCalibrationV1 {
  const { draft, exercise, profile } = validateCalibrationSource(input)
  const inventory = profile.equipmentInventory.find(item => item.equipmentId === exercise.equipmentId)
  if (!inventory) throw new Error('Compiled exercise equipment is not present in the profile inventory')
  const options = enumerateEquipmentLoadsWithinBounds(inventory, exercise.loadBasis, {
    minimumCanonicalKg: exercise.loadSelection.minimumCanonicalKg,
    maximumCanonicalKg: exercise.loadSelection.maximumCanonicalKg,
  })
  if (options.length === 0) throw new Error('Compiled exercise has no feasible initial load options')
  return deepFreeze({
    schemaVersion: INITIAL_LOAD_CALIBRATION_SCHEMA_VERSION,
    status: 'requires_explicit_acceptance',
    subjectId: draft.subjectId,
    profileRevisionId: draft.profileRevisionId,
    programRevisionId: draft.programRevisionId,
    catalogVersion: draft.catalogVersion,
    catalogOrigin: draft.catalogOrigin,
    exerciseInstanceId: exercise.exerciseInstanceId,
    exerciseVersionId: exercise.exerciseVersionId,
    executionContext: draft.executionContext,
    loadBasis: exercise.loadBasis,
    options,
  })
}

const acceptanceInputSchema = z.object({
  acceptanceId: TrainingStableIdV1Schema,
  acceptedAt: z.string().datetime({ offset: true }),
  acceptedByUserId: TrainingStableIdV1Schema,
  optionIndex: z.number().int().min(0),
}).strict()

export interface AcceptCompiledExerciseInitialLoadInputV1 extends CompiledExerciseCalibrationInputV1 {
  readonly acceptanceId: string
  readonly acceptedAt: string
  readonly acceptedByUserId: string
  readonly optionIndex: number
}

export function acceptCompiledExerciseInitialLoad(
  input: AcceptCompiledExerciseInitialLoadInputV1,
): AcceptedInitialLoadV1 {
  const parsed = acceptanceInputSchema.parse({
    acceptanceId: input.acceptanceId,
    acceptedAt: input.acceptedAt,
    acceptedByUserId: input.acceptedByUserId,
    optionIndex: input.optionIndex,
  })
  const calibration = buildCompiledExerciseInitialLoadCalibration(input)
  const option = calibration.options[parsed.optionIndex]
  if (!option) throw new Error('Selected initial load is not an offered equipment option')
  return deepFreeze(AcceptedInitialLoadV1Schema.parse({
    status: 'accepted',
    acceptanceId: parsed.acceptanceId,
    acceptedAt: parsed.acceptedAt,
    acceptedByUserId: parsed.acceptedByUserId,
    source: 'equipment_inventory',
    executionContext: calibration.executionContext,
    exerciseInstanceId: calibration.exerciseInstanceId,
    exerciseVersionId: calibration.exerciseVersionId,
    equipmentId: option.equipmentId,
    provenance: {
      profileRevisionId: calibration.profileRevisionId,
      compiledProgramRevisionId: calibration.programRevisionId,
      catalogVersion: calibration.catalogVersion,
      catalogOrigin: calibration.catalogOrigin,
    },
    loadBasis: option.basis,
    implementCount: option.basis === 'dumbbell_per_hand' ? 2 : 1,
    holdingConfiguration: option.basis === 'dumbbell_per_hand'
      ? 'one_per_hand'
      : option.basis === 'dumbbell_single_implement'
        ? 'two_hands_single_implement'
        : option.basis === 'barbell_total'
          ? 'both_hands_barbell'
          : 'machine_defined',
    quantity: option.quantity,
  }))
}
