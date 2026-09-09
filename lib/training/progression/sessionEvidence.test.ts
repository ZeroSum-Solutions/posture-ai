import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { decideStrengthProgression } from './decision'
import { TrainingSessionPrescriptionV1Schema } from '../contracts/session'
import {
  adaptStrengthSessionEvidence,
  buildProgressionReadySessionEvidence,
  type ReadyStrengthSessionEvidenceV1,
} from './sessionEvidence'

const liveContext = { kind: 'live' } as const
const firstSimulationContext = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-starter-catalog.v1',
  fixtureHash: 'a'.repeat(64),
  label: 'Practice data' as const,
}

function quantity(value = '50', unit: 'kg' | 'lb' = 'kg') {
  return createLoadQuantity({ value, unit })
}

function prescription(
  sessionId: string,
  context: typeof liveContext | typeof firstSimulationContext = liveContext,
  pressProgressionSeriesId = 'strength-slot:push',
) {
  const catalogOrigin = context.kind === 'live'
    ? { kind: 'authored_catalog' as const }
    : {
        kind: 'synthetic_fixture' as const,
        source: 'server_fixture' as const,
        fixtureId: context.fixtureId,
        fixtureHash: context.fixtureHash,
        label: 'Synthetic starter catalog',
      }
  const acceptedLoad = (exerciseInstanceId: string, exerciseVersionId: string, value = '50') => ({
    status: 'accepted' as const,
    acceptanceId: `accept-${exerciseInstanceId}`,
    acceptedAt: '2026-09-01T16:00:00.000Z',
    acceptedByUserId: 'athlete-1',
    source: 'equipment_inventory' as const,
    executionContext: context,
    exerciseInstanceId,
    exerciseVersionId,
    equipmentId: 'machine-1',
    provenance: {
      profileRevisionId: '1',
      compiledProgramRevisionId: 'compiled-program-1',
      catalogVersion: 'catalog.v1',
      catalogOrigin,
    },
    loadBasis: 'machine_stack' as const,
    implementCount: 1 as const,
    holdingConfiguration: 'machine_defined' as const,
    quantity: quantity(value),
  })
  return {
    schemaVersion: 'training-session-prescription.v1' as const,
    sessionId,
    assignmentId: 'assignment-1',
    programRevisionNumber: 1,
    subjectId: 'subject-1',
    executionContext: context,
    scheduledLocalDate: '2026-09-04',
    athleteTimezone: 'America/Los_Angeles',
    profileRevisionId: '1',
    eligibilitySourceRevisionId: 'eligibility-1',
    compilerPolicyVersion: 'compiler.v1',
    catalogVersion: 'catalog.v1',
    catalogOrigin,
    ruleVersion: 'strength-progression-v1',
    compiledProgramRevisionId: 'compiled-program-1',
    exercises: [
      {
        exerciseInstanceId: `${sessionId}-press`,
        exerciseVersionId: 'chest-press.v1',
        warmupSets: [{
          setId: `${sessionId}-press-warmup-1`,
          targetReps: 8,
          prescribedLoad: quantity('20'),
        }],
        setIds: [`${sessionId}-press-set-1`, `${sessionId}-press-set-2`],
        repRange: { minimum: 6, maximum: 8 },
        targetRir: { minimum: 2, maximum: 3 },
        restSeconds: 120,
        progression: {
          progressionSeriesId: pressProgressionSeriesId, side: 'bilateral', rom: 'catalog_default',
          tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 1,
        },
        acceptedInitialLoad: acceptedLoad(`${sessionId}-press`, 'chest-press.v1'),
      },
      {
        exerciseInstanceId: `${sessionId}-row`,
        exerciseVersionId: 'machine-row.v1',
        setIds: [`${sessionId}-row-set-1`, `${sessionId}-row-set-2`],
        repRange: { minimum: 6, maximum: 8 },
        targetRir: { minimum: 2, maximum: 3 },
        restSeconds: 120,
        progression: {
          progressionSeriesId: 'strength-slot:pull', side: 'bilateral', rom: 'catalog_default',
          tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 1,
        },
        acceptedInitialLoad: acceptedLoad(`${sessionId}-row`, 'machine-row.v1', '40'),
      },
    ],
  }
}

