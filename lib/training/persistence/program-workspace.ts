import { z } from 'zod'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  TrainingProgramRevisionV1Schema,
  executionContextsMatch,
  type TrainingProgramRevisionV1,
} from '../contracts/program'
import type {
  TrainingConditioningSessionPrescriptionV1,
  TrainingSessionPrescriptionV1,
} from '../contracts/session'
import {
  TrainingProgramWorkspaceProjectionSchema,
  type TrainingProgramWorkspaceProjection,
  type TrainingProgramWorkspaceSession,
  type TrainingProgramWorkspaceView,
} from '../contracts/program-workspace'
import { readTrainingSessionProjection } from './session-http'
import { trainingSessionDisplay } from './session-display'

type TrainingClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type SessionRead = Extract<Awaited<ReturnType<typeof readTrainingSessionProjection>>, { kind: 'found' }>['value']

const assignmentSchema = z.object({
  id: z.string().min(1).max(128),
  subject_id: z.string().uuid(),
  program_mode: z.enum(['self_directed', 'coach_assigned']),
  owning_practitioner_id: z.string().uuid().nullable(),
  simulation_run_id: z.string().uuid().nullable(),
  source_draft_id: z.string().uuid(),
  status: z.enum(['active', 'ended']),
  active_revision: z.number().int().positive(),
  revision: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
}).strict()

const programProjectionSchema = z.object({
  assignment: assignmentSchema,
  program: TrainingProgramRevisionV1Schema,
}).strict()

