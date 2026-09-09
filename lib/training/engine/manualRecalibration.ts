import { z } from 'zod'
import {
  TrainingCatalogV1Schema,
  type EquipmentCompatibilityV1,
  type TrainingCatalogOriginV1,
} from '../catalog/types'
import {
  BodyweightAssistanceProgressionPolicyV1Schema,
  type BodyweightAssistancePolicyRegistryV1,
} from '../contracts/bodyweight-assistance'
import { EligibilitySnapshotV1Schema, type EligibilitySnapshotV1 } from '../contracts/eligibility'
import {
  ManualRecalibrationOfferV1Schema,
  ManualRecalibrationSelectionV1Schema,
  ManualRecalibrationSourceDecisionV1Schema,
  SelectManualRecalibrationOptionInputV1Schema,
  type ManualRecalibrationOfferV1,
  type ManualRecalibrationSelectionV1,
  type ManualRecalibrationSourceDecisionV1,
} from '../contracts/manual-recalibration'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from '../contracts/profile'
import {
  TrainingProgramRevisionV1Schema,
  catalogOriginMatchesExecutionContext,
  catalogOriginsMatch,
  type TrainingProgramRevisionV1,
} from '../contracts/program'
import { enumerateEquipmentLoadsWithinBounds } from '../equipment'
import { compareCanonicalKgDecimals, compareLoadIncreaseToRatio } from '../quantity'
import type { ActiveCalibrationTargetV1 } from '../contracts/active-calibration'
import { ActiveCalibrationTargetV1Schema } from '../contracts/active-calibration'

export interface ManualRecalibrationCatalogRegistryV1 {
  readonly resolve: (
    catalogVersion: string,
    catalogOrigin: TrainingCatalogOriginV1,
  ) => unknown | null
}

export interface BuildManualRecalibrationInputV1 {
  readonly program: TrainingProgramRevisionV1
  /** Canonical hash read with the immutable program revision by the server. */
  readonly sourceProgramHash: string
  readonly currentProfileRevisionId: string
  readonly currentProfile: AthleteTrainingProfileV1
  readonly currentEligibility: EligibilitySnapshotV1
  /** Server evaluation time; client clocks are not authoritative. */
  readonly evaluatedAt: string
  /** Server-derived latest applicable too-easy decision and completed source binding. */
  readonly sourceDecision: ManualRecalibrationSourceDecisionV1
  /** Server projection of the next pending, unprescribed target. */
  readonly target: ActiveCalibrationTargetV1
  readonly catalogRegistry: ManualRecalibrationCatalogRegistryV1
  readonly bodyweightAssistancePolicyRegistry?: BodyweightAssistancePolicyRegistryV1
}

type ProgramExercise = TrainingProgramRevisionV1['sessions'][number]['exercises'][number]

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

function assertCurrentEligibility(
  eligibility: EligibilitySnapshotV1,
  evaluatedAt: string,
  program: TrainingProgramRevisionV1,
): void {
  if (eligibility.sourceRevisionId !== program.eligibilitySourceRevisionId) {
    throw new Error('Manual recalibration eligibility source is stale')
  }
  if (eligibility.state !== 'eligible_general' || eligibility.scope !== 'supported') {
    throw new Error('Manual recalibration eligibility is unavailable')
  }
  const now = Date.parse(evaluatedAt)
  if (Date.parse(eligibility.effectiveFrom) > now
    || (eligibility.effectiveUntil !== null && Date.parse(eligibility.effectiveUntil) < now)
    || (eligibility.supersededAt !== null && Date.parse(eligibility.supersededAt) <= now)) {
    throw new Error('Manual recalibration eligibility is not current')
  }
  if (program.executionContext.kind === 'live') {
    if (eligibility.source.kind === 'synthetic_fixture') {
      throw new Error('Synthetic eligibility cannot authorize live manual recalibration')
    }
    return
  }
  if (eligibility.source.kind !== 'synthetic_fixture'
    || eligibility.source.fixtureId !== program.executionContext.fixtureId) {
    throw new Error('Manual recalibration synthetic eligibility context does not match')
  }
}