function metadata(
  sessionId: string,
  completedAt: string | null = '2026-09-04T17:30:00.000Z',
  progressionSeriesId = 'strength-slot:push',
) {
  return {
    schemaVersion: 'strength-session-progression-metadata.v1' as const,
    prescriptionSourceRevisionId: `prescription-revision-${sessionId}`,
    progressionSeriesId,
    startedAt: '2026-09-04T17:00:00.000Z',
    completedAt,
    comparator: {
      side: 'bilateral',
      rom: 'catalog_default',
      tempo: 'self_selected_controlled',
      exposureType: 'standard',
      loadEpoch: 1,
    },
  }
}

interface EventOverrides {
  readonly eventId?: string
  readonly eventType?: 'set_actual_recorded' | 'set_actual_corrected'
  readonly eventRevision?: number
  readonly replacesEventId?: string | null
  readonly value?: string
  readonly unit?: 'kg' | 'lb'
  readonly reps?: number
  readonly rir?: number | '6_plus' | 'unknown'
  readonly symptomState?: 'none' | 'adverse_reported'
  readonly side?: 'bilateral' | 'left' | 'right' | 'not_applicable'
  readonly exerciseInstanceId?: string
  readonly setId?: string
  readonly ordinal?: number
  readonly setKind?: 'warmup' | 'working'
  readonly context?: typeof liveContext | typeof firstSimulationContext
  readonly equipmentId?: string
  readonly loadBasis?: 'machine_stack' | 'bodyweight_external' | 'machine_assistance'
}

function event(sessionId: string, ordinal: number, overrides: EventOverrides = {}) {
  const exerciseInstanceId = overrides.exerciseInstanceId ?? `${sessionId}-press`
  const setId = overrides.setId ?? `${sessionId}-press-set-${ordinal}`
  return {
    schemaVersion: 'training-set-log-event.v1' as const,
    eventId: overrides.eventId ?? `event-${setId}-${overrides.eventRevision ?? 1}`,
    eventType: overrides.eventType ?? 'set_actual_recorded' as const,
    eventRevision: overrides.eventRevision ?? 1,
    replacesEventId: overrides.replacesEventId ?? null,
    subjectId: 'subject-1',
    sessionId,
    exerciseInstanceId,
    setId,
    setKind: overrides.setKind ?? 'working' as const,
    workingSetOrdinal: overrides.setKind === 'warmup' ? null : overrides.ordinal ?? ordinal,
    executionContext: overrides.context ?? liveContext,
    equipmentId: overrides.equipmentId ?? 'machine-1',
    loadBasis: overrides.loadBasis ?? 'machine_stack' as const,
    quantity: quantity(overrides.value ?? '50', overrides.unit ?? 'kg'),
    reps: overrides.reps ?? 8,
    rir: overrides.rir ?? 2,
    side: overrides.side ?? 'bilateral' as const,
    symptomState: overrides.symptomState ?? 'none' as const,
    actor: { kind: 'athlete' as const, userId: 'athlete-1' },
    occurredAt: '2026-09-04T17:10:00.000Z',
    serverAt: '2026-09-04T17:10:01.000Z',
  }
}

function adapt(
  sessionId: string,
  events = [event(sessionId, 1), event(sessionId, 2)],
  options: {
    readonly state?: 'in_progress' | 'completed' | 'completed_with_omissions' | 'aborted'
    readonly stoppedForSymptoms?: boolean
    readonly context?: typeof liveContext | typeof firstSimulationContext
    readonly completedAt?: string | null
    readonly metadataOverride?: unknown
    readonly progressionSeriesId?: string
  } = {},
) {
  const state = options.state ?? 'completed'
  const progressionSeriesId = options.progressionSeriesId ?? 'strength-slot:push'
  const prescribed = prescription(sessionId, options.context, progressionSeriesId)
  return adaptStrengthSessionEvidence({
    session: {
      sessionId,
      revision: 1,
      state,
      stoppedForSymptoms: options.stoppedForSymptoms ?? false,
    },
    prescription: prescribed,
    exerciseInstanceId: `${sessionId}-press`,
    currentEvents: events,
    metadata: options.metadataOverride ?? metadata(
      sessionId,
      Object.hasOwn(options, 'completedAt') ? options.completedAt as string | null : state === 'in_progress' ? null : '2026-09-04T17:30:00.000Z',
      progressionSeriesId,
    ),
  })
}

function ready(result: ReturnType<typeof adapt>): ReadyStrengthSessionEvidenceV1 {
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw new Error(`Expected ready evidence, received ${result.reason}`)
  return result
}

