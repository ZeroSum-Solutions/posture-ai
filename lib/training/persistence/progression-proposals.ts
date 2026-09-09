import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingServerActor } from '../access/server-actor'
import {
  AcceptProgressionProposalInputV1Schema,
  CreateProgressionProposalInputV1Schema,
  ProgressionProposalDecisionV1Schema,
  TrainingProgressionAcceptanceV1Schema,
  TrainingProgressionProjectionV1Schema,
  type ProgressionProposalDecisionV1,
  type ProgressionTargetV1,
  type TrainingProgressionAcceptanceV1,
  type TrainingProgressionProjectionV1,
} from '../contracts/progression'
import {
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
  executionContextsMatch,
  type ExecutionContextV1,
} from '../contracts/program'
import {
  RecoveryContextRecordV1Schema,
  type RecoveryContextRecordV1,
  type RecoveryContextSubmissionV1,
} from '../contracts/recovery-context'
import {
  buildPersistedProgressionProjection,
  type ProgressionProposalSourceBindingsV1,
} from '../progression/persistedProposal'
import { hashCanonicalDecisionIdentity } from '../progression/identity'
import { resolveRecoveryReview } from '../progression/recoveryReview'
import type { ProgressionReasonV1 } from '../progression/types'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>

export interface StoredProgressionProposalV1 {
  readonly id: string
  readonly proposalKey: string
  readonly createdByUserId: string
  readonly subjectId: string
  readonly assignmentId: string
  readonly baseProgramRevisionNumber: number
  readonly baseAssignmentRevision: number
  readonly targetSessionId: string
  readonly targetExerciseInstanceId: string
  readonly targetSessionRevision: number
  readonly recoveryContextRecordId: string | null
  readonly progressionSeriesId: string
  readonly sourceProfileRevision: number
  readonly sourceEligibilityRevisionId: string
  readonly programHash: string
  readonly executionContext: ExecutionContextV1
  readonly sourceSessionRevisions: readonly { readonly sessionId: string; readonly revision: number }[]
  readonly mutableTargetRevisions: readonly {
    readonly sessionId: string
    readonly sessionRevision: number
    readonly exerciseInstanceId: string
    readonly scheduledLocalDate: string
  }[]
  readonly decision: ProgressionProposalDecisionV1
  readonly createdAt: string
}

export interface ProgressionProposalDependencies {
  readonly now: () => Date
  readonly newId?: () => string
  /** Authenticated, RLS-filtered server projection. */
  readonly loadCandidate: (sessionId: string, exerciseInstanceId: string) => Promise<unknown | null>
  /** Authenticated, source-bound lookup for the latest applicable record. */
  readonly loadRecoveryContext: (sessionId: string, exerciseInstanceId: string) => Promise<unknown | null>
  /** Authenticated, idempotent append; the database derives actor and source bindings. */
  readonly recordRecoveryContext: (input: {
    readonly sessionId: string
    readonly exerciseInstanceId: string
    readonly requestId: string
    readonly context: RecoveryContextSubmissionV1['context']
  }) => Promise<unknown>
  /** Service-only append of a non-authoritative, fully validated proposal. */
  readonly insertProposal: (proposal: StoredProgressionProposalV1) => Promise<{ readonly id: string }>
  /** Authenticated RPC; the database derives auth.uid() and revalidates every source. */
  readonly acceptProposal: (proposalId: string, requestId: string) => Promise<unknown>
}

export type ProgressionProposalErrorCode =
  | 'progression_proposal_unavailable'
  | 'progression_profile_stale'
  | 'progression_source_stale'
  | 'progression_proposal_conflict'
  | 'progression_proposal_forbidden'
  | 'progression_recovery_context_conflict'

export class ProgressionProposalError extends Error {
  constructor(readonly code: ProgressionProposalErrorCode) {
    super(code)
    this.name = 'ProgressionProposalError'
  }
}

function requireActorSubject(actor: AllowedActor, subjectId: string) {
  if (actor.actorKind === 'athlete' && actor.subjectId !== subjectId) {
    throw new ProgressionProposalError('progression_proposal_forbidden')
  }
}

