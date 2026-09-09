import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
} from '../catalog/syntheticStarter'
import { TrainingCatalogV1Schema } from '../catalog/types'
import { buildConditioningRevision } from './conditioningRevision'

const executionContext = {
  kind: 'synthetic_simulation',
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-starter-catalog.v1',
  fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  label: 'Practice data',
} as const

const catalog = TrainingCatalogV1Schema.parse({
  ...SYNTHETIC_STARTER_CATALOG,
  conditioningModes: [
    ...SYNTHETIC_STARTER_CATALOG.conditioningModes,
    {
      modalityId: 'synthetic-cycle.v1', label: 'Synthetic stationary cycle',
      preferenceRank: 1, lifecycle: 'active', contentReviewStatus: 'reviewed_fixture',
      effortCue: 'Use a synthetic easy to moderate cycling cue.',
    },
  ],
})

const dates = ['2026-09-08', '2026-09-09', '2026-09-15', '2026-09-16']
const boutIds = dates.map((_, index) => `conditioning-bout-${index + 1}`)

function acceptedBout(index: number) {
  return {
    status: 'accepted', acceptanceId: `conditioning-accept-${index + 1}`,
    acceptedAt: '2026-09-01T12:00:00Z', acceptedByUserId: 'athlete-1',
    executionContext, boutId: boutIds[index], modalityId: 'synthetic-continuous-walking.v1',
    scheduledLocalDate: dates[index], athleteTimezone: 'America/Los_Angeles',
    acceptedDurationSeconds: 600,
    effortCue: SYNTHETIC_STARTER_CATALOG.conditioningModes[0].effortCue,
    source: {
      compiledProgramRevisionId: 'compiled-program-1',
      compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogVersion: catalog.catalogVersion,
      catalogOrigin: catalog.origin,
    },
  } as const
}

function currentPlan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'conditioning-revision-source.v1', assignmentId: 'assignment-1',
    subjectId: 'subject-1', baseProgramRevisionNumber: 3,
    compiledProgramRevisionId: 'compiled-program-1',
    compilerPolicyVersion: 'strength-cycle-compiler.v3',
    executionContext, catalogVersion: catalog.catalogVersion,
    athleteTimezone: 'America/Los_Angeles',
    strengthSessions: [
      { sessionId: 'strength-1', scheduledLocalDate: '2026-09-07' },
      { sessionId: 'strength-2', scheduledLocalDate: '2026-09-10' },
      { sessionId: 'strength-3', scheduledLocalDate: '2026-09-14' },
      { sessionId: 'strength-4', scheduledLocalDate: '2026-09-17' },
    ],
    conditioningBouts: dates.map((_, index) => acceptedBout(index)),
    ...overrides,
  }
}

function states(
  overrides: Record<string, string> = {},
  prescribedIds: ReadonlySet<string> = new Set(),
) {
  return boutIds.map(sessionId => ({
    sessionId,
    state: overrides[sessionId] ?? 'scheduled',
    hasPrescription: prescribedIds.has(sessionId),
  }))
}

function selection(
  replacementModalityId = 'synthetic-cycle.v1',
  overrides: Record<string, Partial<{
    scheduledLocalDate: string
    acceptedDurationSeconds: number
    arrangement: 'separate' | 'paired_strength_first'
  }>> = {},
) {
  return {
    replacementModalityId,
    futureBouts: boutIds.map((sourceBoutId, index) => ({
      sourceBoutId,
      scheduledLocalDate: overrides[sourceBoutId]?.scheduledLocalDate ?? dates[index],
      acceptedDurationSeconds: overrides[sourceBoutId]?.acceptedDurationSeconds ?? 600,
      arrangement: overrides[sourceBoutId]?.arrangement ?? 'separate',
    })),
  }
}

function pairingPolicy() {
  return {
    schemaVersion: 'conditioning-pairing-policy.v1',
    modalityId: 'synthetic-cycle.v1', catalogVersion: catalog.catalogVersion,
    pairing: 'moderate_strength_first_allowed',
    provenance: {
      kind: 'synthetic_fixture', fixtureId: executionContext.fixtureId,
      fixtureHash: executionContext.fixtureHash, label: executionContext.label,
    },
  }
}