function progressionInput(bundle: ReturnType<typeof buildProgressionReadySessionEvidence>) {
  return {
    policyVersion: 'strength-progression-v1' as const,
    now: '2026-09-07T18:00:00.000Z',
    executionContext: bundle.executionContext,
    subjectId: bundle.subjectId,
    sourceProfileRevisionId: bundle.sourceProfileRevisionId,
    programRevisionId: bundle.programRevisionId,
    eligibility: {
      state: 'eligible_general' as const,
      scope: 'supported' as const,
      policyVersion: 'eligibility-v1',
      sourceRevisionId: 'eligibility-1',
      source: {
        kind: 'policy_service' as const,
        sourceVersion: 'eligibility-policy-service.v1' as const,
        evaluatedAt: '2026-09-01T00:00:00.000Z',
      },
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: '2026-10-01T00:00:00.000Z',
      supersededAt: null,
    },
    prescription: bundle.prescription,
    equipmentInventory: {
      kind: 'machine' as const,
      equipmentId: 'machine-1',
      unit: 'kg' as const,
      stackLoads: ['50', '52'],
    },
    exposures: bundle.exposures,
  }
}

describe('adaptStrengthSessionEvidence', () => {
  it('carries exact dedicated policy identity into bodyweight comparison evidence', () => {
    const sessionId = 'session-bodyweight'
    const source = prescription(sessionId)
    const sourceExercise = source.exercises[0]
    const prescribed = TrainingSessionPrescriptionV1Schema.parse({
      ...source,
      exercises: [{
        ...sourceExercise,
        acceptedInitialLoad: {
      ...sourceExercise.acceptedInitialLoad,
      equipmentId: 'bodyweight-station',
      loadBasis: 'bodyweight_external',
      implementCount: 0,
      holdingConfiguration: 'bodyweight_plus_external_load',
      bodyweightAssistancePolicy: {
        policyId: 'synthetic-bodyweight-rep-only.v1', policyVersion: '1',
      },
      quantity: quantity('0'),
        },
      }, source.exercises[1]],
    })
    const exercise = prescribed.exercises[0]
    const result = adaptStrengthSessionEvidence({
      session: { sessionId, revision: 1, state: 'completed', stoppedForSymptoms: false },
      prescription: prescribed,
      exerciseInstanceId: exercise.exerciseInstanceId,
      currentEvents: [1, 2].map(ordinal => event(sessionId, ordinal, {
        equipmentId: 'bodyweight-station', loadBasis: 'bodyweight_external', value: '0',
      })),
      metadata: metadata(sessionId),
    })

    expect(result).toMatchObject({
      kind: 'ready',
      prescription: {
        loadBasis: 'bodyweight_external',
        bodyweightAssistancePolicy: {
          policyId: 'synthetic-bodyweight-rep-only.v1', policyVersion: '1',
        },
      },
      exposure: {
        comparator: {
          loadBasis: 'bodyweight_external',
          bodyweightAssistancePolicy: {
            policyId: 'synthetic-bodyweight-rep-only.v1', policyVersion: '1',
          },
        },
      },
    })
  })

  it('validates authored warm-up events but excludes them from working progression evidence', () => {
    const sessionId = 'session-warmup'
    const result = ready(adapt(sessionId, [
      event(sessionId, 0, {
        setKind: 'warmup', setId: `${sessionId}-press-warmup-1`, value: '20', reps: 8, rir: 'unknown',
      }),
      event(sessionId, 1),
      event(sessionId, 2),
    ]))

    expect(result.exposure.sets.map(set => set.setId)).toEqual([
      `${sessionId}-press-set-1`,
      `${sessionId}-press-set-2`,
    ])
    expect(result.exposure.comparator.prescribedWorkingSets).toBe(2)
    expect(adapt(sessionId, [
      event(sessionId, 0, { setKind: 'warmup', setId: `${sessionId}-press-set-1` }),
      event(sessionId, 1),
      event(sessionId, 2),
    ])).toMatchObject({ kind: 'unavailable', reason: 'invalid_server_projection' })
  })

  it('preserves exact entered loads and unknown RIR without fabricating effort', () => {
    const result = ready(adapt('session-exact', [
      event('session-exact', 1, { value: '0.001', unit: 'lb', rir: 'unknown' }),
      event('session-exact', 2, { value: '2.5', unit: 'lb', rir: 'unknown' }),
    ]))

    expect(result.exposure.sets.map(set => set.load.quantity)).toEqual([
      quantity('0.001', 'lb'),
      quantity('2.5', 'lb'),
    ])
    expect(result.exposure.sets.map(set => set.actualRir)).toEqual(['unknown', 'unknown'])
  })

  it('returns explicit missing metadata for older projections', () => {
    expect(adapt('session-old', [], { metadataOverride: { startedAt: '2026-09-04T17:00:00.000Z' } }))
      .toEqual({
        kind: 'unavailable',
        reason: 'missing_server_metadata',
        missingFields: [
          'metadata.schemaVersion',
          'metadata.prescriptionSourceRevisionId',
          'metadata.progressionSeriesId',
          'metadata.completedAt',
          'metadata.comparator.side',
          'metadata.comparator.rom',
          'metadata.comparator.tempo',
          'metadata.comparator.exposureType',
          'metadata.comparator.loadEpoch',
        ],
      })
  })

  it('rejects projected comparator metadata that differs from the approved prescription', () => {
    expect(adapt('session-mismatch', undefined, {
      metadataOverride: {
        ...metadata('session-mismatch'),
        comparator: { ...metadata('session-mismatch').comparator, tempo: 'forged_tempo' },
      },
    })).toMatchObject({ kind: 'unavailable', reason: 'invalid_server_projection' })
  })

  it('rejects an actual side that differs from the authored prescription', () => {
    expect(adapt('session-side-mismatch', [
      event('session-side-mismatch', 1, { side: 'left' }),
      event('session-side-mismatch', 2),
    ])).toMatchObject({ kind: 'unavailable', reason: 'invalid_server_projection' })
  })

  it('derives whole omitted exercises and keeps zero or partial work incomplete', () => {
    const zero = ready(adapt('session-omitted', [event('session-omitted', 1, { reps: 0 })], {
      state: 'completed_with_omissions',
    }))

    expect(zero.exposure).toMatchObject({
      sessionState: 'completed_with_omissions',
      exerciseState: 'incomplete',
      omittedExerciseInstanceIds: ['session-omitted-row'],
      sets: [{ setId: 'session-omitted-press-set-1', actualReps: 0, validity: 'invalid' }],
    })
    expect(decideStrengthProgression(progressionInput(
      buildProgressionReadySessionEvidence(zero, [zero]),
    ))).toMatchObject({ status: 'not_proposed', reasonCodes: ['exercise_incomplete_hold'] })

    const omitted = adaptStrengthSessionEvidence({
      session: { sessionId: 'session-omitted', revision: 1, state: 'completed_with_omissions', stoppedForSymptoms: false },
      prescription: prescription('session-omitted'),
      exerciseInstanceId: 'session-omitted-row',
      currentEvents: [event('session-omitted', 1, { reps: 0 })],
      metadata: metadata('session-omitted', '2026-09-04T17:30:00.000Z', 'strength-slot:pull'),
    })
    expect(ready(omitted).exposure).toMatchObject({
      exerciseState: 'omitted',
      omittedExerciseInstanceIds: ['session-omitted-row'],
      sets: [],
    })
  })

  it('selects the latest correction and rejects an invalid correction binding', () => {
    const original = event('session-corrected', 1, { eventId: 'event-original', reps: 5 })
    const corrected = event('session-corrected', 1, {
      eventId: 'event-corrected', eventType: 'set_actual_corrected', eventRevision: 2,
      replacesEventId: 'event-original', reps: 8,
    })
    const result = ready(adapt('session-corrected', [original, corrected, event('session-corrected', 2)]))
    expect(result.exposure.sets[0]).toMatchObject({ actualReps: 8, validity: 'valid' })
    const reordered = ready(adapt('session-corrected', [event('session-corrected', 2), corrected, original]))
    expect(reordered.exposure.sourceRevisionId).toBe(result.exposure.sourceRevisionId)
    expect(reordered.exposure.sets).toEqual(result.exposure.sets)

    const wrongSetCorrection = {
      ...corrected,
      setId: 'session-corrected-press-set-2',
      workingSetOrdinal: 2,
    }
    expect(adapt('session-corrected', [original, wrongSetCorrection, event('session-corrected', 2)]))
      .toMatchObject({ kind: 'unavailable', reason: 'invalid_server_projection' })
    expect(adapt('session-corrected', [
      event('session-corrected', 1, { ordinal: 2 }),
      event('session-corrected', 2),
    ])).toMatchObject({ kind: 'unavailable', reason: 'invalid_server_projection' })
  })

  it('turns a symptom stop into aborted evidence that holds progression', () => {
    const result = ready(adapt('session-symptom', [
      event('session-symptom', 1, { symptomState: 'adverse_reported' }),
      event('session-symptom', 2),
    ], { stoppedForSymptoms: true, state: 'aborted' }))
    const bundle = buildProgressionReadySessionEvidence(result, [result])

    expect(result.exposure).toMatchObject({ sessionState: 'aborted', exerciseState: 'aborted' })
    expect(decideStrengthProgression(progressionInput(bundle))).toMatchObject({
      status: 'not_proposed',
      reasonCodes: ['adverse_symptom_hold'],
    })
  })

  it('carries unknown RIR into the engine effort hold', () => {
    const result = ready(adapt('session-unknown', [
      event('session-unknown', 1, { rir: 'unknown' }),
      event('session-unknown', 2, { rir: 'unknown' }),
    ]))
    const decision = decideStrengthProgression(progressionInput(
      buildProgressionReadySessionEvidence(result, [result]),
    ))
    expect(decision).toMatchObject({ status: 'not_proposed', reasonCodes: ['effort_unknown_hold'] })
  })
})