function record(
  id: string,
  actor: AllowedActor,
  target: ProgressionTargetV1,
  decision: ProgressionProposalDecisionV1,
  proposalKey: string,
  bindings: ProgressionProposalSourceBindingsV1,
  recoveryContextRecordId: string | null,
  createdAt: string,
): StoredProgressionProposalV1 {
  const targetBinding = bindings.mutableTargets.find(item => (
    item.sessionId === target.sessionId && item.exerciseInstanceId === target.exerciseInstanceId
  ))
  if (!targetBinding) throw new ProgressionProposalError('progression_proposal_unavailable')
  return Object.freeze({
    id,
    proposalKey,
    createdByUserId: actor.userId,
    subjectId: bindings.subjectId,
    assignmentId: target.assignmentId,
    baseProgramRevisionNumber: target.baseProgramRevisionNumber,
    baseAssignmentRevision: bindings.assignmentRevision,
    targetSessionId: target.sessionId,
    targetExerciseInstanceId: target.exerciseInstanceId,
    targetSessionRevision: targetBinding.sessionRevision,
    recoveryContextRecordId,
    progressionSeriesId: bindings.progressionSeriesId,
    sourceProfileRevision: bindings.profileRevision,
    sourceEligibilityRevisionId: bindings.eligibilitySourceRevisionId,
    programHash: bindings.programHash,
    executionContext: bindings.executionContext,
    sourceSessionRevisions: Object.freeze(bindings.sourceSessions.map(item => Object.freeze({ ...item }))),
    mutableTargetRevisions: Object.freeze(bindings.mutableTargets.map(item => Object.freeze({ ...item }))),
    decision,
    createdAt,
  })
}

const recoveryCandidateBindingSchema = z.object({
  assignment: z.object({
    id: TrainingStableIdV1Schema,
    subjectId: TrainingStableIdV1Schema,
    activeRevision: z.number().int().positive(),
  }).passthrough(),
  programHash: z.string().regex(/^[a-f0-9]{64}$/),
  progressionSeriesId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
}).passthrough()
type RecoveryCandidateBinding = z.infer<typeof recoveryCandidateBindingSchema>

function validatedRecoveryRecord(
  raw: unknown,
  candidate: RecoveryCandidateBinding,
  input: { sessionId: string; exerciseInstanceId: string },
  actor: AllowedActor,
  submitted?: RecoveryContextSubmissionV1,
): RecoveryContextRecordV1 {
  const record = RecoveryContextRecordV1Schema.safeParse(raw)
  if (!record.success
    || record.data.subjectId !== candidate.assignment.subjectId
    || record.data.assignmentId !== candidate.assignment.id
    || record.data.sourceProgramRevisionNumber > candidate.assignment.activeRevision
    || record.data.progressionSeriesId !== candidate.progressionSeriesId
    || !executionContextsMatch(record.data.executionContext, candidate.executionContext)
    || (submitted && (record.data.sourceProgramRevisionNumber !== candidate.assignment.activeRevision
      || record.data.sourceProgramHash !== candidate.programHash
      || record.data.sourceSessionId !== input.sessionId
      || record.data.exerciseInstanceId !== input.exerciseInstanceId
      || hashCanonicalDecisionIdentity(record.data.context)
        !== hashCanonicalDecisionIdentity(submitted.context)))) {
    throw new ProgressionProposalError('progression_proposal_unavailable')
  }
  requireActorSubject(actor, record.data.subjectId)
  return record.data
}

function requireProposedResultBindings(
  result: Extract<ReturnType<typeof buildPersistedProgressionProjection>, { kind: 'proposal' }>,
  candidate: RecoveryCandidateBinding,
): void {
  if (result.sourceBindings.subjectId !== candidate.assignment.subjectId
    || result.target.assignmentId !== candidate.assignment.id
    || result.target.baseProgramRevisionNumber !== candidate.assignment.activeRevision
    || result.sourceBindings.programHash !== candidate.programHash
    || result.sourceBindings.progressionSeriesId !== candidate.progressionSeriesId
    || !executionContextsMatch(result.sourceBindings.executionContext, candidate.executionContext)) {
    throw new ProgressionProposalError('progression_proposal_unavailable')
  }
}

