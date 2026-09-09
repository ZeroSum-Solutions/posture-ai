import { describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { loadProgramWorkspace } from './program-workspace'

const subjectId = '45000000-0000-4000-8000-000000000003'
const assignmentId = 'assignment-1'
const quantity = createLoadQuantity({ value: '10', unit: 'kg' })
const baseLoad = (exerciseInstanceId: string) => ({
  status: 'accepted' as const, acceptanceId: `accept:${exerciseInstanceId}`, acceptedAt: '2026-09-08T12:00:00.000Z',
  acceptedByUserId: 'user-1', source: 'equipment_inventory' as const, executionContext: { kind: 'live' as const },
  exerciseInstanceId, exerciseVersionId: 'squat.v1', equipmentId: 'db-1', loadBasis: 'dumbbell_single_implement' as const,
  implementCount: 1 as const, holdingConfiguration: 'two_hands_single_implement' as const,
  provenance: { profileRevisionId: '3', compiledProgramRevisionId: 'compiled-1', catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const } },
  quantity,
})
const strengthPlan = (sessionId: string, date: string, includeWarmup = false) => ({
  sessionId, scheduledLocalDate: date, athleteTimezone: 'UTC',
  exercises: [{
    exerciseInstanceId: `exercise:${sessionId}`, exerciseVersionId: 'squat.v1', setIds: [`set:${sessionId}`],
    repRange: { minimum: 6, maximum: 8 }, targetReps: [7], targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
    acceptedInitialLoad: baseLoad(`exercise:${sessionId}`),
    ...(includeWarmup ? { warmupSets: [{
      setId: `warmup:${sessionId}`, targetReps: 5,
      prescribedLoad: createLoadQuantity({ value: '5.0', unit: 'kg' }),
    }] } : {}),
  }],
})
const conditioningPlan = (boutId: string, date: string) => ({
  status: 'accepted' as const, acceptanceId: `accept:${boutId}`, acceptedAt: '2026-09-08T12:00:00.000Z', acceptedByUserId: 'user-1',
  executionContext: { kind: 'live' as const }, boutId, modalityId: 'walk.v1', scheduledLocalDate: date, athleteTimezone: 'UTC',
  acceptedDurationSeconds: 600, effortCue: 'Comfortable pace.',
  source: { compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const } },
})