describe('buildConditioningRevision', () => {
  it('creates an explicit new-modality plan with new comparison series and unchanged frequency', () => {
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(),
      sessionStates: states(), selection: selection(), catalog,
    })

    expect(result).toMatchObject({
      result: {
        kind: 'revision_ready', status: 'requires_explicit_revision_acceptance',
        frequencyChange: 'unchanged', intensityChange: 'not_automated',
      },
    })
    if (result.result.kind !== 'revision_ready') throw new Error('expected ready revision')
    expect(result.result.replacements).toHaveLength(4)
    expect(result.result.replacements.every(replacement => (
      replacement.comparability.kind === 'new_series'
      && replacement.comparability.reason === 'modality_changed_recalibration'
      && replacement.evidenceBoundary.kind === 'reset'
      && replacement.progressionIdentity?.evidenceEpoch === 0
      && replacement.effortCue === 'Use a synthetic easy to moderate cycling cue.'
    ))).toBe(true)
    expect(result.result.replacements[0].scheduledLocalDate).toBe('2026-09-08')
    expect(Object.isFrozen(result.result.replacements)).toBe(true)
  })

  it('allows an explicit same-modality reschedule and duration up to the persisted 30-minute bound', () => {
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-continuous-walking.v1', {
        [boutIds[0]]: { scheduledLocalDate: '2026-09-11', acceptedDurationSeconds: 1_800 },
        [boutIds[1]]: { scheduledLocalDate: '2026-09-12', acceptedDurationSeconds: 1_800 },
      }),
      catalog,
    })
    expect(result.result.kind).toBe('revision_ready')
    if (result.result.kind !== 'revision_ready') return
    expect(result.result.replacements.slice(0, 2)).toMatchObject([
      { scheduledLocalDate: '2026-09-11', acceptedDurationSeconds: 1_800, comparability: { kind: 'preserved_series' }, evidenceBoundary: { kind: 'reset', reason: 'duration_changed' } },
      { scheduledLocalDate: '2026-09-12', acceptedDurationSeconds: 1_800, comparability: { kind: 'preserved_series' }, evidenceBoundary: { kind: 'reset', reason: 'duration_changed' } },
    ])
  })

  it('increments one shared evidence epoch for a same-modality duration revision', () => {
    const plan = currentPlan({
      conditioningBouts: dates.map((_, index) => ({
        ...acceptedBout(index),
        progressionIdentity: { progressionSeriesId: 'conditioning-series-1', evidenceEpoch: 3 },
      })),
    })
    const durationChanges = Object.fromEntries(
      boutIds.map(id => [id, { acceptedDurationSeconds: 660 }]),
    )
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: plan, sessionStates: states(),
      selection: selection('synthetic-continuous-walking.v1', durationChanges), catalog,
    })
    if (result.result.kind !== 'revision_ready') throw new Error('expected ready revision')
    expect(result.result.replacements.every(replacement => (
      replacement.evidenceBoundary.kind === 'reset'
      && replacement.evidenceBoundary.reason === 'duration_changed'
      && replacement.progressionIdentity?.progressionSeriesId === 'conditioning-series-1'
      && replacement.progressionIdentity.evidenceEpoch === 4
    ))).toBe(true)
  })

  it('preserves an existing evidence identity for schedule-only changes', () => {
    const plan = currentPlan({
      conditioningBouts: dates.map((_, index) => ({
        ...acceptedBout(index),
        progressionIdentity: { progressionSeriesId: 'conditioning-series-1', evidenceEpoch: 2 },
      })),
    })
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: plan, sessionStates: states(),
      selection: selection('synthetic-continuous-walking.v1', {
        [boutIds[0]]: { scheduledLocalDate: '2026-09-11' },
        [boutIds[1]]: { scheduledLocalDate: '2026-09-12' },
      }),
      catalog,
    })
    if (result.result.kind !== 'revision_ready') throw new Error('expected ready revision')
    expect(result.result.replacements.every(replacement => (
      replacement.evidenceBoundary.kind === 'preserved'
      && replacement.progressionIdentity?.progressionSeriesId === 'conditioning-series-1'
      && replacement.progressionIdentity.evidenceEpoch === 2
    ))).toBe(true)
  })

  it('preserves past and started bouts and changes every scheduled bout from today forward', () => {
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-09', currentPlan: currentPlan(),
      sessionStates: states({ [boutIds[1]]: 'in_progress' }),
      selection: {
        replacementModalityId: 'synthetic-cycle.v1',
        futureBouts: boutIds.slice(2).map((sourceBoutId, index) => ({
          sourceBoutId, scheduledLocalDate: dates[index + 2],
          acceptedDurationSeconds: 600, arrangement: 'separate',
        })),
      },
      catalog,
    })
    expect(result.result.kind).toBe('revision_ready')
    if (result.result.kind !== 'revision_ready') return
    expect(result.result.preservedBoutIds).toEqual(boutIds.slice(0, 2))
    expect(result.result.replacements.map(item => item.sourceBoutId)).toEqual(boutIds.slice(2))
  })

  it('preserves a scheduled bout that already has a prescription and revises only unprescribed siblings', () => {
    const prescribed = new Set([boutIds[1]])
    const futureBouts = selection().futureBouts.filter(bout => bout.sourceBoutId !== boutIds[1])
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(),
      sessionStates: states({}, prescribed),
      selection: { ...selection(), futureBouts }, catalog,
    })
    expect(result.result.kind).toBe('revision_ready')
    if (result.result.kind !== 'revision_ready') return
    expect(result.result.preservedBoutIds).toContain(boutIds[1])
    expect(result.result.replacements.map(item => item.sourceBoutId)).not.toContain(boutIds[1])
  })

  it('offers off-day or explicitly authored strength-first pairing for a strength-date collision', () => {
    const colliding = selection('synthetic-cycle.v1', {
      [boutIds[0]]: { scheduledLocalDate: '2026-09-10' },
    })
    const unresolved = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: colliding, catalog, pairingPolicies: [pairingPolicy()],
    })
    expect(unresolved).toMatchObject({
      result: {
        kind: 'reschedule_required',
        conflicts: [{
          sourceBoutId: boutIds[0], reason: 'strength_date_requires_arrangement',
          collidingSessionId: 'strength-2', pairedOptionAvailable: true,
        }],
      },
    })
    if (unresolved.result.kind === 'reschedule_required') {
      expect(unresolved.result.conflicts[0].offDayAlternatives).toContain('2026-09-11')
    }

    const acknowledged = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-cycle.v1', {
        [boutIds[0]]: { scheduledLocalDate: '2026-09-10', arrangement: 'paired_strength_first' },
      }),
      catalog, pairingPolicies: [pairingPolicy()],
    })
    expect(acknowledged.result.kind).toBe('revision_ready')
    if (acknowledged.result.kind === 'revision_ready') {
      expect(acknowledged.result.replacements[0].arrangement).toBe('paired_strength_first')
      expect(acknowledged.result.replacements[0].pairingPolicy)
        .toEqual(pairingPolicy())
    }
  })

  it('does not infer pairing authority from a catalog effort cue', () => {
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-cycle.v1', {
        [boutIds[0]]: { scheduledLocalDate: '2026-09-10', arrangement: 'paired_strength_first' },
      }),
      catalog,
    })
    expect(result).toMatchObject({
      result: { kind: 'reschedule_required', conflicts: [{ reason: 'paired_arrangement_unavailable' }] },
    })
  })

  it.each([
    [{ [boutIds[0]]: { scheduledLocalDate: '2026-09-09' } }, 'conditioning_date_collision'],
    [{ [boutIds[0]]: { scheduledLocalDate: '2026-09-06' } }, 'before_current_local_date'],
    [{ [boutIds[0]]: { scheduledLocalDate: '2026-09-15' } }, 'outside_source_week'],
  ] as const)('requires explicit resolution for %s', (overrides, reason) => {
    const result = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-cycle.v1', overrides), catalog,
    })
    expect(result).toMatchObject({
      result: {
        kind: 'reschedule_required',
        conflicts: expect.arrayContaining([
          expect.objectContaining({ sourceBoutId: boutIds[0], reason }),
        ]),
      },
    })
  })

  it('rejects a new modality above 20 minutes without limiting an existing 30-minute modality', () => {
    const tooLong = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-cycle.v1', {
        [boutIds[0]]: { acceptedDurationSeconds: 1_201 },
      }),
      catalog,
    })
    expect(tooLong).toMatchObject({
      result: { kind: 'unavailable', reason: 'new_modality_duration_requires_1_to_20_minutes' },
    })
    const existing = buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-continuous-walking.v1', {
        [boutIds[0]]: { acceptedDurationSeconds: 1_800 },
      }),
      catalog,
    })
    expect(existing.result.kind).toBe('revision_ready')
  })

  it('does not create a revision when modality, date, duration, and arrangement are unchanged', () => {
    expect(buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-continuous-walking.v1'), catalog,
    })).toMatchObject({ result: { kind: 'unavailable', reason: 'no_effective_change' } })
  })

  it('fails closed on missing state, incomplete selection, invalid weekly source, or unreviewed mode', () => {
    expect(buildConditioningRevision({
      currentLocalDate: '2026-09-08',
      currentPlan: currentPlan({ compiledProgramRevisionId: 'different-compiled-program' }),
      sessionStates: states(), selection: selection(), catalog,
    })).toMatchObject({ result: { reason: 'source_revision_mismatch' } })
    expect(buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(),
      sessionStates: states().slice(1), selection: selection(), catalog,
    })).toMatchObject({ result: { reason: 'session_state_unavailable' } })
    expect(buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: { ...selection(), futureBouts: selection().futureBouts.slice(1) }, catalog,
    })).toMatchObject({ result: { reason: 'selection_mismatch' } })
    expect(buildConditioningRevision({
      currentLocalDate: '2026-09-08',
      currentPlan: currentPlan({ conditioningBouts: dates.slice(1).map((_, index) => acceptedBout(index + 1)) }),
      sessionStates: states(), selection: selection(), catalog,
    })).toMatchObject({ result: { reason: 'current_plan_not_two_bouts_weekly' } })
    expect(buildConditioningRevision({
      currentLocalDate: '2026-09-08', currentPlan: currentPlan(), sessionStates: states(),
      selection: selection('synthetic-unreviewed.v1'),
      catalog: {
        ...catalog,
        conditioningModes: [...catalog.conditioningModes, {
          modalityId: 'synthetic-unreviewed.v1', label: 'Synthetic unreviewed mode',
          preferenceRank: 2, lifecycle: 'active', contentReviewStatus: 'unreviewed',
          effortCue: 'Synthetic unreviewed cue.',
        }],
      },
    })).toMatchObject({ result: { reason: 'modality_unavailable' } })
  })
})
