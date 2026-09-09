import { compareCanonicalKgDecimals } from '../quantity'
import {
  BodyweightAssistanceBenchmarkV1Schema,
  BodyweightAssistanceExposureV1Schema,
  BodyweightAssistancePolicyReferenceV1Schema,
  BodyweightAssistanceProgressionDecisionV1Schema,
  BodyweightAssistanceProgressionPolicyV1Schema,
  BodyweightAssistanceTargetV1Schema,
  type BodyweightAssistanceBenchmarkV1,
  type BodyweightAssistanceExecutionContextV1,
  type BodyweightAssistanceExposureV1,
  type BodyweightAssistanceLoadV1,
  type BodyweightAssistancePolicyReferenceV1,
  type BodyweightAssistanceProgressionDecisionV1,
  type BodyweightAssistanceProgressionPolicyV1,
  type BodyweightAssistancePolicyRegistryV1,
  type BodyweightAssistanceTargetV1,
} from '../contracts/bodyweight-assistance'
import { ExecutionContextV1Schema } from '../contracts/program'

export type BodyweightAssistancePolicyRegistry = BodyweightAssistancePolicyRegistryV1

export interface BuildBodyweightAssistanceProgressionInput {
  readonly executionContext: BodyweightAssistanceExecutionContextV1
  readonly policyReference: BodyweightAssistancePolicyReferenceV1
  readonly benchmark: BodyweightAssistanceBenchmarkV1
  readonly currentTarget: BodyweightAssistanceTargetV1
  readonly latestExposure: BodyweightAssistanceExposureV1
  readonly registry: BodyweightAssistancePolicyRegistry
}

function quantityFor(load: BodyweightAssistanceLoadV1) {
  return load.loadBasis === 'bodyweight_external' ? load.externalLoad : load.assistance
}

function loadsMatch(left: BodyweightAssistanceLoadV1, right: BodyweightAssistanceLoadV1): boolean {
  const leftQuantity = quantityFor(left)
  const rightQuantity = quantityFor(right)
  return left.loadBasis === right.loadBasis
    && left.equipmentId === right.equipmentId
    && leftQuantity.entered.value === rightQuantity.entered.value
    && leftQuantity.entered.unit === rightQuantity.entered.unit
    && leftQuantity.canonicalKg === rightQuantity.canonicalKg
}

function benchmarksMatch(
  left: BodyweightAssistanceBenchmarkV1,
  right: BodyweightAssistanceBenchmarkV1,
): boolean {
  return left.exerciseVersionId === right.exerciseVersionId
    && left.equipmentId === right.equipmentId
    && left.loadBasis === right.loadBasis
    && left.side === right.side
    && left.rom === right.rom
    && left.tempo === right.tempo
    && left.exposureType === right.exposureType
    && left.workingSetCount === right.workingSetCount
    && left.repRange.minimum === right.repRange.minimum
    && left.repRange.maximum === right.repRange.maximum
    && left.targetRir.minimum === right.targetRir.minimum
    && left.targetRir.maximum === right.targetRir.maximum
    && left.policyId === right.policyId
    && left.policyVersion === right.policyVersion
}

function policyMatchesContext(
  policy: BodyweightAssistanceProgressionPolicyV1,
  context: BodyweightAssistanceExecutionContextV1,
): boolean {
  if (context.kind === 'live') return policy.provenance.kind === 'reviewed_authored_policy'
  return policy.provenance.kind === 'synthetic_fixture'
    && policy.provenance.fixtureId === context.fixtureId
    && policy.provenance.fixtureHash === context.fixtureHash
    && policy.provenance.label === context.label
}

function assistanceWithinRange(
  load: BodyweightAssistanceLoadV1,
  policy: BodyweightAssistanceProgressionPolicyV1,
): boolean {
  if (policy.loadBasis !== 'machine_assistance') return load.loadBasis === 'bodyweight_external'
  if (load.loadBasis !== 'machine_assistance'
    || load.equipmentId !== policy.supportedAssistanceRange.equipmentId) return false
  return compareCanonicalKgDecimals(
    load.assistance.canonicalKg,
    policy.supportedAssistanceRange.minimum.canonicalKg,
  ) >= 0 && compareCanonicalKgDecimals(
    load.assistance.canonicalKg,
    policy.supportedAssistanceRange.maximum.canonicalKg,
  ) <= 0
}

function decision(
  input: BuildBodyweightAssistanceProgressionInput,
  kind: 'hold' | 'review' | 'recalibrate',
  reason: Exclude<BodyweightAssistanceProgressionDecisionV1, { status: 'proposed' }>['reason'],
): BodyweightAssistanceProgressionDecisionV1 {
  return Object.freeze(BodyweightAssistanceProgressionDecisionV1Schema.parse({
    schemaVersion: 'bodyweight-assistance-progression-decision.v1',
    kind, status: 'not_proposed',
    policyId: input.policyReference.policyId,
    policyVersion: input.policyReference.policyVersion,
    sourceExposureRevisionId: input.latestExposure.sourceExposureRevisionId,
    reason,
  }))
}

