import { findNextEquipmentLoad, type EquipmentLoad } from '../equipment'
import { compareLoadIncreaseToRatio, createLoadQuantity } from '../quantity'
import type {
  ProgressionEligibilityAuthorizationV1,
  ProgressionComparatorV1,
  ProgressionReasonV1,
  StrengthActualSetV1,
  StrengthExposureV1,
  StrengthProgressionDecisionV1,
  StrengthProgressionInputV1,
} from './types'
import { hashCanonicalDecisionIdentity } from './identity'
import { parseStrengthProgressionInputV1 } from './validation'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS

function timestamp(value: string): number {
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error('Invalid progression timestamp')
  return result
}

function orderedExposures(exposures: readonly StrengthExposureV1[]): StrengthExposureV1[] {
  return [...exposures].sort((left, right) => {
    const timeDifference = timestamp(left.completedAt ?? left.startedAt) - timestamp(right.completedAt ?? right.startedAt)
    return timeDifference || left.sourceRevisionId.localeCompare(right.sourceRevisionId)
  })
}

function sameRange(left: { min: number; max: number }, right: { min: number; max: number }): boolean {
  return left.min === right.min && left.max === right.max
}

function comparatorMatches(
  comparator: ProgressionComparatorV1,
  input: StrengthProgressionInputV1,
): boolean {
  const prescription = input.prescription
  return comparator.subjectId === input.subjectId
    && comparator.exerciseVersionId === prescription.exerciseVersionId
    && comparator.equipmentId === prescription.equipmentId
    && comparator.loadBasis === prescription.loadBasis
    && comparator.side === prescription.side
    && comparator.rom === prescription.rom
    && comparator.tempo === prescription.tempo
    && comparator.prescribedWorkingSets === prescription.prescribedWorkingSets
    && sameRange(comparator.repRange, prescription.repRange)
    && sameRange(comparator.targetRir, prescription.targetRir)
    && comparator.exposureType === prescription.exposureType
    && comparator.loadEpoch === prescription.loadEpoch
}

function decisionKey(
  input: StrengthProgressionInputV1,
  kind: StrengthProgressionDecisionV1['kind'],
  reason: ProgressionReasonV1,
  sourceIds: readonly string[],
  acknowledgementIds: readonly string[],
  proposalOutcome?: { readonly load: EquipmentLoad; readonly targetReps: readonly number[] },
): string {
  const digest = hashCanonicalDecisionIdentity({
    policyVersion: input.policyVersion,
    executionContext: input.executionContext,
    kind,
    reasonCodes: [reason],
    subjectId: input.subjectId,
    sourceProfileRevisionId: input.sourceProfileRevisionId,
    programRevisionId: input.programRevisionId,
    eligibility: input.eligibility,
    prescription: input.prescription,
    equipmentInventory: input.equipmentInventory,
    sourceExposureRevisionIds: sourceIds,
    sourceAcknowledgementRevisionIds: acknowledgementIds,
    proposal: proposalOutcome,
  })
  return `${input.policyVersion}:sha256:${digest}`
}

function noChange(
  input: StrengthProgressionInputV1,
  kind: 'stop' | 'hold' | 'review' | 'recalibrate',
  reason: ProgressionReasonV1,
  sourceIds: readonly string[] = [],
  acknowledgementIds: readonly string[] = [],
): StrengthProgressionDecisionV1 {
  return {
    kind,
    status: 'not_proposed',
    policyVersion: input.policyVersion,
    executionContext: input.executionContext,
    decisionKey: decisionKey(input, kind, reason, sourceIds, acknowledgementIds),
    subjectId: input.subjectId,
    prescriptionId: input.prescription.prescriptionId,
    exerciseVersionId: input.prescription.exerciseVersionId,
    equipmentId: input.prescription.equipmentId,
    loadBasis: input.prescription.loadBasis,
    programRevisionId: input.programRevisionId,
    sourceProfileRevisionId: input.sourceProfileRevisionId,
    sourceEligibilityRevisionId: input.eligibility.sourceRevisionId,
    loadEpoch: input.prescription.loadEpoch,
    reasonCodes: [reason],
    sourceExposureRevisionIds: [...sourceIds],
    sourceAcknowledgementRevisionIds: [...acknowledgementIds],
  }
}