const sessionRowSchema = z.object({
  id: z.string().min(1).max(128),
  subject_id: z.string().uuid(),
  assignment_id: z.string().min(1).max(128),
  session_kind: z.enum(['strength', 'conditioning']),
  state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  scheduled_local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  athlete_timezone: z.string().trim().min(1).max(100),
  revision: z.number().int().positive(),
  stopped_for_symptoms: z.boolean(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

type SessionRow = z.infer<typeof sessionRowSchema>

type ProgramWorkspaceDependencies = {
  now: () => Date
  readProgram: (assignmentId: string) => Promise<unknown | null | 'unavailable'>
  listSessionRows: (assignmentId: string) => Promise<unknown[] | 'unavailable'>
  readSession: (sessionId: string) => Promise<SessionRead | null | 'unavailable'>
}

type WorkspaceInput = {
  assignmentId: string
  view: TrainingProgramWorkspaceView
  limit: number
  cursor: string | null
}

export type ProgramWorkspaceResult =
  | { kind: 'found'; value: TrainingProgramWorkspaceProjection }
  | { kind: 'not_found' | 'unavailable' | 'stale_cursor' }

const cursorSchema = z.object({
  version: z.literal(1),
  assignmentId: z.string().min(1).max(128),
  revisionNumber: z.number().int().positive(),
  view: z.enum(['program', 'history']),
  offset: z.number().int().min(1).max(100),
}).strict()

function encodeCursor(input: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null) {
  if (value === null || value.length > 1_024) return value === null ? null : undefined
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    return undefined
  }
}

function localDateInTimezone(now: Date, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value
    const year = part('year'); const month = part('month'); const day = part('day')
    return year && month && day ? `${year}-${month}-${day}` : null
  } catch {
    return null
  }
}

function plannedPrescription(program: TrainingProgramRevisionV1, row: SessionRow) {
  if (row.session_kind === 'strength') {
    const plan = program.sessions.find(item => item.sessionId === row.id)
    if (!plan) return null
    return {
      schemaVersion: 'training-session-prescription.v1',
      sessionId: row.id,
      assignmentId: program.assignmentId,
      programRevisionNumber: program.revisionNumber,
      subjectId: program.subjectId,
      executionContext: program.executionContext,
      scheduledLocalDate: plan.scheduledLocalDate,
      athleteTimezone: plan.athleteTimezone,
      profileRevisionId: program.profileRevisionId,
      eligibilitySourceRevisionId: program.eligibilitySourceRevisionId,
      compilerPolicyVersion: program.compilerPolicyVersion,
      catalogVersion: program.catalogVersion,
      catalogOrigin: program.catalogOrigin,
      ruleVersion: program.ruleVersion,
      compiledProgramRevisionId: program.compiledProgramRevisionId,
      exercises: plan.exercises,
    } satisfies TrainingSessionPrescriptionV1
  }
  const bout = program.conditioningBouts.find(item => item.boutId === row.id)
  if (!bout) return null
  return {
    schemaVersion: 'training-conditioning-session-prescription.v1',
    sessionId: row.id,
    assignmentId: program.assignmentId,
    programRevisionNumber: program.revisionNumber,
    subjectId: program.subjectId,
    executionContext: program.executionContext,
    catalogOrigin: program.catalogOrigin,
    compiledProgramRevisionId: program.compiledProgramRevisionId,
    acceptedBout: bout,
  } satisfies TrainingConditioningSessionPrescriptionV1
}

function summarizeSession(program: TrainingProgramRevisionV1, row: SessionRow, read: SessionRead): TrainingProgramWorkspaceSession | null {
  const cycleStartMs = Date.parse(`${program.cycleStartLocalDate}T00:00:00.000Z`)
  const sessionDateMs = Date.parse(`${row.scheduled_local_date}T00:00:00.000Z`)
  const weekNumber = Math.floor((sessionDateMs - cycleStartMs) / 604_800_000) + 1
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > program.cycleLengthWeeks) return null
  if (read.session.id !== row.id || read.session.assignment_id !== program.assignmentId
    || read.session.subject_id !== program.subjectId || read.session.session_kind !== row.session_kind
    || read.session.scheduled_local_date !== row.scheduled_local_date
    || read.session.athlete_timezone !== row.athlete_timezone
    || !executionContextsMatch(read.executionContext, program.executionContext)) return null

  const prescription = read.prescription ?? plannedPrescription(program, row)
  if (!prescription || prescription.sessionId !== row.id || prescription.assignmentId !== program.assignmentId) return null
  const display = read.prescription
    ? { exerciseDisplay: read.exerciseDisplay, conditioningDisplay: read.conditioningDisplay }
    : trainingSessionDisplay(prescription)

  if (prescription.schemaVersion === 'training-session-prescription.v1') {
    const prescribedWorkingSets = new Map(prescription.exercises.flatMap(exercise =>
      exercise.setIds.map(setId => [setId, exercise.exerciseInstanceId] as const),
    ))
    const prescribedSetCount = prescribedWorkingSets.size
    const actualSets = read.currentActuals.map(actual => ({
      setId: actual.setId,
      exerciseInstanceId: actual.exerciseInstanceId,
      setKind: actual.setKind,
      workingSetOrdinal: actual.workingSetOrdinal,
      quantity: actual.quantity,
      reps: actual.reps,
      rir: actual.rir,
      side: actual.side,
      symptomState: actual.symptomState,
      occurredAt: actual.occurredAt,
    }))
    const recordedWorkingSetCount = new Set(actualSets
      .filter(actual => actual.setKind === 'working'
        && prescribedWorkingSets.get(actual.setId) === actual.exerciseInstanceId)
      .map(actual => actual.setId)).size
    return {
      sessionId: row.id,
      kind: 'strength',
      state: read.session.state,
      scheduledLocalDate: read.session.scheduled_local_date,
      weekNumber,
      athleteTimezone: read.session.athlete_timezone,
      revision: read.session.revision,
      completedAt: read.session.completed_at ?? null,
      stoppedForSymptoms: read.session.stopped_for_symptoms,
      planned: {
        kind: 'strength',
        exercises: prescription.exercises.map(exercise => ({
          exerciseInstanceId: exercise.exerciseInstanceId,
          label: display.exerciseDisplay[exercise.exerciseInstanceId]?.label ?? null,
          setIds: exercise.setIds,
          ...(exercise.warmupSets?.length ? { warmupSets: exercise.warmupSets.map(warmup => ({
            setId: warmup.setId,
            targetReps: warmup.targetReps,
            load: { basis: exercise.acceptedInitialLoad.loadBasis, quantity: warmup.prescribedLoad },
          })) } : {}),
          targetReps: exercise.targetReps ?? null,
          repRange: exercise.repRange,
          targetRir: exercise.targetRir,
          restSeconds: exercise.restSeconds,
          side: exercise.progression?.side ?? null,
          load: { basis: exercise.acceptedInitialLoad.loadBasis, quantity: exercise.acceptedInitialLoad.quantity },
        })),
      },
      actual: {
        kind: 'strength',
        prescribedSetCount,
        recordedSetCount: recordedWorkingSetCount,
        omittedSetCount: Math.max(0, prescribedSetCount - recordedWorkingSetCount),
        sets: actualSets,
      },
    }
  }

  if (read.currentActuals.length > 0) return null
  return {
    sessionId: row.id,
    kind: 'conditioning',
    state: read.session.state,
    scheduledLocalDate: read.session.scheduled_local_date,
    weekNumber,
    athleteTimezone: read.session.athlete_timezone,
    revision: read.session.revision,
    completedAt: read.session.completed_at ?? null,
    stoppedForSymptoms: read.session.stopped_for_symptoms,
    planned: {
      kind: 'conditioning',
      boutId: prescription.acceptedBout.boutId,
      label: display.conditioningDisplay?.label ?? null,
      durationSeconds: prescription.acceptedBout.acceptedDurationSeconds,
      effortCue: display.conditioningDisplay?.effortCue ?? prescription.acceptedBout.effortCue,
    },
    actual: {
      kind: 'conditioning',
      recorded: read.currentConditioningActual ? {
        durationSeconds: read.currentConditioningActual.durationSeconds,
        perceivedEffort: read.currentConditioningActual.perceivedEffort,
        symptomState: read.currentConditioningActual.symptomState,
        occurredAt: read.currentConditioningActual.occurredAt,
      } : null,
    },
  }
}

