import { describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { readPreviousComparablePerformance } from './previous-performance'

const subjectId = '47000000-0000-4000-8000-000000000003'
const liveContext = { kind: 'live' as const }
const simulationContext = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'fixture-1', fixtureHash: 'b'.repeat(64), label: 'Practice data',
}

type ProjectionOptions = {
  readonly sessionId?: string
  readonly exerciseInstanceId?: string
  readonly sessionRevision?: number
  readonly state?: 'in_progress' | 'completed' | 'completed_with_omissions' | 'aborted'
  readonly stoppedForSymptoms?: boolean
  readonly completedAt?: string | null
  readonly progressionSeriesId?: string
  readonly exerciseVersionId?: string
  readonly equipmentId?: string
  readonly loadBasis?: 'barbell_total' | 'dumbbell_per_hand' | 'dumbbell_single_implement' | 'machine_stack'
    | 'bodyweight_external' | 'machine_assistance'
  readonly bodyweightAssistancePolicy?: { readonly policyId: string; readonly policyVersion: string }
  readonly side?: 'bilateral' | 'left' | 'right' | 'not_applicable'
  readonly rom?: string
  readonly tempo?: string
  readonly exposureType?: string
  readonly loadEpoch?: number
  readonly repRange?: { minimum: number; maximum: number }
  readonly targetRir?: { minimum: number; maximum: number }
  readonly context?: typeof liveContext | typeof simulationContext
  readonly eventContext?: typeof liveContext | typeof simulationContext
  readonly reps?: readonly number[]
  readonly rir?: number | '6_plus' | 'unknown'
  readonly symptomState?: 'none' | 'adverse_reported'
  readonly includeCorrection?: boolean
  readonly omitEvents?: boolean
  readonly eventSetKind?: 'working' | 'warmup' | 'extra'
}