const PRE_RECOVERY_REASONS = new Set<ProgressionReasonV1>([
  'acute_stop',
  'eligibility_unanswered',
  'eligibility_review_required',
  'eligibility_scope_unavailable',
  'eligibility_source_unavailable',
  'eligibility_constraints_unavailable',
  'eligibility_constraints_blocked',
  'stale_session_review',
  'session_in_progress_hold',
  'session_aborted_hold',
  'exercise_incomplete_hold',
  'exercise_aborted_hold',
  'sync_pending_hold',
  'sync_conflict_hold',
  'adverse_symptom_hold',
  'invalid_log_hold',
  'unconfirmed_outlier_hold',
  'effort_unknown_hold',
  'mixed_working_load_review',
  'comparator_changed_recalibration',
  'calibration_required',
])

const PRE_RECOVERY_BODYWEIGHT_ASSISTANCE_REASONS = new Set([
  'policy_unavailable_hold',
  'benchmark_changed_recalibration',
  'assistance_range_recalibration',
  'incomplete_exposure_hold',
  'adverse_symptom_review',
  'effort_unknown_hold',
  'effort_too_easy_recalibration',
])

function resultPrecedesRecovery(result: ReturnType<typeof buildPersistedProgressionProjection>): boolean {
  if (result.kind === 'profile_stale' || result.kind === 'invalid_projection'
    || result.kind === 'evidence_unavailable' || result.kind === 'no_pending_target') return true
  if (result.kind !== 'not_proposed') return false
  if ('reasonCodes' in result.decision) {
    return result.decision.reasonCodes.some(reason => PRE_RECOVERY_REASONS.has(reason))
  }
  return PRE_RECOVERY_BODYWEIGHT_ASSISTANCE_REASONS.has(result.decision.reason)
}

export async function createStoredProgressionProposal(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ProgressionProposalDependencies,
): Promise<TrainingProgressionProjectionV1> {
  const input = CreateProgressionProposalInputV1Schema.parse(rawInput)
  const candidate = await dependencies.loadCandidate(input.sessionId, input.exerciseInstanceId)
  if (candidate === null) throw new ProgressionProposalError('progression_proposal_unavailable')
  const candidateBinding = recoveryCandidateBindingSchema.safeParse(candidate)
  if (!candidateBinding.success) throw new ProgressionProposalError('progression_proposal_unavailable')
  requireActorSubject(actor, candidateBinding.data.assignment.subjectId)

  const result = buildPersistedProgressionProjection(candidate, dependencies.now())
  if (result.kind === 'profile_stale') throw new ProgressionProposalError('progression_profile_stale')
  if (result.kind === 'invalid_projection' || result.kind === 'evidence_unavailable') {
    throw new ProgressionProposalError('progression_proposal_unavailable')
  }
  if (result.kind === 'no_pending_target') {
    return TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: { ...result, proposalId: null },
    })
  }
  if (resultPrecedesRecovery(result)) {
    return TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: { ...result, proposalId: null },
    })
  }

  const rawRecovery = input.recoveryContext
    ? await dependencies.recordRecoveryContext({
      sessionId: input.sessionId,
      exerciseInstanceId: input.exerciseInstanceId,
      requestId: input.recoveryContext.requestId,
      context: input.recoveryContext.context,
    })
    : await dependencies.loadRecoveryContext(input.sessionId, input.exerciseInstanceId)
  const recoveryRecord = rawRecovery === null
    ? null
    : validatedRecoveryRecord(rawRecovery, candidateBinding.data, input, actor, input.recoveryContext)
  const recoveryReview = resolveRecoveryReview(recoveryRecord?.context)
  if (recoveryRecord && recoveryReview.kind !== 'legacy_path'
    && recoveryReview.kind !== 'performance_eligible') {
    return TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: {
        kind: 'recovery_review', proposalId: null,
        requestBinding: {
          sessionId: input.sessionId,
          exerciseInstanceId: input.exerciseInstanceId,
        },
        record: recoveryRecord, review: recoveryReview,
      },
    })
  }
  if (result.kind === 'not_proposed') {
    return TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: { ...result, proposalId: null },
    })
  }
  requireProposedResultBindings(result, candidateBinding.data)
  const proposedId = (dependencies.newId ?? randomUUID)()
  const proposalKey = recoveryRecord
    ? hashCanonicalDecisionIdentity({
      proposalKey: result.proposalKey,
      recoveryContextRecordId: recoveryRecord.recordId,
    })
    : result.proposalKey
  const persisted = await dependencies.insertProposal(record(
    proposedId, actor, result.target, result.decision, proposalKey,
    result.sourceBindings, recoveryRecord?.recordId ?? null, dependencies.now().toISOString(),
  ))
  return TrainingProgressionProjectionV1Schema.parse({
    schemaVersion: 'training-progression-projection.v1',
    result: {
      kind: 'proposal', proposalId: persisted.id,
      executionContext: result.sourceBindings.executionContext,
      target: result.target, decision: result.decision,
    },
  })
}