function selectRows(rows: SessionRow[], view: TrainingProgramWorkspaceView, now: Date) {
  if (view === 'program') return { focus: 'none' as const, rows }
  if (view === 'history') return {
    focus: 'none' as const,
    rows: rows.filter(row => ['completed', 'completed_with_omissions', 'aborted'].includes(row.state))
      .sort((left, right) => (right.completed_at ?? right.scheduled_local_date).localeCompare(left.completed_at ?? left.scheduled_local_date) || right.id.localeCompare(left.id)),
  }

  const inProgress = rows.filter(row => row.state === 'in_progress')
  if (inProgress.length > 0) return { focus: 'in_progress' as const, rows: inProgress }
  const timezone = rows[0]?.athlete_timezone
  const today = timezone ? localDateInTimezone(now, timezone) : null
  if (today) {
    const todayRows = rows.filter(row => row.scheduled_local_date === today)
    if (todayRows.length > 0) return { focus: 'today' as const, rows: todayRows }
    const nextDate = rows.find(row => row.state === 'scheduled' && row.scheduled_local_date > today)?.scheduled_local_date
    if (nextDate) return { focus: 'next' as const, rows: rows.filter(row => row.scheduled_local_date === nextDate) }
  }
  const terminal = rows.filter(row => ['completed', 'completed_with_omissions', 'aborted'].includes(row.state)).at(-1)
  return terminal ? { focus: 'most_recent' as const, rows: [terminal] } : { focus: 'none' as const, rows: [] }
}

