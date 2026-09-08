import { z } from 'zod'
import {
  MovementPatternV1Schema,
  TrainingCatalogOriginV1Schema,
  type TrainingCatalogOriginV1,
} from '../catalog/types'
import { createLoadQuantity, isEnteredLoadAtMostCanonicalKg } from '../quantity'

export const TRAINING_PROGRAM_REVISION_SCHEMA_VERSION = 'training-program-revision.v1' as const

export const TrainingStableIdV1Schema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const isoDateTimeSchema = z.string().datetime({ offset: true })
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const ExecutionContextV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('live') }).strict(),
  z.object({
    kind: z.literal('synthetic_simulation'),
    simulationRunId: z.string().uuid(),
    fixtureId: TrainingStableIdV1Schema,
    fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.enum(['Practice data', 'Simulation']),
  }).strict(),
])

export function executionContextsMatch(left: ExecutionContextV1, right: ExecutionContextV1): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'live' || right.kind === 'live') return true
  return left.simulationRunId === right.simulationRunId
    && left.fixtureId === right.fixtureId
    && left.fixtureHash === right.fixtureHash
    && left.label === right.label
}

export function catalogOriginMatchesExecutionContext(
  origin: TrainingCatalogOriginV1,
  context: ExecutionContextV1,
): boolean {
  if (context.kind === 'live') return origin.kind === 'authored_catalog'
  return origin.kind === 'synthetic_fixture'
    && origin.fixtureId === context.fixtureId
    && origin.fixtureHash === context.fixtureHash
}

export function catalogOriginsMatch(left: TrainingCatalogOriginV1, right: TrainingCatalogOriginV1): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'authored_catalog' || right.kind === 'authored_catalog') return true
  return left.source === right.source
    && left.fixtureId === right.fixtureId
    && left.fixtureHash === right.fixtureHash
    && left.label === right.label
}

export const EquipmentLoadBasisV1Schema = z.enum([
  'barbell_total',
  'dumbbell_per_hand',
  'dumbbell_single_implement',
  'machine_stack',
])