export async function acceptStoredProgressionProposal(
  proposalId: string,
  rawInput: unknown,
  dependencies: ProgressionProposalDependencies,
): Promise<TrainingProgressionAcceptanceV1> {
  const id = z.string().uuid().parse(proposalId)
  const input = AcceptProgressionProposalInputV1Schema.parse(rawInput)
  const result = await dependencies.acceptProposal(id, input.requestId)
  const parsed = TrainingProgressionAcceptanceV1Schema.safeParse(result)
  if (!parsed.success || parsed.data.proposalId !== id) {
    throw new ProgressionProposalError('progression_proposal_unavailable')
  }
  return parsed.data
}

type RpcClient = Pick<SupabaseClient, 'rpc'>
type ProposalInsertClient = Pick<SupabaseClient, 'from'>

const storedProposalReplayRowSchema = z.object({
  id: z.string().uuid(),
  proposal_key: z.string().regex(/^[a-f0-9]{64}$/),
  created_by_user_id: z.string().uuid(),
  subject_id: TrainingStableIdV1Schema,
  assignment_id: TrainingStableIdV1Schema,
  base_program_revision_number: z.number().int().positive(),
  base_assignment_revision: z.number().int().positive(),
  target_session_id: TrainingStableIdV1Schema,
  target_exercise_instance_id: TrainingStableIdV1Schema,
  target_session_revision: z.number().int().positive(),
  recovery_context_record_id: z.string().uuid().nullable(),
  progression_series_id: TrainingStableIdV1Schema,
  source_profile_revision: z.number().int().positive(),
  source_eligibility_revision_id: TrainingStableIdV1Schema,
  source_program_hash: z.string().regex(/^[a-f0-9]{64}$/),
  execution_context: ExecutionContextV1Schema,
  source_session_revisions: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    revision: z.number().int().positive(),
  }).strict()).min(1).max(64),
  mutable_target_revisions: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    sessionRevision: z.number().int().positive(),
    exerciseInstanceId: TrainingStableIdV1Schema,
    scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict()).min(1).max(64),
  decision_json: ProgressionProposalDecisionV1Schema,
}).strict()

const replaySelectColumns = [
  'id', 'proposal_key', 'created_by_user_id', 'subject_id', 'assignment_id',
  'base_program_revision_number', 'base_assignment_revision', 'target_session_id',
  'target_exercise_instance_id', 'target_session_revision', 'recovery_context_record_id',
  'progression_series_id', 'source_profile_revision', 'source_eligibility_revision_id',
  'source_program_hash', 'execution_context', 'source_session_revisions',
  'mutable_target_revisions', 'decision_json',
].join(',')