function proposal(
  input: StrengthProgressionInputV1,
  kind: 'rep_proposal' | 'load_proposal',
  reason: 'one_rep_progression' | 'two_ceiling_successes',
  sourceIds: readonly string[],
  load: EquipmentLoad,
  targetReps: number[],
  acknowledgementIds: readonly string[] = [],
): StrengthProgressionDecisionV1 {
  const proposalOutcome = { load, targetReps }
  return {
    kind,
    status: 'proposed',
    policyVersion: input.policyVersion,
    executionContext: input.executionContext,
    decisionKey: decisionKey(input, kind, reason, sourceIds, acknowledgementIds, proposalOutcome),
    subjectId: input.subjectId,
    prescriptionId: input.prescription.prescriptionId,
    exerciseVersionId: input.prescription.exerciseVersionId,
    equipmentId: input.prescription.equipmentId,
    loadBasis: input.prescription.loadBasis,
    programRevisionId: input.programRevisionId,
    sourceProfileRevisionId: input.sourceProfileRevisionId,
    sourceEligibilityRevisionId: input.eligibility.sourceRevisionId,
    loadEpoch: input.prescription.loadEpoch,
    reasonCodes: [reason],
    sourceExposureRevisionIds: [...sourceIds],
    sourceAcknowledgementRevisionIds: [...acknowledgementIds],
    proposal: proposalOutcome,
  }
}

function authorizationMatches(
  authorization: ProgressionEligibilityAuthorizationV1,
  input: StrengthProgressionInputV1,
  now: number,
): boolean {
  return authorization.subjectId === input.subjectId
    && authorization.exerciseVersionId === input.prescription.exerciseVersionId
    && authorization.programRevisionId === input.programRevisionId
    && authorization.policyVersion === input.eligibility.policyVersion
    && authorization.sourceRevisionId === input.eligibility.sourceRevisionId
    && timestamp(authorization.effectiveFrom) <= now
    && timestamp(authorization.effectiveUntil) >= now
}

function eligibilityDecision(
  input: StrengthProgressionInputV1,
  now: number,
): StrengthProgressionDecisionV1 | null {
  if (input.eligibility.state === 'acute_stop') return noChange(input, 'stop', 'acute_stop')
  if (input.eligibility.scope !== 'supported') {
    return noChange(input, 'stop', 'eligibility_scope_unavailable')
  }
  if (input.eligibility.state === 'eligible_general') {
    const eligibilityEffectiveFrom = timestamp(input.eligibility.effectiveFrom)
    const eligibilityEffectiveUntil = input.eligibility.effectiveUntil === null
      ? null
      : timestamp(input.eligibility.effectiveUntil)
    const sourceIsAvailable = (
      input.executionContext.kind === 'synthetic_simulation'
        ? input.eligibility.source.kind === 'synthetic_fixture'
        : input.eligibility.source.kind !== 'synthetic_fixture'
    ) && eligibilityEffectiveFrom <= now
      && (eligibilityEffectiveUntil === null || eligibilityEffectiveUntil >= now)
      && input.eligibility.supersededAt === null
    return sourceIsAvailable ? null : noChange(input, 'stop', 'eligibility_source_unavailable')
  }
  if (input.eligibility.state === 'unanswered') return noChange(input, 'stop', 'eligibility_unanswered')
  if (input.eligibility.state === 'needs_clinical_review') {
    return noChange(input, 'review', 'eligibility_review_required')
  }

  const authorization = input.eligibilityAuthorization
  if (!authorization || !authorizationMatches(authorization, input, now)) {
    return noChange(input, 'review', 'eligibility_constraints_unavailable')
  }
  if (authorization.decision === 'blocked') return noChange(input, 'review', 'eligibility_constraints_blocked')
  return noChange(input, 'review', 'eligibility_constraints_unavailable')
}

function workingSets(exposure: StrengthExposureV1): StrengthActualSetV1[] {
  return exposure.sets.filter(set => set.kind === 'working').sort((left, right) => left.ordinal - right.ordinal)
}