function fixture(options: { includeWarmup?: boolean; includeWorkingActual?: boolean } = {}) {
  const program = {
    schemaVersion: 'training-program-revision.v1' as const, assignmentId, revisionNumber: 2, subjectId,
    programMode: 'self_directed' as const, owningPractitionerId: null, executionContext: { kind: 'live' as const },
    cycleStartLocalDate: '2026-09-08', cycleLengthWeeks: 12 as const, profileRevisionId: '3', eligibilitySourceRevisionId: 'eligibility-1',
    compilerPolicyVersion: 'strength-cycle-compiler.v3' as const, catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const },
    ruleVersion: 'rules-1', compiledProgramRevisionId: 'compiled-1', publishedAt: '2026-09-08T12:00:00.000Z',
    author: { kind: 'athlete' as const, userId: 'user-1' },
    sessions: [strengthPlan('strength-1', '2026-09-08', options.includeWarmup), strengthPlan('strength-2', '2026-09-15')],
    conditioningBouts: [conditioningPlan('conditioning-1', '2026-09-09')],
  }
  const rows = [
    { id: 'strength-1', subject_id: subjectId, assignment_id: assignmentId, session_kind: 'strength', state: 'completed', scheduled_local_date: '2026-09-08', athlete_timezone: 'UTC', revision: 3, stopped_for_symptoms: false, completed_at: '2026-09-08T15:00:00.000Z' },
    { id: 'conditioning-1', subject_id: subjectId, assignment_id: assignmentId, session_kind: 'conditioning', state: 'in_progress', scheduled_local_date: '2026-09-09', athlete_timezone: 'UTC', revision: 2, stopped_for_symptoms: false, completed_at: null },
    { id: 'strength-2', subject_id: subjectId, assignment_id: assignmentId, session_kind: 'strength', state: 'scheduled', scheduled_local_date: '2026-09-15', athlete_timezone: 'UTC', revision: 1, stopped_for_symptoms: false, completed_at: null },
  ]
  const assignment = { id: assignmentId, subject_id: subjectId, program_mode: 'self_directed', owning_practitioner_id: null, simulation_run_id: null, source_draft_id: '45000000-0000-4000-8000-000000000006', status: 'active', active_revision: 2, revision: 1, created_at: '2026-09-08T12:00:00.000Z' }
  const reads = new Map(rows.map(row => {
    const planned = row.session_kind === 'strength' ? program.sessions.find(item => item.sessionId === row.id)! : program.conditioningBouts.find(item => item.boutId === row.id)!
    const prescription = row.state === 'scheduled' ? null : row.session_kind === 'strength' ? {
      schemaVersion: 'training-session-prescription.v1', sessionId: row.id, assignmentId, programRevisionNumber: 2, subjectId,
      executionContext: { kind: 'live' }, scheduledLocalDate: row.scheduled_local_date, athleteTimezone: 'UTC', profileRevisionId: '3',
      eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: 'catalog-1',
      catalogOrigin: { kind: 'authored_catalog' }, ruleVersion: 'rules-1', compiledProgramRevisionId: 'compiled-1', exercises: 'exercises' in planned ? planned.exercises.map(exercise => ({
        ...exercise,
        acceptedInitialLoad: { ...exercise.acceptedInitialLoad, quantity: createLoadQuantity({ value: '11', unit: 'kg' }) },
      })) : [],
    } : {
      schemaVersion: 'training-conditioning-session-prescription.v1', sessionId: row.id, assignmentId, programRevisionNumber: 2, subjectId,
      executionContext: { kind: 'live' }, catalogOrigin: { kind: 'authored_catalog' }, compiledProgramRevisionId: 'compiled-1', acceptedBout: planned,
    }
    const warmupActual = row.id === 'strength-1' && options.includeWarmup ? [{
      schemaVersion: 'training-set-log-event.v1', eventId: 'event-warmup-1', eventType: 'set_actual_recorded', eventRevision: 1, replacesEventId: null,
      subjectId, sessionId: row.id, exerciseInstanceId: 'exercise:strength-1', setId: 'warmup:strength-1', setKind: 'warmup', workingSetOrdinal: null,
      executionContext: { kind: 'live' }, equipmentId: 'db-1', loadBasis: 'dumbbell_single_implement', quantity: createLoadQuantity({ value: '5.0', unit: 'kg' }),
      reps: 5, rir: 'unknown', side: 'bilateral', symptomState: 'none', actor: { kind: 'athlete', userId: 'user-1' }, occurredAt: '2026-09-08T13:55:00.000Z', serverAt: '2026-09-08T13:55:01.000Z',
    }] : []
    const workingActual = row.id === 'strength-1' && options.includeWorkingActual !== false ? [{
      schemaVersion: 'training-set-log-event.v1', eventId: 'event-1', eventType: 'set_actual_recorded', eventRevision: 1, replacesEventId: null,
      subjectId, sessionId: row.id, exerciseInstanceId: 'exercise:strength-1', setId: 'set:strength-1', setKind: 'working', workingSetOrdinal: 1,
      executionContext: { kind: 'live' }, equipmentId: 'db-1', loadBasis: 'dumbbell_single_implement', quantity: createLoadQuantity({ value: '12.5', unit: 'kg' }),
      reps: 7, rir: 2, side: 'bilateral', symptomState: 'none', actor: { kind: 'athlete', userId: 'user-1' }, occurredAt: '2026-09-08T14:00:00.000Z', serverAt: '2026-09-08T14:00:01.000Z',
    }] : []
    const actual = [...warmupActual, ...workingActual]
    return [row.id, {
      schemaVersion: 'training-session-projection.v1', session: row, executionContext: { kind: 'live' }, prescription,
      currentActuals: actual, currentConditioningActual: null, exerciseDisplay: row.session_kind === 'strength' ? { [`exercise:${row.id}`]: { label: 'Goblet squat', textInstruction: 'Instruction', mediaStatus: 'missing' } } : {},
      conditioningDisplay: row.session_kind === 'conditioning' ? { label: 'Walking', effortCue: 'Comfortable pace.' } : null,
    }]
  }))
  return { program, rows, assignment, reads }
}