export function createSupabaseProgressionProposalDependencies(
  authenticated: RpcClient,
  service: ProposalInsertClient,
  now: () => Date = () => new Date(),
): ProgressionProposalDependencies {
  return {
    now,
    loadCandidate: async (sessionId, exerciseInstanceId) => {
      const { data, error } = await authenticated.rpc('read_training_progression_candidate', {
        p_session_id: sessionId,
        p_exercise_instance_id: exerciseInstanceId,
      })
      if (error) throw new ProgressionProposalError('progression_proposal_unavailable')
      return data
    },
    loadRecoveryContext: async (sessionId, exerciseInstanceId) => {
      const { data, error } = await authenticated.rpc('read_training_recovery_context', {
        p_session_id: sessionId,
        p_exercise_instance_id: exerciseInstanceId,
      })
      if (error) {
        if (error.code === '42501' || error.code === 'P0001') {
          throw new ProgressionProposalError('progression_proposal_forbidden')
        }
        throw new ProgressionProposalError('progression_proposal_unavailable')
      }
      return data
    },
    recordRecoveryContext: async input => {
      const { data, error } = await authenticated.rpc('record_training_recovery_context', {
        p_session_id: input.sessionId,
        p_exercise_instance_id: input.exerciseInstanceId,
        p_request_id: input.requestId,
        p_context_json: input.context,
      })
      if (error) {
        if (error.code === 'PT409') {
          throw new ProgressionProposalError('progression_recovery_context_conflict')
        }
        if (error.code === '40001') {
          throw new ProgressionProposalError('progression_source_stale')
        }
        if (error.code === '42501' || error.code === 'P0001') {
          throw new ProgressionProposalError('progression_proposal_forbidden')
        }
        throw new ProgressionProposalError('progression_proposal_unavailable')
      }
      return data
    },
    insertProposal: async (proposal) => {
      const row = {
        id: proposal.id,
        proposal_key: proposal.proposalKey,
        created_by_user_id: proposal.createdByUserId,
        subject_id: proposal.subjectId,
        assignment_id: proposal.assignmentId,
        base_program_revision_number: proposal.baseProgramRevisionNumber,
        base_assignment_revision: proposal.baseAssignmentRevision,
        target_session_id: proposal.targetSessionId,
        target_exercise_instance_id: proposal.targetExerciseInstanceId,
        target_session_revision: proposal.targetSessionRevision,
        recovery_context_record_id: proposal.recoveryContextRecordId,
        progression_series_id: proposal.progressionSeriesId,
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        source_program_hash: proposal.programHash,
        execution_context: proposal.executionContext,
        source_session_revisions: proposal.sourceSessionRevisions,
        mutable_target_revisions: proposal.mutableTargetRevisions,
        decision_json: proposal.decision,
        created_at: proposal.createdAt,
      }
      const inserted = await service.from('training_progression_proposals')
        .insert(row).select('id').single()
      if (!inserted.error && inserted.data && typeof inserted.data.id === 'string') {
        return { id: inserted.data.id }
      }
      if (inserted.error?.code !== '23505') {
        throw new ProgressionProposalError('progression_proposal_unavailable')
      }
      const existing = await service.from('training_progression_proposals')
        .select(replaySelectColumns).eq('proposal_key', proposal.proposalKey).single()
      const parsedExisting = storedProposalReplayRowSchema.safeParse(existing.data)
      if (existing.error || !parsedExisting.success) {
        throw new ProgressionProposalError('progression_proposal_unavailable')
      }
      const { id: existingId, ...existingIdentity } = parsedExisting.data
      const { id: _attemptedId, created_at: _createdAt, ...attemptedIdentity } = row
      void _attemptedId
      void _createdAt
      if (hashCanonicalDecisionIdentity(existingIdentity) !== hashCanonicalDecisionIdentity(attemptedIdentity)) {
        throw new ProgressionProposalError('progression_proposal_conflict')
      }
      return { id: existingId }
    },
    acceptProposal: async (proposalId, requestId) => {
      const { data, error } = await authenticated.rpc('accept_training_progression_proposal', {
        p_proposal_id: proposalId, p_request_id: requestId,
      })
      if (error) {
        if (error.code === 'PT409' || error.code === '40001') {
          throw new ProgressionProposalError('progression_source_stale')
        }
        if (error.code === '42501' || error.code === 'P0001') {
          throw new ProgressionProposalError('progression_proposal_forbidden')
        }
        throw new ProgressionProposalError('progression_proposal_unavailable')
      }
      return data
    },
  }
}