export function buildBodyweightAssistanceProgression(
  rawInput: BuildBodyweightAssistanceProgressionInput,
): BodyweightAssistanceProgressionDecisionV1 {
  const input = {
    ...rawInput,
    executionContext: ExecutionContextV1Schema.parse(rawInput.executionContext),
    policyReference: BodyweightAssistancePolicyReferenceV1Schema.parse(rawInput.policyReference),
    benchmark: BodyweightAssistanceBenchmarkV1Schema.parse(rawInput.benchmark),
    currentTarget: BodyweightAssistanceTargetV1Schema.parse(rawInput.currentTarget),
    latestExposure: BodyweightAssistanceExposureV1Schema.parse(rawInput.latestExposure),
  }
  const resolved = rawInput.registry.resolve(input.policyReference, input.executionContext)
  const parsedPolicy = BodyweightAssistanceProgressionPolicyV1Schema.safeParse(resolved)
  if (!parsedPolicy.success
    || parsedPolicy.data.policyId !== input.policyReference.policyId
    || parsedPolicy.data.policyVersion !== input.policyReference.policyVersion
    || !policyMatchesContext(parsedPolicy.data, input.executionContext)) {
    return decision(input, 'hold', 'policy_unavailable_hold')
  }
  const policy = parsedPolicy.data
  if (input.benchmark.policyId !== policy.policyId
    || input.benchmark.policyVersion !== policy.policyVersion
    || input.benchmark.loadBasis !== policy.loadBasis
    || input.currentTarget.load.loadBasis !== input.benchmark.loadBasis
    || input.currentTarget.load.equipmentId !== input.benchmark.equipmentId
    || !benchmarksMatch(input.benchmark, input.latestExposure.benchmark)
    || input.latestExposure.sets.some(set => !loadsMatch(set.load, input.currentTarget.load))) {
    return decision(input, 'recalibrate', 'benchmark_changed_recalibration')
  }
  if (!assistanceWithinRange(input.currentTarget.load, policy)
    || input.latestExposure.sets.some(set => !assistanceWithinRange(set.load, policy))) {
    return decision(input, 'recalibrate', 'assistance_range_recalibration')
  }
  if (input.latestExposure.sets.some(set => set.symptomState === 'adverse_reported')) {
    return decision(input, 'review', 'adverse_symptom_review')
  }
  const orderedSets = [...input.latestExposure.sets].sort((left, right) => (
    left.setOrdinal - right.setOrdinal
  ))
  if (!input.latestExposure.isComplete
    || orderedSets.length !== input.benchmark.workingSetCount
    || input.currentTarget.targetReps.length !== input.benchmark.workingSetCount
    || orderedSets.some((set, index) => set.setOrdinal !== index + 1)) {
    return decision(input, 'hold', 'incomplete_exposure_hold')
  }
  if (orderedSets.some(set => set.rir === 'unknown')) {
    return decision(input, 'hold', 'effort_unknown_hold')
  }
  if (orderedSets.some(set => set.rir === '6_plus')) {
    return decision(input, 'recalibrate', 'effort_too_easy_recalibration')
  }
  if (orderedSets.some(set => (
    set.reps < input.benchmark.repRange.minimum
    || (typeof set.rir === 'number' && set.rir < input.benchmark.targetRir.minimum)
  ))) {
    return decision(input, 'hold', 'below_range_or_target_effort_hold')
  }
  if (orderedSets.some(set => set.reps > input.benchmark.repRange.maximum)
    || orderedSets.every(set => set.reps === input.benchmark.repRange.maximum)) {
    return decision(input, 'review', 'benchmark_ceiling_review')
  }
  const targetReps = orderedSets.map(set => set.reps)
  const nextIndex = targetReps.findIndex(reps => reps < input.benchmark.repRange.maximum)
  if (nextIndex < 0) return decision(input, 'hold', 'valid_state_hold')
  targetReps[nextIndex] += 1
  return Object.freeze(BodyweightAssistanceProgressionDecisionV1Schema.parse({
    schemaVersion: 'bodyweight-assistance-progression-decision.v1',
    kind: 'rep_proposal', status: 'proposed',
    policyId: policy.policyId, policyVersion: policy.policyVersion,
    sourceExposureRevisionId: input.latestExposure.sourceExposureRevisionId,
    reason: 'one_rep_progression', loadChange: 'none',
    preservedLoad: input.currentTarget.load, targetReps,
  }))
}
