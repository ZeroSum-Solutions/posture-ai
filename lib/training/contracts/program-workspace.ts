import { z } from 'zod'
import {
  EquipmentLoadBasisV1Schema,
  ExactLoadQuantityV1Schema,
  ExecutionContextV1Schema,
  TRAINING_CONDITIONING_PERSISTED_DURATION_MAX_SECONDS,
  TrainingStableIdV1Schema,
} from './program'

export const TRAINING_PROGRAM_WORKSPACE_VERSION = 'training-program-workspace.v1' as const
export const TRAINING_PROGRAM_WORKSPACE_PAGE_SIZE = 12
export const TRAINING_PROGRAM_WORKSPACE_MAX_PAGE_SIZE = 24

export const TrainingProgramWorkspaceViewSchema = z.enum(['today', 'program', 'history'])
export const TrainingProgramWorkspaceSessionStateSchema = z.enum([
  'scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted',
])

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const actualSetSchema = z.object({
  setId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  setKind: z.enum(['warmup', 'working', 'extra']),
  workingSetOrdinal: z.number().int().positive().nullable(),
  quantity: ExactLoadQuantityV1Schema,
  reps: z.number().int().min(0).max(100),
  rir: z.union([z.number().int().min(0).max(5), z.literal('6_plus'), z.literal('unknown')]),
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  symptomState: z.enum(['none', 'adverse_reported']),
  occurredAt: z.string().datetime({ offset: true }),
}).strict()

const plannedLoadSchema = z.object({
  basis: EquipmentLoadBasisV1Schema,
  quantity: ExactLoadQuantityV1Schema,
}).strict()

const plannedWarmupSetSchema = z.object({
  setId: TrainingStableIdV1Schema,
  targetReps: z.number().int().min(1).max(100),
  load: plannedLoadSchema,
}).strict()

const strengthPlanSchema = z.object({
  kind: z.literal('strength'),
  exercises: z.array(z.object({
    exerciseInstanceId: TrainingStableIdV1Schema,
    label: z.string().trim().min(1).max(160).nullable(),
    setIds: z.array(TrainingStableIdV1Schema).min(1).max(20),
    warmupSets: z.array(plannedWarmupSetSchema).min(1).max(5).optional(),
    targetReps: z.array(z.number().int().min(1).max(100)).nullable(),
    repRange: z.object({ minimum: z.number().int().min(1), maximum: z.number().int().min(1) }).strict(),
    targetRir: z.object({ minimum: z.number().int().min(0), maximum: z.number().int().min(0) }).strict(),
    restSeconds: z.number().int().min(0).max(3_600),
    side: z.enum(['bilateral', 'left', 'right', 'not_applicable']).nullable(),
    load: plannedLoadSchema,
  }).strict()).min(1).max(30),
}).strict()

const conditioningPlanSchema = z.object({
  kind: z.literal('conditioning'),
  boutId: TrainingStableIdV1Schema,
  label: z.string().trim().min(1).max(160).nullable(),
  durationSeconds: z.number().int().min(60)
    .max(TRAINING_CONDITIONING_PERSISTED_DURATION_MAX_SECONDS),
  effortCue: z.string().trim().min(1).max(240),
}).strict()

const actualSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('strength'),
    prescribedSetCount: z.number().int().min(1).max(600),
    recordedSetCount: z.number().int().min(0).max(600),
    omittedSetCount: z.number().int().min(0).max(600),
    sets: z.array(actualSetSchema).max(750),
  }).strict(),
  z.object({
    kind: z.literal('conditioning'),
    recorded: z.object({
      durationSeconds: z.number().int().min(0).max(86_400),
      perceivedEffort: z.union([z.number().int().min(0).max(10), z.literal('unknown')]),
      symptomState: z.enum(['none', 'adverse_reported']),
      occurredAt: z.string().datetime({ offset: true }),
    }).strict().nullable(),
  }).strict(),
])

