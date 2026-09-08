import { z } from 'zod'
import {
  ExactLoadQuantityV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const TRAINING_PROGRESSION_PROJECTION_SCHEMA_VERSION = 'training-progression-projection.v1' as const
export const TRAINING_PROGRESSION_ACCEPTANCE_SCHEMA_VERSION = 'training-progression-acceptance.v1' as const

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const equipmentLoadSchema = z.object({
  equipmentId: TrainingStableIdV1Schema,
  basis: z.enum(['barbell_total', 'dumbbell_per_hand', 'dumbbell_single_implement', 'machine_stack']),
  quantity: ExactLoadQuantityV1Schema,
}).strict()

export const ProgressionReasonV1Schema = z.enum([
  'acute_stop', 'eligibility_unanswered', 'eligibility_review_required',
  'eligibility_scope_unavailable', 'eligibility_source_unavailable',
  'eligibility_constraints_unavailable', 'eligibility_constraints_blocked',
  'stale_session_review', 'session_in_progress_hold', 'session_aborted_hold',
  'exercise_incomplete_hold', 'exercise_aborted_hold', 'sync_pending_hold',
  'sync_conflict_hold', 'adverse_symptom_hold', 'invalid_log_hold',
  'unconfirmed_outlier_hold', 'effort_unknown_hold', 'effort_too_easy_recalibration',
  'mixed_working_load_review', 'return_after_gap_review',
  'comparator_changed_recalibration', 'calibration_required', 'difficult_exposure_hold',
  'repeated_difficult_exposure_review', 'insufficient_same_load_evidence_hold',
  'no_achievable_increment_within_cap', 'one_rep_progression',
  'two_ceiling_successes', 'valid_state_hold',
])

const auditFields = {
  policyVersion: z.literal('strength-progression-v1'),
  executionContext: ExecutionContextV1Schema,
  decisionKey: z.string().trim().min(1).max(160),
  subjectId: TrainingStableIdV1Schema,
  prescriptionId: z.string().trim().min(1).max(260),
  exerciseVersionId: TrainingStableIdV1Schema,
  equipmentId: TrainingStableIdV1Schema,
  loadBasis: equipmentLoadSchema.shape.basis,
  programRevisionId: TrainingStableIdV1Schema,
  sourceProfileRevisionId: TrainingStableIdV1Schema,
  sourceEligibilityRevisionId: TrainingStableIdV1Schema,
  loadEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reasonCodes: z.array(ProgressionReasonV1Schema).min(1).max(8),
  sourceExposureRevisionIds: z.array(z.string().trim().min(1).max(160)).max(64),
  sourceAcknowledgementRevisionIds: z.array(z.string().trim().min(1).max(160)).max(64),
}

const noChangeDecisionSchema = z.object({
  kind: z.enum(['stop', 'hold', 'review', 'recalibrate']),
  status: z.literal('not_proposed'),
  ...auditFields,
}).strict()

export const ProgressionProposalV1Schema = z.object({
  kind: z.enum(['rep_proposal', 'load_proposal']),
  status: z.literal('proposed'),
  ...auditFields,
  proposal: z.object({
    load: equipmentLoadSchema,
    targetReps: z.array(z.number().int().min(1).max(100)).min(1).max(100),
  }).strict(),
}).strict()

export const StrengthProgressionDecisionV1Schema = z.discriminatedUnion('status', [
  noChangeDecisionSchema,
  ProgressionProposalV1Schema,
])

export const ProgressionTargetV1Schema = z.object({
  assignmentId: TrainingStableIdV1Schema,
  baseProgramRevisionNumber: revisionSchema,
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

export const CreateProgressionProposalInputV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
}).strict()

const proposalProjectionSchema = z.object({
  kind: z.literal('proposal'),
  proposalId: z.string().uuid(),
  target: ProgressionTargetV1Schema,
  decision: ProgressionProposalV1Schema,
}).strict()
const notProposedProjectionSchema = z.object({
  kind: z.literal('not_proposed'),
  proposalId: z.null(),
  target: ProgressionTargetV1Schema,
  decision: noChangeDecisionSchema,
}).strict()
const noTargetProjectionSchema = z.object({
  kind: z.literal('no_pending_target'),
  proposalId: z.null(),
  reason: z.literal('no_pending_strength_target'),
}).strict()

export const TrainingProgressionProjectionV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_PROGRESSION_PROJECTION_SCHEMA_VERSION),
  result: z.discriminatedUnion('kind', [
    proposalProjectionSchema,
    notProposedProjectionSchema,
    noTargetProjectionSchema,
  ]),
}).strict()

export const AcceptProgressionProposalInputV1Schema = z.object({
  requestId: z.string().uuid(),
}).strict()

export const TrainingProgressionAcceptanceV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_PROGRESSION_ACCEPTANCE_SCHEMA_VERSION),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: revisionSchema,
  targetSessionId: TrainingStableIdV1Schema,
  targetExerciseInstanceId: TrainingStableIdV1Schema,
}).strict()

export type ProgressionProposalV1 = z.infer<typeof ProgressionProposalV1Schema>
export type ProgressionTargetV1 = z.infer<typeof ProgressionTargetV1Schema>
export type TrainingProgressionProjectionV1 = z.infer<typeof TrainingProgressionProjectionV1Schema>
export type TrainingProgressionAcceptanceV1 = z.infer<typeof TrainingProgressionAcceptanceV1Schema>