export const ExactLoadQuantityV1Schema = z.object({
  entered: z.object({
    value: z.string().max(16),
    unit: z.enum(['kg', 'lb']),
  }).strict(),
  canonicalKg: z.string().max(64),
}).strict().superRefine((quantity, ctx) => {
  try {
    const reconstructed = createLoadQuantity(quantity.entered)
    if (reconstructed.canonicalKg !== quantity.canonicalKg) {
      ctx.addIssue({ code: 'custom', message: 'Canonical kilograms do not match the preserved entry', path: ['canonicalKg'] })
    }
    if (!isEnteredLoadAtMostCanonicalKg(reconstructed.entered, '1000')) {
      ctx.addIssue({ code: 'custom', message: 'Load exceeds 1000 kg', path: ['canonicalKg'] })
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid exact load quantity', path: ['entered'] })
  }
})

const implementConfigurationSchema = z.discriminatedUnion('loadBasis', [
  z.object({
    loadBasis: z.literal('dumbbell_single_implement'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('two_hands_single_implement'),
  }).strict(),
  z.object({
    loadBasis: z.literal('dumbbell_per_hand'),
    implementCount: z.literal(2),
    holdingConfiguration: z.literal('one_per_hand'),
  }).strict(),
  z.object({
    loadBasis: z.literal('barbell_total'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('both_hands_barbell'),
  }).strict(),
  z.object({
    loadBasis: z.literal('machine_stack'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('machine_defined'),
  }).strict(),
])

export const ExerciseProgressionPrescriptionV1Schema = z.object({
  progressionSeriesId: TrainingStableIdV1Schema,
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  rom: TrainingStableIdV1Schema,
  tempo: TrainingStableIdV1Schema,
  exposureType: TrainingStableIdV1Schema,
  loadEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()

export const AcceptedInitialLoadV1Schema = z.object({
  status: z.literal('accepted'),
  acceptanceId: TrainingStableIdV1Schema,
  acceptedAt: isoDateTimeSchema,
  acceptedByUserId: TrainingStableIdV1Schema,
  source: z.literal('equipment_inventory'),
  executionContext: ExecutionContextV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  exerciseVersionId: TrainingStableIdV1Schema,
  equipmentId: TrainingStableIdV1Schema,
  provenance: z.object({
    profileRevisionId: TrainingStableIdV1Schema,
    compiledProgramRevisionId: TrainingStableIdV1Schema,
    catalogVersion: TrainingStableIdV1Schema,
    catalogOrigin: TrainingCatalogOriginV1Schema,
  }).strict(),
  quantity: ExactLoadQuantityV1Schema,
}).and(implementConfigurationSchema)

export const AcceptedConditioningBoutV1Schema = z.object({
  status: z.literal('accepted'),
  acceptanceId: TrainingStableIdV1Schema,
  acceptedAt: isoDateTimeSchema,
  acceptedByUserId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  boutId: TrainingStableIdV1Schema,
  modalityId: TrainingStableIdV1Schema,
  scheduledLocalDate: localDateSchema,
  athleteTimezone: z.string().trim().min(1).max(100),
  acceptedDurationSeconds: z.number().int().min(60).max(1_200),
  effortCue: z.string().trim().min(1).max(240),
  source: z.object({
    compiledProgramRevisionId: TrainingStableIdV1Schema,
    compilerPolicyVersion: TrainingStableIdV1Schema,
    catalogVersion: TrainingStableIdV1Schema,
    catalogOrigin: TrainingCatalogOriginV1Schema,
  }).strict(),
}).strict()

export const ProgramExercisePrescriptionV1Schema = z.object({
  exerciseInstanceId: TrainingStableIdV1Schema,
  exerciseVersionId: TrainingStableIdV1Schema,
  movementPattern: MovementPatternV1Schema.optional(),
  setIds: z.array(TrainingStableIdV1Schema).min(1).max(20),
  repRange: z.object({ minimum: z.number().int().min(1).max(100), maximum: z.number().int().min(1).max(100) }).strict(),
  targetReps: z.array(z.number().int().min(1).max(100)).min(1).max(20).optional(),
  targetRir: z.object({ minimum: z.number().int().min(0).max(5), maximum: z.number().int().min(0).max(5) }).strict(),
  restSeconds: z.number().int().min(0).max(3_600),
  progression: ExerciseProgressionPrescriptionV1Schema.optional(),
  acceptedInitialLoad: AcceptedInitialLoadV1Schema,
}).strict().superRefine((exercise, ctx) => {
  if (exercise.repRange.minimum > exercise.repRange.maximum) {
    ctx.addIssue({ code: 'custom', message: 'Rep range is inverted', path: ['repRange', 'minimum'] })
  }
  if (exercise.targetRir.minimum > exercise.targetRir.maximum) {
    ctx.addIssue({ code: 'custom', message: 'RIR range is inverted', path: ['targetRir', 'minimum'] })
  }
  if (new Set(exercise.setIds).size !== exercise.setIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Set IDs must be unique', path: ['setIds'] })
  }
  if (exercise.targetReps && (exercise.targetReps.length !== exercise.setIds.length
    || exercise.targetReps.some(reps => reps < exercise.repRange.minimum || reps > exercise.repRange.maximum))) {
    ctx.addIssue({ code: 'custom', message: 'Target reps must match every set and remain in range', path: ['targetReps'] })
  }
  if (exercise.acceptedInitialLoad.exerciseInstanceId !== exercise.exerciseInstanceId
    || exercise.acceptedInitialLoad.exerciseVersionId !== exercise.exerciseVersionId) {
    ctx.addIssue({
      code: 'custom', message: 'Accepted load does not match exercise prescription',
      path: ['acceptedInitialLoad', 'exerciseInstanceId'],
    })
  }
})

export const TrainingProgramRevisionV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_PROGRAM_REVISION_SCHEMA_VERSION),
  assignmentId: TrainingStableIdV1Schema,
  revisionNumber: z.number().int().min(1),
  subjectId: TrainingStableIdV1Schema,
  programMode: z.enum(['self_directed', 'coach_assigned']),
  owningPractitionerId: TrainingStableIdV1Schema.nullable(),
  executionContext: ExecutionContextV1Schema,
  cycleStartLocalDate: localDateSchema,
  cycleLengthWeeks: z.literal(8),
  profileRevisionId: TrainingStableIdV1Schema,
  eligibilitySourceRevisionId: TrainingStableIdV1Schema,
  compilerPolicyVersion: TrainingStableIdV1Schema,
  catalogVersion: TrainingStableIdV1Schema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
  ruleVersion: TrainingStableIdV1Schema,
  compiledProgramRevisionId: TrainingStableIdV1Schema,
  publishedAt: isoDateTimeSchema,
  author: z.object({
    kind: z.enum(['athlete', 'coach', 'system']),
    userId: TrainingStableIdV1Schema.nullable(),
  }).strict(),
  sessions: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    sessionType: z.enum(['full_body', 'upper', 'lower']).optional(),
    scheduledLocalDate: localDateSchema,
    athleteTimezone: z.string().trim().min(1).max(100),
    exercises: z.array(ProgramExercisePrescriptionV1Schema).min(1).max(30),
  }).strict()).min(1).max(64),
  conditioningBouts: z.array(AcceptedConditioningBoutV1Schema).min(1).max(24),
}).strict().superRefine((revision, ctx) => {
  if ((revision.programMode === 'coach_assigned') !== (revision.owningPractitionerId !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Coach-assigned programs require exactly one owning practitioner', path: ['owningPractitionerId'] })
  }
  const sessionIds = revision.sessions.map(session => session.sessionId)
  if (new Set(sessionIds).size !== sessionIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Session IDs must be unique', path: ['sessions'] })
  }
  if (!catalogOriginMatchesExecutionContext(revision.catalogOrigin, revision.executionContext)) {
    ctx.addIssue({ code: 'custom', message: 'Catalog origin does not match program execution context', path: ['catalogOrigin'] })
  }
  revision.sessions.forEach((session, sessionIndex) => {
    session.exercises.forEach((exercise, exerciseIndex) => {
      if (!executionContextsMatch(exercise.acceptedInitialLoad.executionContext, revision.executionContext)) {
        ctx.addIssue({
          code: 'custom', message: 'Accepted load execution context does not match program',
          path: ['sessions', sessionIndex, 'exercises', exerciseIndex, 'acceptedInitialLoad', 'executionContext'],
        })
      }
      const provenance = exercise.acceptedInitialLoad.provenance
      if (provenance.profileRevisionId !== revision.profileRevisionId
        || provenance.compiledProgramRevisionId !== revision.compiledProgramRevisionId
        || provenance.catalogVersion !== revision.catalogVersion
        || !catalogOriginsMatch(provenance.catalogOrigin, revision.catalogOrigin)) {
        ctx.addIssue({
          code: 'custom', message: 'Accepted load provenance does not match program',
          path: ['sessions', sessionIndex, 'exercises', exerciseIndex, 'acceptedInitialLoad', 'provenance'],
        })
      }
    })
  })
  revision.conditioningBouts.forEach((bout, index) => {
    if (!executionContextsMatch(bout.executionContext, revision.executionContext)) {
      ctx.addIssue({
        code: 'custom', message: 'Conditioning acceptance execution context does not match program',
        path: ['conditioningBouts', index, 'executionContext'],
      })
    }
    if (bout.source.compiledProgramRevisionId !== revision.compiledProgramRevisionId) {
      ctx.addIssue({
        code: 'custom', message: 'Conditioning acceptance does not match compiled program revision',
        path: ['conditioningBouts', index, 'source', 'compiledProgramRevisionId'],
      })
    }
    if (bout.source.catalogVersion !== revision.catalogVersion
      || !catalogOriginsMatch(bout.source.catalogOrigin, revision.catalogOrigin)) {
      ctx.addIssue({
        code: 'custom', message: 'Conditioning acceptance catalog provenance does not match program',
        path: ['conditioningBouts', index, 'source', 'catalogOrigin'],
      })
    }
  })
})

export type ExecutionContextV1 = z.infer<typeof ExecutionContextV1Schema>
export type AcceptedInitialLoadV1 = z.infer<typeof AcceptedInitialLoadV1Schema>
export type AcceptedConditioningBoutV1 = z.infer<typeof AcceptedConditioningBoutV1Schema>
export type ProgramExercisePrescriptionV1 = z.infer<typeof ProgramExercisePrescriptionV1Schema>
export type ExerciseProgressionPrescriptionV1 = z.infer<typeof ExerciseProgressionPrescriptionV1Schema>
export type TrainingProgramRevisionV1 = z.infer<typeof TrainingProgramRevisionV1Schema>
