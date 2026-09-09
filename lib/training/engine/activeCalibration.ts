import { z } from 'zod'
import {
  TrainingCatalogV1Schema,
  type EquipmentCompatibilityV1,
  type TrainingCatalogOriginV1,
  type TrainingCatalogV1,
} from '../catalog/types'
import {
  ActiveCalibrationOfferV1Schema,
  ActiveCalibrationSelectionV1Schema,
  ActiveCalibrationTargetV1Schema,
  SelectActiveCalibrationOptionInputV1Schema,
  type ActiveCalibrationOfferV1,
  type ActiveCalibrationSelectionV1,
  type ActiveCalibrationTargetV1,
} from '../contracts/active-calibration'
import {
  BodyweightAssistanceProgressionPolicyV1Schema,
  type BodyweightAssistancePolicyRegistryV1,
} from '../contracts/bodyweight-assistance'
import { EligibilitySnapshotV1Schema, type EligibilitySnapshotV1 } from '../contracts/eligibility'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from '../contracts/profile'
import {
  TrainingProgramRevisionV1Schema,
  catalogOriginMatchesExecutionContext,
  catalogOriginsMatch,
  type TrainingProgramRevisionV1,
} from '../contracts/program'
import { enumerateEquipmentLoadsWithinBounds } from '../equipment'
import { compareCanonicalKgDecimals } from '../quantity'

export interface ActiveCalibrationCatalogRegistryV1 {
  readonly resolve: (
    catalogVersion: string,
    catalogOrigin: TrainingCatalogOriginV1,
  ) => unknown | null
}

export interface BuildActiveCalibrationInputV1 {
  readonly program: TrainingProgramRevisionV1
  /** Canonical hash read with the immutable program revision by the server. */
  readonly sourceProgramHash: string
  readonly currentProfileRevisionId: string
  readonly currentProfile: AthleteTrainingProfileV1
  readonly currentEligibility: EligibilitySnapshotV1
  /** Server evaluation time; client clocks are not authoritative. */
  readonly evaluatedAt: string
  /** Server projection of the next pending, unprescribed target. */
  readonly target: ActiveCalibrationTargetV1
  readonly catalogRegistry: ActiveCalibrationCatalogRegistryV1
  readonly bodyweightAssistancePolicyRegistry?: BodyweightAssistancePolicyRegistryV1
}

function assertCurrentEligibility(
  eligibility: EligibilitySnapshotV1,
  evaluatedAt: string,
  program: TrainingProgramRevisionV1,
): void {
  if (eligibility.sourceRevisionId !== program.eligibilitySourceRevisionId) {
    throw new Error('Active calibration eligibility source is stale')
  }
  if (eligibility.state !== 'eligible_general' || eligibility.scope !== 'supported') {
    throw new Error('Active calibration eligibility is unavailable')
  }
  const now = Date.parse(evaluatedAt)
  if (Date.parse(eligibility.effectiveFrom) > now
    || (eligibility.effectiveUntil !== null && Date.parse(eligibility.effectiveUntil) < now)
    || (eligibility.supersededAt !== null && Date.parse(eligibility.supersededAt) <= now)) {
    throw new Error('Active calibration eligibility is not current')
  }
  if (program.executionContext.kind === 'live') {
    if (eligibility.source.kind === 'synthetic_fixture') {
      throw new Error('Synthetic eligibility cannot authorize live active calibration')
    }
    return
  }
  if (eligibility.source.kind !== 'synthetic_fixture'
    || eligibility.source.fixtureId !== program.executionContext.fixtureId) {
    throw new Error('Active calibration synthetic eligibility context does not match')
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

function compatibilityMatches(
  compatibility: EquipmentCompatibilityV1,
  load: TrainingProgramRevisionV1['sessions'][number]['exercises'][number]['acceptedInitialLoad'],
): boolean {
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
  basis: TrainingProgramRevisionV1['sessions'][number]['exercises'][number]['acceptedInitialLoad']['loadBasis'],
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
  input: BuildActiveCalibrationInputV1,
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
    throw new Error('Active calibration policy is unavailable')
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
  )) throw new Error('Active assistance calibration is outside the reviewed machine range')
}