function dependencies(value = fixture()) {
  return {
    now: () => new Date('2026-09-09T12:00:00.000Z'),
    readProgram: async () => ({ assignment: value.assignment, program: value.program }),
    listSessionRows: async () => value.rows,
    readSession: async (id: string) => value.reads.get(id) ?? null,
  }
}

describe('loadProgramWorkspace', () => {
  it('shows the in-progress session as Today and keeps exact conditioning plan values', async () => {
    const result = await loadProgramWorkspace(dependencies() as never, { assignmentId, view: 'today', limit: 1, cursor: null })
    expect(result.kind).toBe('found')
    if (result.kind !== 'found') return
    expect(result.value).toMatchObject({ assignment: { cycleLengthWeeks: 12 }, focus: 'in_progress' })
    expect(result.value.sessions[0]).toMatchObject({ sessionId: 'conditioning-1', planned: { durationSeconds: 600 }, actual: { recorded: null } })
  })

  it('pages every program session and preserves immutable planned versus exact current actual values', async () => {
    const first = await loadProgramWorkspace(dependencies() as never, { assignmentId, view: 'program', limit: 1, cursor: null })
    expect(first.kind).toBe('found')
    if (first.kind !== 'found') return
    expect(first.value.sessions[0]).toMatchObject({
      sessionId: 'strength-1',
      planned: { exercises: [{ label: 'Goblet squat', load: { quantity: { entered: { value: '11', unit: 'kg' } } } }] },
      actual: { recordedSetCount: 1, omittedSetCount: 0, sets: [{ quantity: { entered: { value: '12.5', unit: 'kg' } }, reps: 7, rir: 2 }] },
    })
    expect(first.value.nextCursor).toEqual(expect.any(String))
    const second = await loadProgramWorkspace(dependencies() as never, { assignmentId, view: 'program', limit: 1, cursor: first.value.nextCursor })
    expect(second.kind).toBe('found')
    if (second.kind === 'found') expect(second.value.sessions[0].sessionId).toBe('conditioning-1')
  })

  it('projects a real warm-up-only session as zero working sets recorded with every working set omitted', async () => {
    const result = await loadProgramWorkspace(dependencies(fixture({ includeWarmup: true, includeWorkingActual: false })) as never, {
      assignmentId, view: 'program', limit: 1, cursor: null,
    })
    expect(result.kind).toBe('found')
    if (result.kind !== 'found') return
    expect(result.value.sessions[0]).toMatchObject({
      planned: { exercises: [{ warmupSets: [{
        setId: 'warmup:strength-1', targetReps: 5,
        load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '5.0', unit: 'kg' } } },
      }] }] },
      actual: {
        prescribedSetCount: 1, recordedSetCount: 0, omittedSetCount: 1,
        sets: [{ setId: 'warmup:strength-1', setKind: 'warmup', workingSetOrdinal: null }],
      },
    })
  })

  it('preserves mixed warm-up and working history while counting only the authored working set', async () => {
    const result = await loadProgramWorkspace(dependencies(fixture({ includeWarmup: true })) as never, {
      assignmentId, view: 'program', limit: 1, cursor: null,
    })
    expect(result.kind).toBe('found')
    if (result.kind !== 'found') return
    expect(result.value.sessions[0].actual).toMatchObject({
      prescribedSetCount: 1, recordedSetCount: 1, omittedSetCount: 0,
      sets: [{ setKind: 'warmup' }, { setKind: 'working' }],
    })
  })

  it('filters history to terminal durable sessions', async () => {
    const result = await loadProgramWorkspace(dependencies() as never, { assignmentId, view: 'history', limit: 12, cursor: null })
    expect(result.kind).toBe('found')
    if (result.kind === 'found') expect(result.value.sessions.map(session => session.sessionId)).toEqual(['strength-1'])
  })

  it('uses a newer authorized session snapshot when a log lands during the paged read', async () => {
    const raced = fixture()
    const current = raced.reads.get('conditioning-1')!
    raced.reads.set('conditioning-1', {
      ...current,
      session: { ...current.session, revision: 3, state: 'completed', completed_at: '2026-09-09T13:00:00.000Z' },
    })
    const result = await loadProgramWorkspace(dependencies(raced) as never, { assignmentId, view: 'program', limit: 2, cursor: null })
    expect(result.kind).toBe('found')
    if (result.kind === 'found') expect(result.value.sessions[1]).toMatchObject({ sessionId: 'conditioning-1', revision: 3, state: 'completed' })
  })

  it('fails closed for missing session cardinality or a cross-assignment session projection', async () => {
    const missing = dependencies()
    missing.listSessionRows = async () => fixture().rows.slice(0, 2)
    expect((await loadProgramWorkspace(missing as never, { assignmentId, view: 'program', limit: 12, cursor: null })).kind).toBe('unavailable')

    const crossed = fixture()
    crossed.reads.set('strength-1', { ...crossed.reads.get('strength-1')!, session: { ...crossed.reads.get('strength-1')!.session, assignment_id: 'assignment-other' } })
    expect((await loadProgramWorkspace(dependencies(crossed) as never, { assignmentId, view: 'program', limit: 12, cursor: null })).kind).toBe('unavailable')
  })

  it('does not expose a live program through a simulation assignment row', async () => {
    const base = fixture()
    const mismatched = { ...base, assignment: { ...base.assignment, simulation_run_id: '45000000-0000-4000-8000-000000000004' } }
    expect((await loadProgramWorkspace(dependencies(mismatched as never) as never, { assignmentId, view: 'program', limit: 12, cursor: null })).kind).toBe('unavailable')
  })

  it('rejects a cursor when the active revision changes', async () => {
    const first = await loadProgramWorkspace(dependencies() as never, { assignmentId, view: 'program', limit: 1, cursor: null })
    if (first.kind !== 'found') throw new Error('fixture failed')
    const changed = fixture()
    changed.assignment.active_revision = 3
    changed.program.revisionNumber = 3
    expect((await loadProgramWorkspace(dependencies(changed) as never, { assignmentId, view: 'program', limit: 1, cursor: first.value.nextCursor })).kind).toBe('stale_cursor')
  })
})

