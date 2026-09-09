import { z } from 'zod'
import {
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const RECOVERY_CONTEXT_SCHEMA_VERSION = 'recovery-context.v1' as const

/**
 * A subjective context signal. These values do not diagnose illness, establish
 * readiness, or grant clearance; they preserve only what the user reported.
 */
export const RecoveryContextSignalV1Schema = z.enum([
  'unknown',
  'no_concern_reported',
  'concern_reported',
])

export const RecoveryContextReportV1Schema = z.object({
  schemaVersion: z.literal(RECOVERY_CONTEXT_SCHEMA_VERSION),
  capturedAt: z.string().datetime({ offset: true }),
  sleep: RecoveryContextSignalV1Schema,
  fatigue: RecoveryContextSignalV1Schema,
  schedule: RecoveryContextSignalV1Schema,
  illness: RecoveryContextSignalV1Schema,
}).strict()

export const RecoveryContextChoiceV1Schema = z.enum([
  'hold',
  'request_review',
  'new_familiarization',
])

export const RecoveryContextV1Schema = z.object({
  report: RecoveryContextReportV1Schema,
  choice: RecoveryContextChoiceV1Schema.optional(),
}).strict()

export const RecoveryContextSubmissionV1Schema = z.object({
  requestId: z.string().uuid(),
  context: RecoveryContextV1Schema,
}).strict()

export const RecoveryContextRecordV1Schema = z.object({
  schemaVersion: z.literal('training-recovery-context-record.v1'),
  recordId: z.string().uuid(),
  subjectId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  sourceProgramRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sourceProgramHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSessionId: TrainingStableIdV1Schema,
  sourceSessionRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  exerciseInstanceId: TrainingStableIdV1Schema,
  progressionSeriesId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  context: RecoveryContextV1Schema,
  recordedAt: z.string().datetime({ offset: true }),
}).strict()

const legacyRecoveryReviewSchema = z.object({
    kind: z.literal('legacy_path'),
    reason: z.literal('recovery_context_missing'),
  }).strict()
const performanceRecoveryReviewSchema = z.object({
    kind: z.literal('performance_eligible'),
    reason: z.literal('recovery_context_recorded_no_choice'),
    report: RecoveryContextReportV1Schema,
  }).strict()
const holdRecoveryReviewSchema = z.object({
    kind: z.literal('hold'),
    reason: z.literal('explicit_recovery_hold'),
    report: RecoveryContextReportV1Schema,
  }).strict()
const requestRecoveryReviewSchema = z.object({
    kind: z.literal('request_review'),
    reason: z.literal('explicit_recovery_review_requested'),
    report: RecoveryContextReportV1Schema,
  }).strict()
const familiarizationRecoveryReviewSchema = z.object({
    kind: z.literal('new_familiarization'),
    reason: z.literal('explicit_new_familiarization_requested'),
    report: RecoveryContextReportV1Schema,
  }).strict()

export const RecoveryInterventionReviewV1Schema = z.discriminatedUnion('kind', [
  holdRecoveryReviewSchema,
  requestRecoveryReviewSchema,
  familiarizationRecoveryReviewSchema,
])

export const RecoveryReviewV1Schema = z.discriminatedUnion('kind', [
  legacyRecoveryReviewSchema,
  performanceRecoveryReviewSchema,
  holdRecoveryReviewSchema,
  requestRecoveryReviewSchema,
  familiarizationRecoveryReviewSchema,
])

export type RecoveryContextSignalV1 = z.infer<typeof RecoveryContextSignalV1Schema>
export type RecoveryContextReportV1 = z.infer<typeof RecoveryContextReportV1Schema>
export type RecoveryContextChoiceV1 = z.infer<typeof RecoveryContextChoiceV1Schema>
export type RecoveryContextV1 = z.infer<typeof RecoveryContextV1Schema>
export type RecoveryContextSubmissionV1 = z.infer<typeof RecoveryContextSubmissionV1Schema>
export type RecoveryContextRecordV1 = z.infer<typeof RecoveryContextRecordV1Schema>
export type RecoveryInterventionReviewV1 = z.infer<typeof RecoveryInterventionReviewV1Schema>
export type RecoveryReviewV1 = z.infer<typeof RecoveryReviewV1Schema>