export const TrainingProgramWorkspaceSessionSchema = z.object({
  sessionId: TrainingStableIdV1Schema,
  kind: z.enum(['strength', 'conditioning']),
  state: TrainingProgramWorkspaceSessionStateSchema,
  scheduledLocalDate: localDateSchema,
  weekNumber: z.number().int().min(1).max(12),
  athleteTimezone: z.string().trim().min(1).max(100),
  revision: z.number().int().positive(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  stoppedForSymptoms: z.boolean(),
  planned: z.discriminatedUnion('kind', [strengthPlanSchema, conditioningPlanSchema]),
  actual: actualSchema,
}).strict().superRefine((session, context) => {
  if (session.kind !== session.planned.kind || session.kind !== session.actual.kind) {
    context.addIssue({ code: 'custom', message: 'Session plan and actual kind must match', path: ['kind'] })
    return
  }
  if (session.planned.kind === 'conditioning' && session.planned.boutId !== session.sessionId) {
    context.addIssue({ code: 'custom', message: 'Conditioning plan does not match session', path: ['planned', 'boutId'] })
  }
  if (session.planned.kind === 'strength' && session.actual.kind === 'strength') {
    const prescribed = new Map<string, {
      exerciseInstanceId: string
      setKind: 'warmup' | 'working'
      workingSetOrdinal: number | null
    }>()
    let prescribedWorkingSetCount = 0
    let invalidPlan = false
    session.planned.exercises.forEach((exercise, exerciseIndex) => {
      exercise.warmupSets?.forEach((set, warmupIndex) => {
        if (set.load.basis !== exercise.load.basis || prescribed.has(set.setId)) invalidPlan = true
        prescribed.set(set.setId, {
          exerciseInstanceId: exercise.exerciseInstanceId,
          setKind: 'warmup',
          workingSetOrdinal: null,
        })
        if (set.load.basis !== exercise.load.basis) {
          context.addIssue({ code: 'custom', message: 'Warm-up load basis must match the exercise', path: ['planned', 'exercises', exerciseIndex, 'warmupSets', warmupIndex, 'load', 'basis'] })
        }
      })
      exercise.setIds.forEach((setId, setIndex) => {
        if (prescribed.has(setId)) invalidPlan = true
        prescribed.set(setId, {
          exerciseInstanceId: exercise.exerciseInstanceId,
          setKind: 'working',
          workingSetOrdinal: setIndex + 1,
        })
        prescribedWorkingSetCount += 1
      })
    })

    const recordedIds = new Set<string>()
    const recordedWorkingIds = new Set<string>()
    const invalidActual = session.actual.sets.some(set => {
      const expected = prescribed.get(set.setId)
      const duplicate = recordedIds.has(set.setId)
      recordedIds.add(set.setId)
      if (expected?.setKind === 'working') recordedWorkingIds.add(set.setId)
      return duplicate || !expected
        || expected.exerciseInstanceId !== set.exerciseInstanceId
        || expected.setKind !== set.setKind
        || expected.workingSetOrdinal !== set.workingSetOrdinal
    })
    if (invalidPlan
      || invalidActual
      || session.actual.recordedSetCount !== recordedWorkingIds.size
      || session.actual.prescribedSetCount !== prescribedWorkingSetCount
      || session.actual.omittedSetCount !== prescribedWorkingSetCount - recordedWorkingIds.size) {
      context.addIssue({ code: 'custom', message: 'Recorded sets do not match the prescribed session', path: ['actual'] })
    }
  }
})

export const TrainingProgramWorkspaceProjectionSchema = z.object({
  schemaVersion: z.literal(TRAINING_PROGRAM_WORKSPACE_VERSION),
  assignment: z.object({
    assignmentId: TrainingStableIdV1Schema,
    subjectId: TrainingStableIdV1Schema,
    programMode: z.enum(['self_directed', 'coach_assigned']),
    status: z.enum(['active', 'ended']),
    cycleLengthWeeks: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(12)]),
    cycleStartLocalDate: localDateSchema,
    revisionNumber: z.number().int().positive(),
    executionContext: ExecutionContextV1Schema,
    createdAt: z.string().datetime({ offset: true }),
  }).strict(),
  view: TrainingProgramWorkspaceViewSchema,
  focus: z.enum(['in_progress', 'today', 'next', 'most_recent', 'none']),
  sessions: z.array(TrainingProgramWorkspaceSessionSchema).max(TRAINING_PROGRAM_WORKSPACE_MAX_PAGE_SIZE),
  nextCursor: z.string().max(1_024).nullable(),
}).strict()

export type TrainingProgramWorkspaceView = z.infer<typeof TrainingProgramWorkspaceViewSchema>
export type TrainingProgramWorkspaceSession = z.infer<typeof TrainingProgramWorkspaceSessionSchema>
export type TrainingProgramWorkspaceProjection = z.infer<typeof TrainingProgramWorkspaceProjectionSchema>