export async function loadProgramWorkspace(dependencies: ProgramWorkspaceDependencies, input: WorkspaceInput): Promise<ProgramWorkspaceResult> {
  const rawProgram = await dependencies.readProgram(input.assignmentId)
  if (rawProgram === 'unavailable') return { kind: 'unavailable' }
  if (rawProgram === null) return { kind: 'not_found' }
  const parsed = programProjectionSchema.safeParse(rawProgram)
  if (!parsed.success) return { kind: 'unavailable' }
  const { assignment, program } = parsed.data
  if (assignment.id !== input.assignmentId || program.assignmentId !== assignment.id
    || program.subjectId !== assignment.subject_id || program.revisionNumber !== assignment.active_revision
    || program.programMode !== assignment.program_mode || program.owningPractitionerId !== assignment.owning_practitioner_id
    || (program.executionContext.kind === 'live'
      ? assignment.simulation_run_id !== null
      : program.executionContext.simulationRunId !== assignment.simulation_run_id)) return { kind: 'unavailable' }

  const rawRows = await dependencies.listSessionRows(input.assignmentId)
  if (rawRows === 'unavailable') return { kind: 'unavailable' }
  const rowsParsed = z.array(sessionRowSchema).max(100).safeParse(rawRows)
  if (!rowsParsed.success) return { kind: 'unavailable' }
  const plannedIds = [...program.sessions.map(item => item.sessionId), ...program.conditioningBouts.map(item => item.boutId)]
  const expectedIds = new Set(plannedIds)
  if (expectedIds.size !== plannedIds.length) return { kind: 'unavailable' }
  const rows = [...rowsParsed.data].sort((left, right) => left.scheduled_local_date.localeCompare(right.scheduled_local_date) || left.id.localeCompare(right.id))
  if (rows.length !== expectedIds.size || rows.some(row => row.assignment_id !== assignment.id || row.subject_id !== assignment.subject_id || !expectedIds.delete(row.id)) || expectedIds.size > 0) {
    return { kind: 'unavailable' }
  }

  const selected = selectRows(rows, input.view, dependencies.now())
  const decoded = decodeCursor(input.cursor)
  if (decoded === undefined || (decoded && (input.view === 'today' || decoded.assignmentId !== assignment.id
    || decoded.revisionNumber !== program.revisionNumber || decoded.view !== input.view))) return { kind: 'stale_cursor' }
  const offset = decoded?.offset ?? 0
  if (offset > selected.rows.length) return { kind: 'stale_cursor' }
  const pageRows = input.view === 'today' ? selected.rows : selected.rows.slice(offset, offset + input.limit)
  const reads = await Promise.all(pageRows.map(row => dependencies.readSession(row.id)))
  if (reads.some(read => read === null || read === 'unavailable')) return { kind: 'unavailable' }
  const sessions = pageRows.map((row, index) => summarizeSession(program, row, reads[index] as SessionRead))
  if (sessions.some(session => session === null)) return { kind: 'unavailable' }
  const nextOffset = offset + pageRows.length
  const nextCursor = input.view !== 'today' && nextOffset < selected.rows.length
    ? encodeCursor({ version: 1, assignmentId: assignment.id, revisionNumber: program.revisionNumber, view: input.view, offset: nextOffset })
    : null
  const projection = TrainingProgramWorkspaceProjectionSchema.safeParse({
    schemaVersion: 'training-program-workspace.v1',
    assignment: {
      assignmentId: assignment.id,
      subjectId: assignment.subject_id,
      programMode: assignment.program_mode,
      status: assignment.status,
      cycleLengthWeeks: program.cycleLengthWeeks,
      cycleStartLocalDate: program.cycleStartLocalDate,
      revisionNumber: program.revisionNumber,
      executionContext: program.executionContext,
      createdAt: assignment.created_at,
    },
    view: input.view,
    focus: selected.focus,
    sessions,
    nextCursor,
  })
  return projection.success ? { kind: 'found', value: projection.data } : { kind: 'unavailable' }
}

export function programWorkspaceDependencies(client: TrainingClient): ProgramWorkspaceDependencies {
  return {
    now: () => new Date(),
    readProgram: async assignmentId => {
      const { data, error } = await client.rpc('read_training_program_projection', { p_assignment_id: assignmentId })
      return error ? 'unavailable' : data
    },
    listSessionRows: async assignmentId => {
      const { data, error } = await client.from('training_sessions')
        .select('id,subject_id,assignment_id,session_kind,state,scheduled_local_date,athlete_timezone,revision,stopped_for_symptoms,completed_at')
        .eq('assignment_id', assignmentId)
        .order('scheduled_local_date', { ascending: true })
        .order('id', { ascending: true })
        .limit(100)
      return error ? 'unavailable' : data ?? 'unavailable'
    },
    readSession: async sessionId => {
      const result = await readTrainingSessionProjection(client, sessionId)
      return result.kind === 'found' ? result.value : result.kind === 'not_found' ? null : 'unavailable'
    },
  }
}
