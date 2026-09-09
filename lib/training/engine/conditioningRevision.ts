import {
  ConditioningPairingPolicyV1Schema,
  ConditioningLocalDateV1Schema,
  ConditioningRevisionResultV1Schema,
  ConditioningRevisionSelectionV1Schema,
  ConditioningRevisionSessionStateV1Schema,
  ConditioningRevisionSourceV1Schema,
  type ConditioningPairingPolicyV1,
  type ConditioningRevisionResultV1,
} from '../contracts/conditioning-revision'
import {
  catalogOriginMatchesExecutionContext,
  catalogOriginsMatch,
  executionContextsMatch,
} from '../contracts/program'
import { TrainingCatalogV1Schema } from '../catalog/types'
import { hashCanonicalDecisionIdentity } from '../progression/identity'

const DAY_MS = 86_400_000

export interface BuildConditioningRevisionInputV1 {
  readonly currentLocalDate: string
  readonly currentPlan: unknown
  readonly sessionStates: unknown
  readonly selection: unknown
  readonly catalog: unknown
  /** Server-resolved authoring policy; never accept this array from the browser. */
  readonly pairingPolicies?: unknown
}

function localDateMs(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`)
}

function formatLocalDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10)
}

function weekStart(value: string): string {
  const date = new Date(localDateMs(value))
  const daysAfterMonday = (date.getUTCDay() + 6) % 7
  return formatLocalDate(date.getTime() - daysAfterMonday * DAY_MS)
}

function weekDates(value: string): string[] {
  const start = localDateMs(weekStart(value))
  return Array.from({ length: 7 }, (_, index) => formatLocalDate(start + index * DAY_MS))
}

function exactIdSet(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === actual.length
    && new Set(actual).size === actual.length
    && expected.every(id => actual.includes(id))
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

function unavailable(reason: Extract<ConditioningRevisionResultV1['result'], { kind: 'unavailable' }>['reason']) {
  return deepFreeze(ConditioningRevisionResultV1Schema.parse({
    schemaVersion: 'conditioning-revision.v1',
    result: { kind: 'unavailable', reason },
  }))
}

function pairingPolicyMatches(
  policy: ConditioningPairingPolicyV1,
  context: ReturnType<typeof ConditioningRevisionSourceV1Schema.parse>['executionContext'],
  catalogVersion: string,
  modalityId: string,
): boolean {
  if (policy.modalityId !== modalityId || policy.catalogVersion !== catalogVersion
    || policy.pairing !== 'moderate_strength_first_allowed') return false
  if (context.kind === 'live') return policy.provenance.kind === 'reviewed_authored_policy'
  return policy.provenance.kind === 'synthetic_fixture'
    && policy.provenance.fixtureId === context.fixtureId
    && policy.provenance.fixtureHash === context.fixtureHash
    && policy.provenance.label === context.label
}

export function buildConditioningRevision(
  input: BuildConditioningRevisionInputV1,
): ConditioningRevisionResultV1 {
  const currentDate = ConditioningLocalDateV1Schema.parse(input.currentLocalDate)
  const plan = ConditioningRevisionSourceV1Schema.parse(input.currentPlan)
  const states = ConditioningRevisionSessionStateV1Schema.array().max(64).parse(input.sessionStates)
  const selection = ConditioningRevisionSelectionV1Schema.parse(input.selection)
  const catalog = TrainingCatalogV1Schema.parse(input.catalog)
  const policies = ConditioningPairingPolicyV1Schema.array().max(100)
    .parse(input.pairingPolicies ?? [])

  if (catalog.catalogVersion !== plan.catalogVersion
    || !catalogOriginMatchesExecutionContext(catalog.origin, plan.executionContext)) {
    return unavailable('catalog_context_mismatch')
  }
  const targetMode = catalog.conditioningModes
    .filter(mode => mode.modalityId === selection.replacementModalityId)
  const modeIsReviewed = plan.executionContext.kind === 'live'
    ? targetMode[0]?.contentReviewStatus === 'reviewed' && catalog.origin.kind === 'authored_catalog'
    : targetMode[0]?.contentReviewStatus === 'reviewed_fixture' && catalog.origin.kind === 'synthetic_fixture'
  if (targetMode.length !== 1 || targetMode[0].lifecycle !== 'active' || !modeIsReviewed) {
    return unavailable('modality_unavailable')
  }

  if (plan.conditioningBouts.some(bout => bout.athleteTimezone !== plan.athleteTimezone)) {
    return unavailable('mixed_timezone')
  }
  if (plan.conditioningBouts.some(bout => (
    !executionContextsMatch(bout.executionContext, plan.executionContext)
    || bout.source.compiledProgramRevisionId !== plan.compiledProgramRevisionId
    || bout.source.compilerPolicyVersion !== plan.compilerPolicyVersion
  ))) {
    return unavailable('source_revision_mismatch')
  }
  if (plan.conditioningBouts.some(bout => (
    bout.source.catalogVersion !== plan.catalogVersion
    || !catalogOriginsMatch(bout.source.catalogOrigin, catalog.origin)
  ))) {
    return unavailable('catalog_context_mismatch')
  }

  const stateById = new Map(states.map(state => [state.sessionId, state]))
  if (stateById.size !== states.length
    || plan.conditioningBouts.some(bout => !stateById.has(bout.boutId))) {
    return unavailable('session_state_unavailable')
  }
  const weeklyCounts = new Map<string, number>()
  for (const bout of plan.conditioningBouts) {
    const key = weekStart(bout.scheduledLocalDate)
    weeklyCounts.set(key, (weeklyCounts.get(key) ?? 0) + 1)
  }
  if ([...weeklyCounts.values()].some(count => count !== 2)) {
    return unavailable('current_plan_not_two_bouts_weekly')
  }

  const changeable = plan.conditioningBouts.filter(bout => (
    stateById.get(bout.boutId)?.state === 'scheduled'
    && !stateById.get(bout.boutId)?.hasPrescription
    && bout.scheduledLocalDate >= currentDate
  ))
  if (changeable.length === 0) return unavailable('no_changeable_bouts')
  if (!exactIdSet(
    changeable.map(bout => bout.boutId),
    selection.futureBouts.map(bout => bout.sourceBoutId),
  )) return unavailable('selection_mismatch')

  const selectedById = new Map(selection.futureBouts.map(bout => [bout.sourceBoutId, bout]))
  const changesModality = changeable.some(bout => bout.modalityId !== selection.replacementModalityId)
  const changesDuration = changeable.some((bout) => {
    const selected = selectedById.get(bout.boutId) as typeof selection.futureBouts[number]
    return selected.acceptedDurationSeconds !== bout.acceptedDurationSeconds
  })
  const changesAnyPrescription = changesModality || changeable.some((bout) => {
    const selected = selectedById.get(bout.boutId) as typeof selection.futureBouts[number]
    return selected.scheduledLocalDate !== bout.scheduledLocalDate
      || selected.acceptedDurationSeconds !== bout.acceptedDurationSeconds
      || selected.arrangement !== (bout.scheduleArrangement?.kind ?? 'separate')
  })
  if (!changesAnyPrescription) return unavailable('no_effective_change')
  if (changesModality && selection.futureBouts.some(bout => bout.acceptedDurationSeconds > 1_200)) {
    return unavailable('new_modality_duration_requires_1_to_20_minutes')
  }

  const finalDates = new Map(plan.conditioningBouts.map(bout => [
    bout.boutId,
    selectedById.get(bout.boutId)?.scheduledLocalDate ?? bout.scheduledLocalDate,
  ]))
  const strengthByDate = new Map(plan.strengthSessions.map(session => [session.scheduledLocalDate, session]))
  const dateCounts = new Map<string, number>()
  for (const date of finalDates.values()) dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1)
  const matchingPairingPolicies = policies.filter(policy => pairingPolicyMatches(
    policy,
    plan.executionContext,
    plan.catalogVersion,
    selection.replacementModalityId,
  ))
  const pairingPolicy = matchingPairingPolicies.length === 1
    ? matchingPairingPolicies[0]
    : undefined
  const pairingAllowed = Boolean(pairingPolicy)
  const conflicts: Array<{
    sourceBoutId: string
    requestedLocalDate: string
    reason: 'before_current_local_date' | 'outside_source_week' | 'strength_date_requires_arrangement' | 'conditioning_date_collision' | 'paired_arrangement_unavailable'
    collidingSessionId?: string
    offDayAlternatives: string[]
    pairedOptionAvailable: boolean
  }> = []

  for (const source of changeable) {
    const requested = selectedById.get(source.boutId) as typeof selection.futureBouts[number]
    const strength = strengthByDate.get(requested.scheduledLocalDate)
    let reason: typeof conflicts[number]['reason'] | null = null
    if (requested.scheduledLocalDate < currentDate) reason = 'before_current_local_date'
    else if (weekStart(requested.scheduledLocalDate) !== weekStart(source.scheduledLocalDate)) reason = 'outside_source_week'
    else if ((dateCounts.get(requested.scheduledLocalDate) ?? 0) > 1) reason = 'conditioning_date_collision'
    else if (strength && requested.arrangement === 'separate') reason = 'strength_date_requires_arrangement'
    else if (requested.arrangement === 'paired_strength_first' && (!strength || !pairingAllowed)) {
      reason = 'paired_arrangement_unavailable'
    }
    if (!reason) continue
    const occupiedByOtherBouts = new Set([...finalDates.entries()]
      .filter(([id]) => id !== source.boutId).map(([, date]) => date))
    const offDayAlternatives = weekDates(source.scheduledLocalDate).filter(date => (
      date >= currentDate && !strengthByDate.has(date) && !occupiedByOtherBouts.has(date)
    ))
    conflicts.push({
      sourceBoutId: source.boutId,
      requestedLocalDate: requested.scheduledLocalDate,
      reason,
      ...(strength ? { collidingSessionId: strength.sessionId } : {}),
      offDayAlternatives,
      pairedOptionAvailable: Boolean(strength && pairingAllowed),
    })
  }
  if (conflicts.length > 0) {
    return deepFreeze(ConditioningRevisionResultV1Schema.parse({
      schemaVersion: 'conditioning-revision.v1',
      result: {
        kind: 'reschedule_required',
        reason: 'explicit_schedule_resolution_required',
        conflicts,
      },
    }))
  }

  const currentIdentities = changeable
    .map(bout => bout.progressionIdentity)
    .filter(identity => identity !== undefined)
  const sharedSeries = currentIdentities.length === changeable.length
    && new Set(currentIdentities.map(identity => identity.progressionSeriesId)).size === 1
    ? currentIdentities[0].progressionSeriesId
    : null
  const resetIdentity = changesModality || changesDuration
    ? {
        progressionSeriesId: changesModality || !sharedSeries
          ? `conditioning:${hashCanonicalDecisionIdentity({
              kind: 'conditioning-progression-series.v1',
              assignmentId: plan.assignmentId,
              baseProgramRevisionNumber: plan.baseProgramRevisionNumber,
              modalityId: selection.replacementModalityId,
            })}`
          : sharedSeries,
        evidenceEpoch: changesModality
          ? 0
          : Math.max(-1, ...currentIdentities.map(identity => identity.evidenceEpoch)) + 1,
      }
    : null

  const resultingWeeklyCounts = new Map<string, number>()
  for (const date of finalDates.values()) {
    const key = weekStart(date)
    resultingWeeklyCounts.set(key, (resultingWeeklyCounts.get(key) ?? 0) + 1)
  }
  if ([...resultingWeeklyCounts.values()].some(count => count !== 2)) {
    return unavailable('current_plan_not_two_bouts_weekly')
  }

  const replacements = changeable.map((source) => {
    const requested = selectedById.get(source.boutId) as typeof selection.futureBouts[number]
    return {
      sourceBoutId: source.boutId,
      priorModalityId: source.modalityId,
      priorScheduledLocalDate: source.scheduledLocalDate,
      priorAcceptanceId: source.acceptanceId,
      modalityId: targetMode[0].modalityId,
      scheduledLocalDate: requested.scheduledLocalDate,
      athleteTimezone: plan.athleteTimezone,
      acceptedDurationSeconds: requested.acceptedDurationSeconds,
      effortCue: targetMode[0].effortCue,
      arrangement: requested.arrangement,
      ...(resetIdentity
        ? { progressionIdentity: resetIdentity }
        : source.progressionIdentity
          ? { progressionIdentity: source.progressionIdentity }
          : {}),
      evidenceBoundary: resetIdentity
        ? { kind: 'reset' as const, reason: changesModality ? 'modality_changed' as const : 'duration_changed' as const }
        : { kind: 'preserved' as const },
      ...(requested.arrangement === 'paired_strength_first' && pairingPolicy
        ? { pairingPolicy }
        : {}),
      comparability: source.modalityId === targetMode[0].modalityId
        ? { kind: 'preserved_series' as const, reason: 'schedule_or_duration_revision' as const }
        : { kind: 'new_series' as const, reason: 'modality_changed_recalibration' as const },
    }
  })
  return deepFreeze(ConditioningRevisionResultV1Schema.parse({
    schemaVersion: 'conditioning-revision.v1',
    result: {
      kind: 'revision_ready',
      status: 'requires_explicit_revision_acceptance',
      assignmentId: plan.assignmentId,
      subjectId: plan.subjectId,
      baseProgramRevisionNumber: plan.baseProgramRevisionNumber,
      compiledProgramRevisionId: plan.compiledProgramRevisionId,
      compilerPolicyVersion: plan.compilerPolicyVersion,
      catalogVersion: plan.catalogVersion,
      executionContext: plan.executionContext,
      preservedBoutIds: plan.conditioningBouts
        .filter(bout => !selectedById.has(bout.boutId)).map(bout => bout.boutId),
      replacements,
      frequencyChange: 'unchanged',
      intensityChange: 'not_automated',
      strengthPriority: 'strength_first_when_paired',
    },
  }))
}