function loadIsCanonical(load: EquipmentLoad, input: StrengthProgressionInputV1): boolean {
  try {
    const recreated = createLoadQuantity(load.quantity.entered)
    return recreated.canonicalKg === load.quantity.canonicalKg
      && load.equipmentId === input.prescription.equipmentId
      && load.basis === input.prescription.loadBasis
      && load.quantity.entered.unit === input.equipmentInventory.unit
  } catch {
    return false
  }
}

function hasValidWorkingSets(sets: readonly StrengthActualSetV1[], input: StrengthProgressionInputV1): boolean {
  if (sets.length !== input.prescription.prescribedWorkingSets) return false
  if (new Set(sets.map(set => set.ordinal)).size !== sets.length) return false
  return sets.every(set => Number.isInteger(set.ordinal)
    && Number.isInteger(set.actualReps)
    && set.actualReps >= 1
    && set.actualReps <= 100
    && (set.actualRir === 'unknown'
      || set.actualRir === '6_plus'
      || (Number.isInteger(set.actualRir) && set.actualRir >= 0 && set.actualRir <= 5))
    && loadIsCanonical(set.load, input))
}

function sameWorkingLoad(sets: readonly StrengthActualSetV1[]): boolean {
  if (sets.length === 0) return false
  const first = sets[0].load
  return sets.every(set => set.load.equipmentId === first.equipmentId
    && set.load.basis === first.basis
    && set.load.quantity.entered.unit === first.quantity.entered.unit
    && set.load.quantity.canonicalKg === first.quantity.canonicalKg)
}

function isDifficult(sets: readonly StrengthActualSetV1[], input: StrengthProgressionInputV1): boolean {
  return sets.some(set => set.actualReps < input.prescription.repRange.min
    || (typeof set.actualRir === 'number' && set.actualRir < input.prescription.targetRir.min))
}

function isComparableCompleted(exposure: StrengthExposureV1, input: StrengthProgressionInputV1): boolean {
  if (exposure.provenance.kind !== 'in_app'
    || (exposure.sessionState !== 'completed' && exposure.sessionState !== 'completed_with_omissions')
    || exposure.exerciseState !== 'completed'
    || exposure.syncState !== 'acknowledged'
    || !comparatorMatches(exposure.comparator, input)) return false
  const sets = workingSets(exposure)
  return hasValidWorkingSets(sets, input)
    && sameWorkingLoad(sets)
    && sets.every(set => set.validity === 'valid' && set.symptom === 'none')
}

function samePerformedLoad(left: StrengthExposureV1, right: StrengthExposureV1): boolean {
  return workingSets(left)[0].load.quantity.canonicalKg === workingSets(right)[0].load.quantity.canonicalKg
}

function sameExactLoad(left: EquipmentLoad, right: EquipmentLoad): boolean {
  return left.equipmentId === right.equipmentId
    && left.basis === right.basis
    && left.quantity.entered.unit === right.quantity.entered.unit
    && left.quantity.canonicalKg === right.quantity.canonicalKg
}

function outlierIsAcknowledged(latest: StrengthExposureV1, prior: StrengthExposureV1): boolean {
  const acknowledgement = latest.outlierAcknowledgement
  return acknowledgement !== undefined
    && acknowledgement.priorExposureRevisionId === prior.sourceRevisionId
    && acknowledgement.actualExposureRevisionId === latest.sourceRevisionId
}

function acceptedComparableHistory(
  exposures: readonly StrengthExposureV1[],
  input: StrengthProgressionInputV1,
): StrengthExposureV1[] {
  const accepted: StrengthExposureV1[] = []
  for (const exposure of exposures) {
    if (!isComparableCompleted(exposure, input)) continue
    const performedLoad = workingSets(exposure)[0].load
    if (!sameExactLoad(performedLoad, exposure.acceptedPrescription.load)) continue

    const prior = accepted.at(-1)
    if (!prior) {
      accepted.push(exposure)
      continue
    }
    const comparison = compareLoadIncreaseToRatio(
      workingSets(prior)[0].load.quantity,
      performedLoad.quantity,
      { numerator: 1, denominator: 5 },
    )
    if (comparison === 'within_limit'
      || comparison === 'not_increase'
      || (comparison === 'exceeds_limit' && outlierIsAcknowledged(exposure, prior))) {
      accepted.push(exposure)
    }
  }
  return accepted
}