function projection(options: ProjectionOptions = {}) {
  const sessionId = options.sessionId ?? 'session-prior'
  const exerciseInstanceId = options.exerciseInstanceId ?? `${sessionId}-press`
  const state = options.state ?? 'completed'
  const progressionSeriesId = options.progressionSeriesId ?? 'strength-slot:push'
  const context = options.context ?? liveContext
  const equipmentId = options.equipmentId ?? 'db-1'
  const loadBasis = options.loadBasis ?? 'dumbbell_per_hand'
  const side = options.side ?? 'bilateral'
  const reps = options.reps ?? [8, 7]
  const quantity = createLoadQuantity({
    value: loadBasis === 'bodyweight_external' ? '0' : loadBasis === 'machine_assistance' ? '30' : '22.50',
    unit: loadBasis === 'bodyweight_external' || loadBasis === 'machine_assistance' ? 'kg' : 'lb',
  })
  const implement = loadBasis === 'dumbbell_single_implement'
    ? { implementCount: 1 as const, holdingConfiguration: 'two_hands_single_implement' as const }
    : loadBasis === 'dumbbell_per_hand'
      ? { implementCount: 2 as const, holdingConfiguration: 'one_per_hand' as const }
      : loadBasis === 'barbell_total'
        ? { implementCount: 1 as const, holdingConfiguration: 'both_hands_barbell' as const }
        : loadBasis === 'bodyweight_external'
          ? { implementCount: 0 as const, holdingConfiguration: 'bodyweight_plus_external_load' as const }
          : loadBasis === 'machine_assistance'
            ? { implementCount: 1 as const, holdingConfiguration: 'machine_assistance' as const }
            : { implementCount: 1 as const, holdingConfiguration: 'machine_defined' as const }
  const catalogOrigin = context.kind === 'live'
    ? { kind: 'authored_catalog' as const }
    : {
        kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
        fixtureId: context.fixtureId, fixtureHash: context.fixtureHash, label: 'Synthetic starter catalog',
      }
  const setIds = reps.map((_, index) => `${exerciseInstanceId}-set-${index + 1}`)
  const acceptedInitialLoad = {
    status: 'accepted' as const, acceptanceId: `accept-${sessionId}`, acceptedAt: '2026-09-01T16:00:00Z',
    acceptedByUserId: 'athlete-1', source: 'equipment_inventory' as const,
    executionContext: context, exerciseInstanceId,
    exerciseVersionId: options.exerciseVersionId ?? 'floor-press.v1', equipmentId, loadBasis,
    ...implement, quantity,
    ...(options.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: options.bodyweightAssistancePolicy }
      : {}),
    provenance: {
      profileRevisionId: '1', compiledProgramRevisionId: 'compiled-1', catalogVersion: 'catalog-1',
      catalogOrigin,
    },
  }
  const progression = {
    progressionSeriesId, side, rom: options.rom ?? 'catalog_default',
    tempo: options.tempo ?? 'self_selected_controlled', exposureType: options.exposureType ?? 'standard',
    loadEpoch: options.loadEpoch ?? 1,
  }
  const events: Array<Record<string, unknown>> = options.omitEvents ? [] : reps.map((actualReps, index) => ({
    schemaVersion: 'training-set-log-event.v1' as const,
    eventId: `47000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    eventType: 'set_actual_recorded' as const, eventRevision: 1, replacesEventId: null,
    subjectId, sessionId, exerciseInstanceId, setId: setIds[index],
    setKind: options.eventSetKind ?? 'working' as const,
    workingSetOrdinal: options.eventSetKind && options.eventSetKind !== 'working' ? null : index + 1,
    executionContext: options.eventContext ?? context, equipmentId, loadBasis, quantity,
    reps: actualReps, rir: options.rir ?? 'unknown' as const, side,
    symptomState: options.symptomState ?? 'none' as const,
    actor: { kind: 'athlete' as const, userId: 'athlete-1' },
    occurredAt: `2026-09-01T17:${10 + index}:00.000Z`, serverAt: `2026-09-01T17:${10 + index}:01.000Z`,
  }))
  if (options.includeCorrection) {
    events.push({
      ...events[0], eventId: '47000000-0000-4000-8000-000000000099',
      eventType: 'set_actual_corrected', eventRevision: 2, replacesEventId: events[0].eventId,
      reps: 9, occurredAt: '2026-09-01T17:20:00.000Z', serverAt: '2026-09-01T17:20:01.000Z',
    })
  }
  return {
    session: {
      sessionId, revision: options.sessionRevision ?? 4, state,
      stoppedForSymptoms: options.stoppedForSymptoms ?? false,
    },
    executionContext: context,
    prescription: {
      schemaVersion: 'training-session-prescription.v1', sessionId, assignmentId: 'assignment-1',
      programRevisionNumber: 1, subjectId, executionContext: context,
      scheduledLocalDate: '2026-09-01', athleteTimezone: 'UTC', profileRevisionId: '1',
      eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogVersion: 'catalog-1', catalogOrigin, ruleVersion: 'progression.v1',
      compiledProgramRevisionId: 'compiled-1', exercises: [{
        exerciseInstanceId, exerciseVersionId: options.exerciseVersionId ?? 'floor-press.v1', setIds,
        repRange: options.repRange ?? { minimum: 6, maximum: 8 },
        targetRir: options.targetRir ?? { minimum: 2, maximum: 3 }, restSeconds: 120,
        progression, acceptedInitialLoad,
      }],
    },
    exerciseInstanceId,
    currentEvents: events,
    metadata: {
      schemaVersion: 'strength-session-progression-metadata.v1',
      prescriptionSourceRevisionId: `training-session-prescription.v1:sha256:${'a'.repeat(64)}`,
      progressionSeriesId, startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: Object.hasOwn(options, 'completedAt')
        ? options.completedAt
        : state === 'in_progress' ? null : '2026-09-01T17:30:00.000Z',
      comparator: {
        side, rom: progression.rom, tempo: progression.tempo,
        exposureType: progression.exposureType, loadEpoch: progression.loadEpoch,
      },
    },
  }
}

function sources(
  history: readonly { scheduledLocalDate: string; evidence: unknown }[],
  currentOptions: ProjectionOptions = {},
) {
  return {
    current: projection({
      sessionId: 'session-current', exerciseInstanceId: 'press-current', state: 'in_progress',
      completedAt: null, omitEvents: true, ...currentOptions,
    }),
    history,
  }
}

describe('readPreviousComparablePerformance', () => {
  it('returns the latest exact comparable completed exposure after collapsing corrections', async () => {
    const older = projection({ sessionId: 'session-older', exerciseInstanceId: 'press-older' })
    const latest = projection({
      sessionId: 'session-latest', exerciseInstanceId: 'press-latest',
      sessionRevision: 7, includeCorrection: true,
    })
    const rpc = vi.fn().mockResolvedValue({ data: sources([
      { scheduledLocalDate: '2026-08-25', evidence: older },
      { scheduledLocalDate: '2026-09-01', evidence: latest },
    ]), error: null })

    const result = await readPreviousComparablePerformance({ rpc }, 'session-current', 'press-current')

    expect(rpc).toHaveBeenCalledWith('read_training_previous_performance_sources', {
      p_session_id: 'session-current', p_exercise_instance_id: 'press-current',
    })
    expect(result).toMatchObject({
      schemaVersion: 'training-previous-performance.v1',
      request: { sessionId: 'session-current', exerciseInstanceId: 'press-current' },
      result: {
        kind: 'available',
        source: {
          sessionId: 'session-latest', exerciseInstanceId: 'press-latest', sessionRevision: 7,
          scheduledLocalDate: '2026-09-01', completedAt: '2026-09-01T17:30:00.000Z',
          effectiveEvents: [{ eventId: '47000000-0000-4000-8000-000000000099', eventRevision: 2 }, { eventRevision: 1 }],
        },
        sets: [
          { ordinal: 1, reps: 9, rir: 'unknown', load: { quantity: { entered: { value: '22.50', unit: 'lb' } } } },
          { ordinal: 2, reps: 7, rir: 'unknown' },
        ],
      },
    })
  })

  it.each([
    ['exercise version', { exerciseVersionId: 'incline-press.v1' }],
    ['equipment', { equipmentId: 'db-2' }],
    ['load basis', { loadBasis: 'dumbbell_single_implement' as const }],
    ['side', { side: 'left' as const }],
    ['ROM', { rom: 'short_range' }],
    ['tempo', { tempo: 'paused' }],
    ['working-set count', { reps: [8] }],
    ['rep range', { repRange: { minimum: 8, maximum: 10 } }],
    ['target RIR', { targetRir: { minimum: 1, maximum: 2 } }],
    ['track', { exposureType: 'volume' }],
    ['load epoch', { loadEpoch: 2 }],
    ['progression series', { progressionSeriesId: 'strength-slot:other' }],
    ['execution context', { context: simulationContext, eventContext: simulationContext }],
  ] as const)('does not cross the %s comparator boundary', async (_label, overrides) => {
    const rpc = vi.fn().mockResolvedValue({
      data: sources([{ scheduledLocalDate: '2026-09-01', evidence: projection(overrides) }]), error: null,
    })
    await expect(readPreviousComparablePerformance({ rpc }, 'session-current', 'press-current'))
      .resolves.toMatchObject({ result: { kind: 'none', reason: 'no_comparable_completed_exposure' } })
  })

  it('requires and returns the exact immutable bodyweight policy identity', async () => {
    const policy = { policyId: 'bodyweight-rep-only', policyVersion: '1' }
    const matching = projection({
      sessionId: 'session-bodyweight-prior', exerciseInstanceId: 'bodyweight-prior',
      equipmentId: 'bodyweight-station', loadBasis: 'bodyweight_external',
      bodyweightAssistancePolicy: policy,
    })
    const rpc = vi.fn().mockResolvedValue({
      data: sources(
        [{ scheduledLocalDate: '2026-09-01', evidence: matching }],
        {
          equipmentId: 'bodyweight-station', loadBasis: 'bodyweight_external',
          bodyweightAssistancePolicy: policy,
        },
      ),
      error: null,
    })

    await expect(readPreviousComparablePerformance({ rpc }, 'session-current', 'press-current'))
      .resolves.toMatchObject({
        result: { kind: 'available', source: { bodyweightAssistancePolicy: policy } },
      })
  })

  it('does not compare bodyweight or assistance evidence across policy versions', async () => {
    const currentPolicy = { policyId: 'assistance-rep-only', policyVersion: '2' }
    const prior = projection({
      sessionId: 'session-assistance-prior', exerciseInstanceId: 'assistance-prior',
      exerciseVersionId: 'assisted-pullup.v1', equipmentId: 'assistance-machine',
      loadBasis: 'machine_assistance',
      bodyweightAssistancePolicy: { ...currentPolicy, policyVersion: '1' },
    })
    const rpc = vi.fn().mockResolvedValue({
      data: sources(
        [{ scheduledLocalDate: '2026-09-01', evidence: prior }],
        {
          exerciseVersionId: 'assisted-pullup.v1', equipmentId: 'assistance-machine',
          loadBasis: 'machine_assistance', bodyweightAssistancePolicy: currentPolicy,
        },
      ),
      error: null,
    })

    await expect(readPreviousComparablePerformance({ rpc }, 'session-current', 'press-current'))
      .resolves.toMatchObject({
        result: { kind: 'none', reason: 'no_comparable_completed_exposure' },
      })
  })

  it.each([
    ['incomplete', { reps: [8, 0] }],
    ['omitted', { state: 'completed_with_omissions' as const, omitEvents: true }],
    ['aborted', { state: 'aborted' as const }],
    ['symptom stopped', { stoppedForSymptoms: true }],
    ['adverse symptom', { symptomState: 'adverse_reported' as const }],
  ] as const)('does not display %s evidence as a comparator', async (_label, overrides) => {
    const rpc = vi.fn().mockResolvedValue({
      data: sources([{ scheduledLocalDate: '2026-09-01', evidence: projection(overrides) }]), error: null,
    })
    await expect(readPreviousComparablePerformance({ rpc }, 'session-current', 'press-current'))
      .resolves.toMatchObject({ result: { kind: 'none' } })
  })

  it('distinguishes current, historical, persistence, and invisible-source failures', async () => {
    const currentInvalid = vi.fn().mockResolvedValue({ data: { ...sources([]), current: null }, error: null })
    await expect(readPreviousComparablePerformance({ rpc: currentInvalid }, 'session-current', 'press-current'))
      .resolves.toMatchObject({ result: { kind: 'unavailable', reason: 'current_comparator_unavailable' } })

    const historicalInvalid = vi.fn().mockResolvedValue({
      data: sources([{ scheduledLocalDate: '2026-09-01', evidence: null }]), error: null,
    })
    await expect(readPreviousComparablePerformance({ rpc: historicalInvalid }, 'session-current', 'press-current'))
      .resolves.toMatchObject({ result: { kind: 'unavailable', reason: 'historical_evidence_unavailable' } })

    const failed = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000' } })
    await expect(readPreviousComparablePerformance({ rpc: failed }, 'session-current', 'press-current'))
      .resolves.toMatchObject({ result: { kind: 'unavailable', reason: 'persistence_unavailable' } })

    const hidden = vi.fn().mockResolvedValue({ data: null, error: null })
    await expect(readPreviousComparablePerformance({ rpc: hidden }, 'session-current', 'press-current'))
      .resolves.toEqual({ kind: 'not_found' })
  })

  it('does not call persistence for invalid identifiers', async () => {
    const rpc = vi.fn()
    await expect(readPreviousComparablePerformance({ rpc }, 'bad id', 'press-current'))
      .resolves.toEqual({ kind: 'invalid_request' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a source envelope whose current resource identity does not match the request', async () => {
    const mismatched = sources([])
    mismatched.current = projection({
      sessionId: 'session-other', exerciseInstanceId: 'press-other', state: 'in_progress',
      completedAt: null, omitEvents: true,
    })
    const rpc = vi.fn().mockResolvedValue({ data: mismatched, error: null })
    await expect(readPreviousComparablePerformance({ rpc }, 'session-current', 'press-current'))
      .resolves.toMatchObject({ result: { kind: 'unavailable', reason: 'current_comparator_unavailable' } })
  })
})