function compatibilityMatches(compatibility: EquipmentCompatibilityV1, exercise: ProgramExercise): boolean {
  const load = exercise.acceptedInitialLoad
  if (compatibility.basis !== load.loadBasis) return false
  if ('implementCount' in compatibility && (
    compatibility.implementCount !== load.implementCount
    || compatibility.holdingConfiguration !== load.holdingConfiguration
  )) return false
  const policy = 'bodyweightAssistancePolicy' in compatibility
    ? compatibility.bodyweightAssistancePolicy
    : undefined
  return JSON.stringify(policy) === JSON.stringify(load.bodyweightAssistancePolicy)
}

function inventoryMatchesBasis(
  inventory: AthleteTrainingProfileV1['equipmentInventory'][number],
  basis: ProgramExercise['acceptedInitialLoad']['loadBasis'],
): boolean {
  if (inventory.kind === 'barbell') return basis === 'barbell_total'
  if (inventory.kind === 'dumbbell') return basis === 'dumbbell_per_hand' || basis === 'dumbbell_single_implement'
  if (inventory.kind === 'machine') return basis === 'machine_stack'
  if (inventory.kind === 'bodyweight_external') return basis === 'bodyweight_external'
  return basis === 'machine_assistance'
}

function policyMatchesContext(
  policy: z.infer<typeof BodyweightAssistanceProgressionPolicyV1Schema>,
  program: TrainingProgramRevisionV1,
): boolean {
  if (program.executionContext.kind === 'live') return policy.provenance.kind === 'reviewed_authored_policy'
  return policy.provenance.kind === 'synthetic_fixture'
    && policy.provenance.fixtureId === program.executionContext.fixtureId
    && policy.provenance.fixtureHash === program.executionContext.fixtureHash
    && policy.provenance.label === program.executionContext.label
}

function validateDedicatedPolicy(
  input: BuildManualRecalibrationInputV1,
  program: TrainingProgramRevisionV1,
  compatibility: EquipmentCompatibilityV1,
  equipmentId: string,
): void {
  if (!('bodyweightAssistancePolicy' in compatibility)) return
  const reference = compatibility.bodyweightAssistancePolicy
  const resolved = input.bodyweightAssistancePolicyRegistry?.resolve(reference, program.executionContext)
  const policy = BodyweightAssistanceProgressionPolicyV1Schema.safeParse(resolved)
  if (!policy.success
    || policy.data.policyId !== reference.policyId
    || policy.data.policyVersion !== reference.policyVersion
    || policy.data.loadBasis !== compatibility.basis
    || !policyMatchesContext(policy.data, program)) {
    throw new Error('Manual recalibration policy is unavailable')
  }
  if (policy.data.loadBasis === 'machine_assistance' && (
    policy.data.supportedAssistanceRange.equipmentId !== equipmentId
    || compareCanonicalKgDecimals(
      compatibility.minimumCanonicalKg,
      policy.data.supportedAssistanceRange.minimum.canonicalKg,
    ) < 0
    || compareCanonicalKgDecimals(
      compatibility.maximumCanonicalKg,
      policy.data.supportedAssistanceRange.maximum.canonicalKg,
    ) > 0
  )) throw new Error('Manual assistance recalibration is outside the reviewed machine range')
}

function comparatorIdentity(exercise: ProgramExercise): unknown {
  return {
    exerciseVersionId: exercise.exerciseVersionId,
    equipmentId: exercise.acceptedInitialLoad.equipmentId,
    loadBasis: exercise.acceptedInitialLoad.loadBasis,
    load: exercise.acceptedInitialLoad.quantity,
    bodyweightAssistancePolicy: exercise.acceptedInitialLoad.bodyweightAssistancePolicy,
    progression: exercise.progression,
    workingSetCount: exercise.setIds.length,
    repRange: exercise.repRange,
    targetRir: exercise.targetRir,
  }
}

function requireOneExercise(
  program: TrainingProgramRevisionV1,
  sessionId: string,
  exerciseInstanceId: string,
  label: string,
): ProgramExercise {
  const sessions = program.sessions.filter(session => session.sessionId === sessionId)
  const exercises = sessions.flatMap(session => session.exercises)
    .filter(exercise => exercise.exerciseInstanceId === exerciseInstanceId)
  if (sessions.length !== 1 || exercises.length !== 1) {
    throw new Error(`Manual recalibration ${label} is missing or ambiguous`)
  }
  return exercises[0]
}