export function buildActiveCalibrationOffer(
  rawInput: BuildActiveCalibrationInputV1,
): ActiveCalibrationOfferV1 {
  const program = TrainingProgramRevisionV1Schema.parse(rawInput.program)
  const profile = AthleteTrainingProfileV1Schema.parse(rawInput.currentProfile)
  const currentEligibility = EligibilitySnapshotV1Schema.parse(rawInput.currentEligibility)
  const target = ActiveCalibrationTargetV1Schema.parse(rawInput.target)
  const evaluatedAt = z.string().datetime({ offset: true }).parse(rawInput.evaluatedAt)
  const sourceProgramHash = z.string().regex(/^[a-f0-9]{64}$/).parse(rawInput.sourceProgramHash)
  const currentProfileRevisionId = z.string().trim().min(1).max(128).parse(rawInput.currentProfileRevisionId)
  if (program.profileRevisionId !== currentProfileRevisionId) {
    throw new Error('Active calibration profile is stale')
  }
  assertCurrentEligibility(currentEligibility, evaluatedAt, program)

  const session = program.sessions.find(item => item.sessionId === target.sessionId)
  const matches = session?.exercises.filter(item => item.exerciseInstanceId === target.exerciseInstanceId) ?? []
  if (!session || matches.length !== 1) throw new Error('Active calibration target is missing or ambiguous')
  const exercise = matches[0]
  if (!exercise.progression) throw new Error('Active calibration target lacks authored progression metadata')
  if (exercise.progression.loadEpoch === Number.MAX_SAFE_INTEGER) throw new Error('Active calibration load epoch is exhausted')

  const rawCatalog = rawInput.catalogRegistry.resolve(program.catalogVersion, program.catalogOrigin)
  const parsedCatalog = TrainingCatalogV1Schema.safeParse(rawCatalog)
  if (!parsedCatalog.success
    || parsedCatalog.data.catalogVersion !== program.catalogVersion
    || !catalogOriginsMatch(parsedCatalog.data.origin, program.catalogOrigin)
    || !catalogOriginMatchesExecutionContext(parsedCatalog.data.origin, program.executionContext)) {
    throw new Error('Active calibration catalog is unavailable')
  }
  const catalog: TrainingCatalogV1 = parsedCatalog.data
  const catalogExercises = catalog.exercises.filter(item => item.exerciseVersionId === exercise.exerciseVersionId)
  if (catalogExercises.length !== 1) throw new Error('Active calibration exercise is not catalog-attested')
  const compatibility = catalogExercises[0].equipmentCompatibility.find(item => (
    compatibilityMatches(item, exercise.acceptedInitialLoad)
  ))
  if (!compatibility) throw new Error('Active calibration load is not catalog-attested')

  const inventory = profile.equipmentInventory.find(item => (
    item.equipmentId === exercise.acceptedInitialLoad.equipmentId
  ))
  if (!inventory
    || !inventoryMatchesBasis(inventory, exercise.acceptedInitialLoad.loadBasis)
    || inventory.unit !== exercise.acceptedInitialLoad.quantity.entered.unit) {
    throw new Error('Active calibration equipment is unavailable in the current profile')
  }
  validateDedicatedPolicy(rawInput, program, compatibility, inventory.equipmentId)

  const currentLoad = {
    equipmentId: exercise.acceptedInitialLoad.equipmentId,
    basis: exercise.acceptedInitialLoad.loadBasis,
    quantity: exercise.acceptedInitialLoad.quantity,
  }
  const easierDirection = currentLoad.basis === 'machine_assistance'
    ? 'higher_machine_assistance' as const
    : 'lower_resistance_or_external_load' as const
  const options = enumerateEquipmentLoadsWithinBounds(inventory, currentLoad.basis, {
    minimumCanonicalKg: compatibility.minimumCanonicalKg,
    maximumCanonicalKg: compatibility.maximumCanonicalKg,
  }).filter(option => {
    const comparison = compareCanonicalKgDecimals(
      option.quantity.canonicalKg,
      currentLoad.quantity.canonicalKg,
    )
    if (easierDirection === 'higher_machine_assistance' ? comparison <= 0 : comparison >= 0) {
      return false
    }
    return (exercise.warmupSets ?? []).every(warmup => {
      const warmupToSelected = compareCanonicalKgDecimals(
        warmup.prescribedLoad.canonicalKg,
        option.quantity.canonicalKg,
      )
      return easierDirection === 'higher_machine_assistance'
        ? warmupToSelected >= 0
        : warmupToSelected <= 0
    })
  }).map((option, optionIndex) => ({ ...option, optionIndex, easierDirection }))

  const sourceBindings = {
    subjectId: program.subjectId,
    assignmentId: program.assignmentId,
    sourceProgramRevisionNumber: program.revisionNumber,
    sourceProgramHash,
    sourceProfileRevisionId: currentProfileRevisionId,
    sourceEligibilityRevisionId: currentEligibility.sourceRevisionId,
    executionContext: program.executionContext,
    catalogVersion: program.catalogVersion,
    catalogOrigin: program.catalogOrigin,
    target,
    exerciseVersionId: exercise.exerciseVersionId,
    priorProgressionSeriesId: exercise.progression.progressionSeriesId,
    priorLoadEpoch: exercise.progression.loadEpoch,
  }
  const seriesIntent = {
    kind: 'new_series_on_acceptance' as const,
    reason: 'explicit_familiarization' as const,
    sourceProgressionSeriesId: exercise.progression.progressionSeriesId,
    sourceLoadEpoch: exercise.progression.loadEpoch,
    nextLoadEpoch: exercise.progression.loadEpoch + 1,
  }
  const common = {
    schemaVersion: 'active-calibration-offer.v1' as const,
    sourceBindings,
    currentLoad,
    ...(exercise.acceptedInitialLoad.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: exercise.acceptedInitialLoad.bodyweightAssistancePolicy }
      : {}),
    seriesIntent,
  }
  return deepFreeze(ActiveCalibrationOfferV1Schema.parse(options.length === 0
    ? { ...common, kind: 'unavailable', status: 'not_offered', reason: 'no_easier_achievable_setting' }
    : { ...common, kind: 'options', status: 'requires_explicit_selection', options }))
}

export function selectActiveCalibrationOption(
  rawOffer: unknown,
  rawSelection: unknown,
): ActiveCalibrationSelectionV1 {
  const offer = ActiveCalibrationOfferV1Schema.parse(rawOffer)
  const selection = SelectActiveCalibrationOptionInputV1Schema.parse(rawSelection)
  if (offer.kind !== 'options') throw new Error('Active calibration has no selectable option')
  const selectedOption = offer.options.find(option => option.optionIndex === selection.optionIndex)
  if (!selectedOption) throw new Error('Selected active calibration option was not offered')
  return deepFreeze(ActiveCalibrationSelectionV1Schema.parse({
    schemaVersion: 'active-calibration-selection.v1',
    status: 'selected_not_applied',
    requestId: selection.requestId,
    sourceBindings: offer.sourceBindings,
    ...(offer.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: offer.bodyweightAssistancePolicy }
      : {}),
    selectedOption,
    seriesIntent: offer.seriesIntent,
  }))
}