function allAtCeiling(sets: readonly StrengthActualSetV1[], input: StrengthProgressionInputV1): boolean {
  return sets.every(set => set.actualReps === input.prescription.repRange.max
    && typeof set.actualRir === 'number'
    && set.actualRir >= input.prescription.targetRir.min)
}

function allInRangeAtAcceptableEffort(
  sets: readonly StrengthActualSetV1[],
  input: StrengthProgressionInputV1,
): boolean {
  return sets.every(set => set.actualReps >= input.prescription.repRange.min
    && set.actualReps <= input.prescription.repRange.max
    && typeof set.actualRir === 'number'
    && set.actualRir >= input.prescription.targetRir.min)
}

export function decideStrengthProgression(rawInput: unknown): StrengthProgressionDecisionV1 {
  const input = parseStrengthProgressionInputV1(rawInput)
  const now = timestamp(input.now)
  const eligibility = eligibilityDecision(input, now)
  if (eligibility) return eligibility

  const exposures = orderedExposures(input.exposures.filter(exposure => exposure.provenance.kind === 'in_app'))
  const latest = exposures.at(-1)
  if (!latest) return noChange(input, 'recalibrate', 'calibration_required')

  const latestSets = workingSets(latest)
  if (latestSets.some(set => set.symptom === 'adverse')) {
    return noChange(input, 'hold', 'adverse_symptom_hold', [latest.sourceRevisionId])
  }
  const startedAt = timestamp(latest.startedAt)
  if (latest.sessionState === 'in_progress') {
    const isStale = now - startedAt > DAY_MS
    return noChange(input, isStale ? 'review' : 'hold', isStale ? 'stale_session_review' : 'session_in_progress_hold', [latest.sourceRevisionId])
  }
  if (latest.sessionState === 'aborted') {
    return noChange(input, 'hold', 'session_aborted_hold', [latest.sourceRevisionId])
  }
  if (latest.exerciseState === 'incomplete' || latest.exerciseState === 'omitted') {
    return noChange(input, 'hold', 'exercise_incomplete_hold', [latest.sourceRevisionId])
  }
  if (latest.exerciseState === 'aborted') {
    return noChange(input, 'hold', 'exercise_aborted_hold', [latest.sourceRevisionId])
  }
  if (latest.syncState === 'pending') return noChange(input, 'hold', 'sync_pending_hold', [latest.sourceRevisionId])
  if (latest.syncState === 'conflicted') return noChange(input, 'hold', 'sync_conflict_hold', [latest.sourceRevisionId])

  const latestCompletedAt = latest.completedAt === null ? null : timestamp(latest.completedAt)
  if (latestCompletedAt === null) return noChange(input, 'hold', 'exercise_incomplete_hold', [latest.sourceRevisionId])
  const latestComparatorMatches = comparatorMatches(latest.comparator, input)

  if (!hasValidWorkingSets(latestSets, input)) {
    return noChange(input, 'hold', 'invalid_log_hold', [latest.sourceRevisionId])
  }
  if (latestSets.some(set => set.validity === 'invalid')) {
    return noChange(input, 'hold', 'invalid_log_hold', [latest.sourceRevisionId])
  }
  const hasOneWorkingLoad = sameWorkingLoad(latestSets)
  const acceptedHistory = acceptedComparableHistory(exposures.slice(0, -1), input)
  const priorComparable = acceptedHistory.at(-1)
  const performedLoad = latestSets[0].load
  let acknowledgementIds: string[] = []
  let decisionSourceIds = [latest.sourceRevisionId]
  const performedDiffersFromPrescription = hasOneWorkingLoad
    && !sameExactLoad(performedLoad, input.prescription.prescribedLoad)
  let requiresCalibration = performedDiffersFromPrescription
  if (hasOneWorkingLoad && (priorComparable || performedDiffersFromPrescription)) {
    const outlierComparison = compareLoadIncreaseToRatio(
      priorComparable ? workingSets(priorComparable)[0].load.quantity : null,
      performedLoad.quantity,
      { numerator: 1, denominator: 5 },
    )
    if (priorComparable && (performedDiffersFromPrescription || outlierComparison === 'exceeds_limit')) {
      decisionSourceIds = [priorComparable.sourceRevisionId, latest.sourceRevisionId]
    }
    requiresCalibration = requiresCalibration || outlierComparison === 'calibration_required'
    if (outlierComparison === 'exceeds_limit'
      && (!priorComparable || !outlierIsAcknowledged(latest, priorComparable))) {
      return noChange(input, 'hold', 'unconfirmed_outlier_hold', decisionSourceIds)
    }
    if (outlierComparison === 'exceeds_limit' && latest.outlierAcknowledgement) {
      acknowledgementIds = [latest.outlierAcknowledgement.sourceRevisionId]
    }
  }
  if (latestSets.some(set => set.actualRir === 'unknown')) {
    return noChange(input, 'hold', 'effort_unknown_hold', decisionSourceIds, acknowledgementIds)
  }
  if (latestSets.some(set => set.actualRir === '6_plus')) {
    return noChange(input, 'recalibrate', 'effort_too_easy_recalibration', decisionSourceIds, acknowledgementIds)
  }
  if (!hasOneWorkingLoad) {
    return noChange(input, 'review', 'mixed_working_load_review', [latest.sourceRevisionId])
  }
  if (requiresCalibration) {
    return noChange(input, 'recalibrate', 'calibration_required', decisionSourceIds, acknowledgementIds)
  }
  if (latestComparatorMatches && now - latestCompletedAt >= 14 * DAY_MS) {
    return noChange(input, 'review', 'return_after_gap_review', decisionSourceIds, acknowledgementIds)
  }
  if (!latestComparatorMatches) {
    return noChange(input, 'recalibrate', 'comparator_changed_recalibration', decisionSourceIds, acknowledgementIds)
  }

  const comparable = [...acceptedHistory, latest]
  if (isDifficult(latestSets, input)) {
    const previous = comparable.at(-2)
    const isRepeated = previous !== undefined
      && samePerformedLoad(previous, latest)
      && isDifficult(workingSets(previous), input)
    return noChange(
      input,
      isRepeated ? 'review' : 'hold',
      isRepeated ? 'repeated_difficult_exposure_review' : 'difficult_exposure_hold',
      isRepeated ? [previous.sourceRevisionId, latest.sourceRevisionId] : decisionSourceIds,
      acknowledgementIds,
    )
  }

  if (allInRangeAtAcceptableEffort(latestSets, input)
    && latestSets.some(set => set.actualReps < input.prescription.repRange.max)) {
    const targetReps = latestSets.map(set => set.actualReps)
    const firstBelowCeiling = targetReps.findIndex(reps => reps < input.prescription.repRange.max)
    targetReps[firstBelowCeiling] += 1
    return proposal(
      input,
      'rep_proposal',
      'one_rep_progression',
      decisionSourceIds,
      latestSets[0].load,
      targetReps,
      acknowledgementIds,
    )
  }

  if (allAtCeiling(latestSets, input)) {
    const previous = comparable.at(-2)
    if (!previous || !samePerformedLoad(previous, latest) || !allAtCeiling(workingSets(previous), input)) {
      return noChange(input, 'hold', 'insufficient_same_load_evidence_hold', [latest.sourceRevisionId], acknowledgementIds)
    }
    const nextLoad = findNextEquipmentLoad(latestSets[0].load, input.equipmentInventory)
    if (!nextLoad) {
      return noChange(input, 'hold', 'no_achievable_increment_within_cap', [previous.sourceRevisionId, latest.sourceRevisionId], acknowledgementIds)
    }
    return proposal(
      input,
      'load_proposal',
      'two_ceiling_successes',
      [previous.sourceRevisionId, latest.sourceRevisionId],
      nextLoad,
      Array.from({ length: input.prescription.prescribedWorkingSets }, () => input.prescription.repRange.min),
      acknowledgementIds,
    )
  }

  return noChange(input, 'hold', 'valid_state_hold', [latest.sourceRevisionId], acknowledgementIds)
}