function outlierDisposition(
  current: ProgramExercise['acceptedInitialLoad']['quantity'],
  candidate: ProgramExercise['acceptedInitialLoad']['quantity'],
  assistance: boolean,
) {
  if (assistance) return 'not_applicable_to_assistance' as const
  const comparison = compareLoadIncreaseToRatio(current, candidate, { numerator: 1, denominator: 5 })
  if (comparison === 'exceeds_limit') return 'greater_than_20_percent_acknowledgement_required' as const
  if (comparison === 'calibration_required') return 'zero_prior_requires_calibration_confirmation' as const
  return 'within_20_percent' as const
}

export function buildManualRecalibrationOffer(
  rawInput: BuildManualRecalibrationInputV1,
): ManualRecalibrationOfferV1 {
  const program = TrainingProgramRevisionV1Schema.parse(rawInput.program)
  const profile = AthleteTrainingProfileV1Schema.parse(rawInput.currentProfile)
  const eligibility = EligibilitySnapshotV1Schema.parse(rawInput.currentEligibility)
  const sourceDecision = ManualRecalibrationSourceDecisionV1Schema.parse(rawInput.sourceDecision)
  const target = ActiveCalibrationTargetV1Schema.parse(rawInput.target)
  const evaluatedAt = z.string().datetime({ offset: true }).parse(rawInput.evaluatedAt)
  const sourceProgramHash = z.string().regex(/^[a-f0-9]{64}$/).parse(rawInput.sourceProgramHash)
  const profileRevisionId = z.string().trim().min(1).max(128).parse(rawInput.currentProfileRevisionId)
  if (program.profileRevisionId !== profileRevisionId) throw new Error('Manual recalibration profile is stale')
  assertCurrentEligibility(eligibility, evaluatedAt, program)

  const sourceExercise = requireOneExercise(
    program,
    sourceDecision.sourceSessionId,
    sourceDecision.sourceExerciseInstanceId,
    'source',
  )
  const targetExercise = requireOneExercise(program, target.sessionId, target.exerciseInstanceId, 'target')
  if (!sourceExercise.progression || !targetExercise.progression) {
    throw new Error('Manual recalibration source lacks authored progression metadata')
  }
  if (targetExercise.progression.loadEpoch === Number.MAX_SAFE_INTEGER) {
    throw new Error('Manual recalibration load epoch is exhausted')
  }
  if (JSON.stringify(comparatorIdentity(sourceExercise)) !== JSON.stringify(comparatorIdentity(targetExercise))) {
    throw new Error('Manual recalibration source does not match the current target series')
  }

  const parsedCatalog = TrainingCatalogV1Schema.safeParse(
    rawInput.catalogRegistry.resolve(program.catalogVersion, program.catalogOrigin),
  )
  if (!parsedCatalog.success
    || parsedCatalog.data.catalogVersion !== program.catalogVersion
    || !catalogOriginsMatch(parsedCatalog.data.origin, program.catalogOrigin)
    || !catalogOriginMatchesExecutionContext(parsedCatalog.data.origin, program.executionContext)) {
    throw new Error('Manual recalibration catalog is unavailable')
  }
  const catalogExercises = parsedCatalog.data.exercises.filter(item => (
    item.exerciseVersionId === targetExercise.exerciseVersionId
  ))
  if (catalogExercises.length !== 1) throw new Error('Manual recalibration exercise is not catalog-attested')
  const compatibility = catalogExercises[0].equipmentCompatibility.find(item => (
    compatibilityMatches(item, targetExercise)
  ))
  if (!compatibility) throw new Error('Manual recalibration load is not catalog-attested')

  const inventory = profile.equipmentInventory.find(item => (
    item.equipmentId === targetExercise.acceptedInitialLoad.equipmentId
  ))
  if (!inventory
    || !inventoryMatchesBasis(inventory, targetExercise.acceptedInitialLoad.loadBasis)
    || inventory.unit !== targetExercise.acceptedInitialLoad.quantity.entered.unit) {
    throw new Error('Manual recalibration equipment is unavailable in the current profile')
  }
  validateDedicatedPolicy(rawInput, program, compatibility, inventory.equipmentId)

  const currentLoad = {
    equipmentId: targetExercise.acceptedInitialLoad.equipmentId,
    basis: targetExercise.acceptedInitialLoad.loadBasis,
    quantity: targetExercise.acceptedInitialLoad.quantity,
  }
  const assistance = currentLoad.basis === 'machine_assistance'
  const harderDirection = assistance
    ? 'lower_machine_assistance' as const
    : 'higher_resistance_or_external_load' as const
  const options = enumerateEquipmentLoadsWithinBounds(inventory, currentLoad.basis, {
    minimumCanonicalKg: compatibility.minimumCanonicalKg,
    maximumCanonicalKg: compatibility.maximumCanonicalKg,
  }).filter(option => {
    const comparison = compareCanonicalKgDecimals(
      option.quantity.canonicalKg,
      currentLoad.quantity.canonicalKg,
    )
    if (assistance ? comparison >= 0 : comparison <= 0) return false
    return (targetExercise.warmupSets ?? []).every(warmup => {
      const warmupToSelected = compareCanonicalKgDecimals(
        warmup.prescribedLoad.canonicalKg,
        option.quantity.canonicalKg,
      )
      return assistance ? warmupToSelected >= 0 : warmupToSelected <= 0
    })
  }).map((option, optionIndex) => ({
    ...option,
    optionIndex,
    harderDirection,
    confirmation: {
      explicitSelectionRequired: true as const,
      outlierDisposition: outlierDisposition(
        sourceDecision.lastComparableActualLoad.quantity,
        option.quantity,
        assistance,
      ),
    },
  }))

  const sourceBindings = {
    subjectId: program.subjectId,
    assignmentId: program.assignmentId,
    sourceProgramRevisionNumber: program.revisionNumber,
    sourceProgramHash,
    sourceProfileRevisionId: profileRevisionId,
    sourceEligibilityRevisionId: eligibility.sourceRevisionId,
    executionContext: program.executionContext,
    catalogVersion: program.catalogVersion,
    catalogOrigin: program.catalogOrigin,
    target,
    exerciseVersionId: targetExercise.exerciseVersionId,
    priorProgressionSeriesId: targetExercise.progression.progressionSeriesId,
    priorLoadEpoch: targetExercise.progression.loadEpoch,
    sourceDecision,
  }
  const seriesIntent = {
    kind: 'new_series_on_acceptance' as const,
    reason: 'explicit_too_easy_recalibration' as const,
    sourceProgressionSeriesId: targetExercise.progression.progressionSeriesId,
    sourceLoadEpoch: targetExercise.progression.loadEpoch,
    nextLoadEpoch: targetExercise.progression.loadEpoch + 1,
  }
  const common = {
    schemaVersion: 'manual-recalibration-offer.v1' as const,
    sourceBindings,
    currentLoad,
    ...(targetExercise.acceptedInitialLoad.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: targetExercise.acceptedInitialLoad.bodyweightAssistancePolicy }
      : {}),
    seriesIntent,
  }
  return deepFreeze(ManualRecalibrationOfferV1Schema.parse(options.length === 0
    ? { ...common, kind: 'unavailable', status: 'not_offered', reason: 'no_harder_achievable_setting' }
    : { ...common, kind: 'options', status: 'requires_explicit_selection', options }))
}

export function selectManualRecalibrationOption(
  rawOffer: unknown,
  rawSelection: unknown,
): ManualRecalibrationSelectionV1 {
  const offer = ManualRecalibrationOfferV1Schema.parse(rawOffer)
  const selection = SelectManualRecalibrationOptionInputV1Schema.parse(rawSelection)
  if (offer.kind !== 'options') throw new Error('Manual recalibration has no selectable option')
  const selectedOption = offer.options.find(option => option.optionIndex === selection.optionIndex)
  if (!selectedOption) throw new Error('Selected manual recalibration option was not offered')
  return deepFreeze(ManualRecalibrationSelectionV1Schema.parse({
    schemaVersion: 'manual-recalibration-selection.v1',
    status: 'selected_not_applied',
    requestId: selection.requestId,
    sourceBindings: offer.sourceBindings,
    currentLoad: offer.currentLoad,
    ...(offer.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: offer.bodyweightAssistancePolicy }
      : {}),
    selectedOption,
    seriesIntent: offer.seriesIntent,
  }))
}
