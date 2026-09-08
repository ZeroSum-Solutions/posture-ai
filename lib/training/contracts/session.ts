import { z } from 'zod'
import {
  AcceptedConditioningBoutV1Schema,
  ExecutionContextV1Schema,
  ProgramExercisePrescriptionV1Schema,
  TrainingStableIdV1Schema,
  catalogOriginMatchesExecutionContext,
  catalogOriginsMatch,
  executionContextsMatch,
} from './program'
import { TrainingCatalogOriginV1Schema } from '../catalog/types'

export const TRAINING_SESSION_PRESCRIPTION_SCHEMA_VERSION = 'training-session-prescription.v1' as const
export const TRAINING_CONDITIONING_SESSION_PRESCRIPTION_SCHEMA_VERSION = 'training-conditioning-session-prescription.v1' as const
export const TRAINING_SESSION_STATE_SCHEMA_VERSION = 'training-session-state.v1' as const

export const TrainingSessionPrescriptionV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_SESSION_PRESCRIPTION_SCHEMA_VERSION),
  sessionId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: z.number().int().min(1),
  subjectId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  athleteTimezone: z.string().trim().min(1).max(100),
  profileRevisionId: TrainingStableIdV1Schema,
  eligibilitySourceRevisionId: TrainingStableIdV1Schema,
  compilerPolicyVersion: TrainingStableIdV1Schema,
  catalogVersion: TrainingStableIdV1Schema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
  ruleVersion: TrainingStableIdV1Schema,
  compiledProgramRevisionId: TrainingStableIdV1Schema,
  exercises: z.array(ProgramExercisePrescriptionV1Schema).min(1).max(30),
}).strict().superRefine((session, ctx) => {
  if (!catalogOriginMatchesExecutionContext(session.catalogOrigin, session.executionContext)) {
    ctx.addIssue({ code: 'custom', message: 'Catalog origin does not match session execution context', path: ['catalogOrigin'] })
  }
  session.exercises.forEach((exercise, index) => {
    if (!executionContextsMatch(exercise.acceptedInitialLoad.executionContext, session.executionContext)) {
      ctx.addIssue({
        code: 'custom', message: 'Accepted load execution context does not match session',
        path: ['exercises', index, 'acceptedInitialLoad', 'executionContext'],
      })
    }
    const provenance = exercise.acceptedInitialLoad.provenance
    if (provenance.profileRevisionId !== session.profileRevisionId
      || provenance.compiledProgramRevisionId !== session.compiledProgramRevisionId
      || provenance.catalogVersion !== session.catalogVersion
      || !catalogOriginsMatch(provenance.catalogOrigin, session.catalogOrigin)) {
      ctx.addIssue({ code: 'custom', message: 'Accepted load provenance does not match session', path: ['exercises', index, 'acceptedInitialLoad', 'provenance'] })
    }
  })
})

export const TrainingConditioningSessionPrescriptionV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_CONDITIONING_SESSION_PRESCRIPTION_SCHEMA_VERSION),
  sessionId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: z.number().int().min(1),
  subjectId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
  compiledProgramRevisionId: TrainingStableIdV1Schema,
  acceptedBout: AcceptedConditioningBoutV1Schema,
}).strict().superRefine((session, ctx) => {
  if (!catalogOriginMatchesExecutionContext(session.catalogOrigin, session.executionContext)) {
    ctx.addIssue({ code: 'custom', message: 'Catalog origin does not match session execution context', path: ['catalogOrigin'] })
  }
  if (!executionContextsMatch(session.acceptedBout.executionContext, session.executionContext)) {
    ctx.addIssue({ code: 'custom', message: 'Conditioning acceptance execution context does not match session', path: ['acceptedBout', 'executionContext'] })
  }
  if (session.acceptedBout.source.compiledProgramRevisionId !== session.compiledProgramRevisionId) {
    ctx.addIssue({ code: 'custom', message: 'Conditioning acceptance does not match compiled program revision', path: ['acceptedBout', 'source', 'compiledProgramRevisionId'] })
  }
  if (!catalogOriginsMatch(session.acceptedBout.source.catalogOrigin, session.catalogOrigin)) {
    ctx.addIssue({ code: 'custom', message: 'Conditioning catalog provenance does not match session', path: ['acceptedBout', 'source', 'catalogOrigin'] })
  }
})

export const TrainingSessionStateV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_SESSION_STATE_SCHEMA_VERSION),
  sessionId: TrainingStableIdV1Schema,
  revision: z.number().int().min(1),
  state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  updatedAt: z.string().datetime({ offset: true }),
}).strict()

export type TrainingSessionPrescriptionV1 = z.infer<typeof TrainingSessionPrescriptionV1Schema>
export type TrainingConditioningSessionPrescriptionV1 = z.infer<typeof TrainingConditioningSessionPrescriptionV1Schema>
export type TrainingSessionStateV1 = z.infer<typeof TrainingSessionStateV1Schema>