describe('buildProgressionReadySessionEvidence', () => {
  it('partitions live, cross-run, and same-run simulation evidence', () => {
    const target = ready(adapt('session-sim-target', [
      event('session-sim-target', 1, { context: firstSimulationContext }),
      event('session-sim-target', 2, { context: firstSimulationContext }),
    ], { context: firstSimulationContext }))
    const sameRun = ready(adapt('session-sim-prior', [
      event('session-sim-prior', 1, { context: firstSimulationContext }),
      event('session-sim-prior', 2, { context: firstSimulationContext }),
    ], { context: firstSimulationContext }))
    const live = ready(adapt('session-live'))
    const otherContext = {
      ...firstSimulationContext,
      simulationRunId: '22222222-2222-4222-8222-222222222222',
    }
    const otherRun = ready(adapt('session-sim-other', [
      event('session-sim-other', 1, { context: otherContext }),
      event('session-sim-other', 2, { context: otherContext }),
    ], { context: otherContext }))
    const otherSeries = ready(adapt('session-sim-series', [
      event('session-sim-series', 1, { context: firstSimulationContext }),
      event('session-sim-series', 2, { context: firstSimulationContext }),
    ], {
      context: firstSimulationContext,
      progressionSeriesId: 'strength-slot:pull',
    }))

    const bundle = buildProgressionReadySessionEvidence(target, [
      sameRun, target, live, otherRun, otherSeries, sameRun,
    ])
    expect(bundle.exposures.map(item => item.sourceRevisionId)).toEqual([
      sameRun.exposure.sourceRevisionId,
      target.exposure.sourceRevisionId,
    ])
    expect(bundle.excluded).toEqual([
      { sourceRevisionId: live.exposure.sourceRevisionId, reason: 'execution_context_mismatch' },
      { sourceRevisionId: otherRun.exposure.sourceRevisionId, reason: 'execution_context_mismatch' },
      { sourceRevisionId: otherSeries.exposure.sourceRevisionId, reason: 'progression_series_mismatch' },
      { sourceRevisionId: sameRun.exposure.sourceRevisionId, reason: 'duplicate_source_revision' },
    ])
  })

  it('produces two qualifying exposures for a proposal without applying it', () => {
    const first = ready(adapt('session-first', undefined, {
      metadataOverride: { ...metadata('session-first'), startedAt: '2026-09-03T17:00:00.000Z', completedAt: '2026-09-03T17:30:00.000Z' },
    }))
    const second = ready(adapt('session-second', undefined, {
      metadataOverride: { ...metadata('session-second'), startedAt: '2026-09-05T17:00:00.000Z', completedAt: '2026-09-05T17:30:00.000Z' },
    }))
    const bundle = buildProgressionReadySessionEvidence(second, [first, second])
    const decision = decideStrengthProgression(progressionInput(bundle))

    expect(bundle.exposures).toHaveLength(2)
    expect(decision).toMatchObject({
      kind: 'load_proposal',
      status: 'proposed',
      reasonCodes: ['two_ceiling_successes'],
      proposal: {
        load: { equipmentId: 'machine-1', basis: 'machine_stack', quantity: quantity('52') },
        targetReps: [6, 6],
      },
    })
    expect(bundle.prescription.prescribedLoad.quantity).toEqual(quantity('50'))
  })
})