describe('programWorkspaceDependencies', () => {
  it('uses the caller authenticated client for an assignment-bound session index and session RPC reads', async () => {
    const rpc = vi.fn(async (name: string) => name === 'read_training_program_projection'
      ? { data: { assignment: {}, program: {} }, error: null }
      : { data: null, error: null })
    const limit = vi.fn(async () => ({ data: [], error: null }))
    const secondOrder = vi.fn(() => ({ limit }))
    const firstOrder = vi.fn(() => ({ order: secondOrder }))
    const eq = vi.fn(() => ({ order: firstOrder }))
    const select = vi.fn(() => ({ eq }))
    const { programWorkspaceDependencies } = await import('./program-workspace')
    const deps = programWorkspaceDependencies({ rpc, from: () => ({ select }) } as never)

    await expect(deps.readProgram(assignmentId)).resolves.toEqual({ assignment: {}, program: {} })
    await expect(deps.listSessionRows(assignmentId)).resolves.toEqual([])
    await expect(deps.readSession('hidden-session')).resolves.toBeNull()
    expect(rpc).toHaveBeenNthCalledWith(1, 'read_training_program_projection', { p_assignment_id: assignmentId })
    expect(eq).toHaveBeenCalledWith('assignment_id', assignmentId)
    expect(limit).toHaveBeenCalledWith(100)
    expect(rpc).toHaveBeenNthCalledWith(2, 'read_training_session_projection', { p_session_id: 'hidden-session' })
  })
})
