import { z } from 'zod'
import { ExecutionContextV1Schema, TrainingStableIdV1Schema } from './program'

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const ConditioningProgressionPolicyOriginV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('versioned_policy'),
    registryVersion: TrainingStableIdV1Schema,
    policyRevisionId: TrainingStableIdV1Schema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({
    kind: z.literal('synthetic_fixture'),
    sourceVersion: TrainingStableIdV1Schema,
    fixtureId: TrainingStableIdV1Schema,
    fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.string().trim().min(1).max(160),
  }).strict(),
])

export const ConditioningProgressionPolicyV1Schema = z.object({
  schemaVersion: z.literal('conditioning-progression-policy.v1'),
  policyVersion: z.literal('conditioning-duration-v1'),
  origin: ConditioningProgressionPolicyOriginV1Schema,
  modalityId: TrainingStableIdV1Schema,
  targetEffortMaximum: z.number().int().min(0).max(10),
  maxIncreasePerBoutSeconds: z.literal(120),
  maxTotalWeeklyIncreaseSeconds: z.literal(240),
  maxBoutDurationSeconds: z.literal(1_800),
  maxPlannedWeeklyDurationSeconds: z.literal(3_600),
}).strict()

export const ConditioningProgressionSourceBoutV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  sessionRevision: revisionSchema,
  boutId: TrainingStableIdV1Schema,
  modalityId: TrainingStableIdV1Schema,
  scheduledLocalDate: localDateSchema,
  sessionState: z.enum(['completed', 'completed_with_omissions', 'in_progress', 'aborted']),
  actual: z.object({
    eventRevision: revisionSchema,
    durationSeconds: z.number().int().min(1).max(14_400),
    perceivedEffort: z.union([z.number().int().min(0).max(10), z.literal('unknown')]),
    symptomState: z.enum(['none', 'adverse_reported']),
  }).strict().nullable(),
}).strict()

export const ConditioningProgressionTargetBoutV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  sessionRevision: revisionSchema,
  boutId: TrainingStableIdV1Schema,
  modalityId: TrainingStableIdV1Schema,
  scheduledLocalDate: localDateSchema,
  acceptedDurationSeconds: z.number().int().min(60).max(1_800),
  authoredMaximumDurationSeconds: z.number().int().min(60).max(1_800),
}).strict().superRefine((target, ctx) => {
  if (target.authoredMaximumDurationSeconds < target.acceptedDurationSeconds) {
    ctx.addIssue({ code: 'custom', message: 'Authored maximum is below the accepted duration', path: ['authoredMaximumDurationSeconds'] })
  }
})

export const ConditioningProgressionInputV1Schema = z.object({
  schemaVersion: z.literal('conditioning-progression-input.v1'),
  subjectId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  assignmentRevision: revisionSchema,
  baseProgramRevisionNumber: revisionSchema,
  sourceProfileRevision: revisionSchema,
  sourceEligibilityRevisionId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  policy: ConditioningProgressionPolicyV1Schema,
  sourceBouts: z.array(ConditioningProgressionSourceBoutV1Schema).length(2),
  targetBouts: z.array(ConditioningProgressionTargetBoutV1Schema).length(2),
  plannedWeeklyDurationSeconds: z.number().int().min(0).max(86_400),
}).strict()

export const ConditioningProgressionHoldReasonV1Schema = z.enum([
  'source_incomplete_hold',
  'effort_unknown_hold',
  'effort_above_target_hold',
  'adverse_symptom_hold',
  'modality_changed_recalibration',
  'no_whole_minute_available_hold',
])

const decisionAuditFields = {
  policyVersion: TrainingStableIdV1Schema,
  policyOrigin: ConditioningProgressionPolicyOriginV1Schema,
  decisionKey: z.string().regex(/^conditioning-duration-v1:sha256:[a-f0-9]{64}$/),
  subjectId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  baseProgramRevisionNumber: revisionSchema,
  sourceProfileRevision: revisionSchema,
  sourceEligibilityRevisionId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  modalityId: TrainingStableIdV1Schema,
  targetEffortMaximum: z.number().int().min(0).max(10),
  sourceSessionRevisions: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    sessionRevision: revisionSchema,
    conditioningEventRevision: revisionSchema,
  }).strict()).max(2),
}

export const ConditioningProgressionDecisionV1Schema = z.discriminatedUnion('status', [
  z.object({
    kind: z.literal('hold'), status: z.literal('not_proposed'), ...decisionAuditFields,
    reason: ConditioningProgressionHoldReasonV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('duration_proposal'), status: z.literal('proposed'), ...decisionAuditFields,
    reason: z.literal('two_comparable_bouts_completed'),
    increaseSecondsPerBout: z.union([z.literal(60), z.literal(120)]),
    targetBouts: z.array(z.object({
      sessionId: TrainingStableIdV1Schema,
      sessionRevision: revisionSchema,
      boutId: TrainingStableIdV1Schema,
      acceptedDurationSeconds: z.number().int().min(60).max(1_800),
    }).strict()).length(2),
  }).strict(),
])

export const CreateConditioningProgressionProposalInputV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
}).strict()

export const AcceptConditioningProgressionProposalInputV1Schema = z.object({
  requestId: z.string().uuid(),
}).strict()

export const ConditioningProgressionAcceptanceV1Schema = z.object({
  schemaVersion: z.literal('conditioning-progression-acceptance.v1'),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: revisionSchema,
  targetBoutIds: z.array(TrainingStableIdV1Schema).length(2),
  policyVersion: TrainingStableIdV1Schema,
  policyOrigin: ConditioningProgressionPolicyOriginV1Schema,
}).strict()

export const ConditioningProgressionProjectionV1Schema = z.object({
  schemaVersion: z.literal('conditioning-progression-projection.v1'),
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('insufficient_history'),
      proposalId: z.null(),
    }).strict(),
    z.object({
      kind: z.literal('no_pending_targets'),
      proposalId: z.null(),
    }).strict(),
    z.object({
      kind: z.literal('not_proposed'),
      proposalId: z.null(),
      decision: ConditioningProgressionDecisionV1Schema,
    }).strict(),
    z.object({
      kind: z.literal('proposal'),
      proposalId: z.string().uuid(),
      decision: ConditioningProgressionDecisionV1Schema.refine(
        decision => decision.status === 'proposed',
        'Stored conditioning proposal must be proposed',
      ),
    }).strict(),
  ]),
}).strict()

export type ConditioningProgressionPolicyV1 = z.infer<typeof ConditioningProgressionPolicyV1Schema>
export type ConditioningProgressionPolicyOriginV1 = z.infer<typeof ConditioningProgressionPolicyOriginV1Schema>
export type ConditioningProgressionInputV1 = z.infer<typeof ConditioningProgressionInputV1Schema>
export type ConditioningProgressionDecisionV1 = z.infer<typeof ConditioningProgressionDecisionV1Schema>
export type ConditioningProgressionAcceptanceV1 = z.infer<typeof ConditioningProgressionAcceptanceV1Schema>
export type ConditioningProgressionProjectionV1 = z.infer<typeof ConditioningProgressionProjectionV1Schema>
