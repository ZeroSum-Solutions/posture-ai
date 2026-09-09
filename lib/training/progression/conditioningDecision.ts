import {
  ConditioningProgressionDecisionV1Schema,
  ConditioningProgressionInputV1Schema,
  type ConditioningProgressionDecisionV1,
  type ConditioningProgressionInputV1,
} from '../contracts/conditioning-progression'
import { hashCanonicalDecisionIdentity } from './identity'

type HoldReason = Extract<ConditioningProgressionDecisionV1, { status: 'not_proposed' }>['reason']

function orderedSources(input: ConditioningProgressionInputV1) {
  return [...input.sourceBouts].sort((left, right) => (
    left.scheduledLocalDate.localeCompare(right.scheduledLocalDate)
      || left.sessionId.localeCompare(right.sessionId)
  ))
}

function sourceRevisions(input: ConditioningProgressionInputV1) {
  return orderedSources(input).flatMap(source => source.actual ? [{
    sessionId: source.sessionId,
    sessionRevision: source.sessionRevision,
    conditioningEventRevision: source.actual.eventRevision,
  }] : [])
}

function decisionKey(
  input: ConditioningProgressionInputV1,
  outcome: { readonly kind: 'hold'; readonly reason: HoldReason }
    | { readonly kind: 'duration_proposal'; readonly increaseSecondsPerBout: number; readonly targets: readonly unknown[] },
): string {
  return `conditioning-duration-v1:sha256:${hashCanonicalDecisionIdentity({
    schemaVersion: input.schemaVersion,
    subjectId: input.subjectId,
    assignmentId: input.assignmentId,
    assignmentRevision: input.assignmentRevision,
    baseProgramRevisionNumber: input.baseProgramRevisionNumber,
    sourceProfileRevision: input.sourceProfileRevision,
    sourceEligibilityRevisionId: input.sourceEligibilityRevisionId,
    executionContext: input.executionContext,
    policy: input.policy,
    sourceBouts: orderedSources(input),
    targetBouts: [...input.targetBouts].sort((left, right) => (
      left.scheduledLocalDate.localeCompare(right.scheduledLocalDate)
        || left.sessionId.localeCompare(right.sessionId)
    )),
    plannedWeeklyDurationSeconds: input.plannedWeeklyDurationSeconds,
    outcome,
  })}`
}

function audit(input: ConditioningProgressionInputV1) {
  return {
    policyVersion: input.policy.policyVersion,
    policyOrigin: input.policy.origin,
    subjectId: input.subjectId,
    assignmentId: input.assignmentId,
    baseProgramRevisionNumber: input.baseProgramRevisionNumber,
    sourceProfileRevision: input.sourceProfileRevision,
    sourceEligibilityRevisionId: input.sourceEligibilityRevisionId,
    executionContext: input.executionContext,
    modalityId: input.policy.modalityId,
    targetEffortMaximum: input.policy.targetEffortMaximum,
    sourceSessionRevisions: sourceRevisions(input),
  }
}

function hold(input: ConditioningProgressionInputV1, reason: HoldReason): ConditioningProgressionDecisionV1 {
  return ConditioningProgressionDecisionV1Schema.parse({
    kind: 'hold', status: 'not_proposed', reason,
    ...audit(input),
    decisionKey: decisionKey(input, { kind: 'hold', reason }),
  })
}

export function decideConditioningProgression(rawInput: unknown): ConditioningProgressionDecisionV1 {
  const input = ConditioningProgressionInputV1Schema.parse(rawInput)
  const sources = orderedSources(input)
  if (sources.some(source => !['completed', 'completed_with_omissions'].includes(source.sessionState)
    || source.actual === null)) {
    return hold(input, 'source_incomplete_hold')
  }
  if (sources.some(source => source.modalityId !== input.policy.modalityId)
    || input.targetBouts.some(target => target.modalityId !== input.policy.modalityId)) {
    return hold(input, 'modality_changed_recalibration')
  }
  const actuals = sources.map(source => source.actual!)
  if (actuals.some(actual => actual.symptomState === 'adverse_reported')) {
    return hold(input, 'adverse_symptom_hold')
  }
  if (actuals.some(actual => actual.perceivedEffort === 'unknown')) {
    return hold(input, 'effort_unknown_hold')
  }
  if (actuals.some(actual => typeof actual.perceivedEffort === 'number'
    && actual.perceivedEffort > input.policy.targetEffortMaximum)) {
    return hold(input, 'effort_above_target_hold')
  }

  const priorCompletedSeconds = actuals.reduce((sum, actual) => sum + actual.durationSeconds, 0)
  const ratioStepSeconds = Math.min(
    input.policy.maxIncreasePerBoutSeconds,
    Math.floor(priorCompletedSeconds / 1_200) * 60,
  )
  const authoredRoomSeconds = Math.min(...input.targetBouts.map(target => (
    target.authoredMaximumDurationSeconds - target.acceptedDurationSeconds
  )))
  const boutRoomSeconds = Math.min(...input.targetBouts.map(target => (
    input.policy.maxBoutDurationSeconds - target.acceptedDurationSeconds
  )))
  const weeklyRoomPerBoutSeconds = Math.floor(
    (input.policy.maxPlannedWeeklyDurationSeconds - input.plannedWeeklyDurationSeconds)
      / input.targetBouts.length / 60,
  ) * 60
  const increaseSecondsPerBout = Math.floor(Math.min(
    ratioStepSeconds,
    authoredRoomSeconds,
    boutRoomSeconds,
    weeklyRoomPerBoutSeconds,
    input.policy.maxTotalWeeklyIncreaseSeconds / input.targetBouts.length,
  ) / 60) * 60
  if (increaseSecondsPerBout < 60) return hold(input, 'no_whole_minute_available_hold')

  const targetBouts = [...input.targetBouts]
    .sort((left, right) => left.scheduledLocalDate.localeCompare(right.scheduledLocalDate)
      || left.sessionId.localeCompare(right.sessionId))
    .map(target => ({
      sessionId: target.sessionId,
      sessionRevision: target.sessionRevision,
      boutId: target.boutId,
      acceptedDurationSeconds: target.acceptedDurationSeconds + increaseSecondsPerBout,
    }))
  return ConditioningProgressionDecisionV1Schema.parse({
    kind: 'duration_proposal', status: 'proposed', reason: 'two_comparable_bouts_completed',
    ...audit(input),
    decisionKey: decisionKey(input, { kind: 'duration_proposal', increaseSecondsPerBout, targets: targetBouts }),
    increaseSecondsPerBout,
    targetBouts,
  })
}
