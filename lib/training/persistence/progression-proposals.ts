import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingServerActor } from '../access/server-actor'
import {
  AcceptProgressionProposalInputV1Schema,
  CreateProgressionProposalInputV1Schema,
  TrainingProgressionAcceptanceV1Schema,
  TrainingProgressionProjectionV1Schema,
  type ProgressionProposalV1,
  type ProgressionTargetV1,
  type TrainingProgressionAcceptanceV1,
  type TrainingProgressionProjectionV1,
} from '../contracts/progression'
import type { ExecutionContextV1 } from '../contracts/program'
import {
  buildPersistedProgressionProjection,
  type ProgressionProposalSourceBindingsV1,
} from '../progression/persistedProposal'

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
  readonly decision: ProgressionProposalV1
  readonly createdAt: string
}

export interface ProgressionProposalDependencies {
  readonly now: () => Date
  readonly newId?: () => string
  /** Authenticated, RLS-filtered server projection. */
  readonly loadCandidate: (sessionId: string, exerciseInstanceId: string) => Promise<unknown | null>
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
  decision: ProgressionProposalV1,
  proposalKey: string,
  bindings: ProgressionProposalSourceBindingsV1,
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

export async function createStoredProgressionProposal(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ProgressionProposalDependencies,
): Promise<TrainingProgressionProjectionV1> {
  const input = CreateProgressionProposalInputV1Schema.parse(rawInput)
  const candidate = await dependencies.loadCandidate(input.sessionId, input.exerciseInstanceId)
  if (candidate === null) throw new ProgressionProposalError('progression_proposal_unavailable')
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
  if (result.kind === 'not_proposed') {
    return TrainingProgressionProjectionV1Schema.parse({
      schemaVersion: 'training-progression-projection.v1',
      result: { ...result, proposalId: null },
    })
  }
  requireActorSubject(actor, result.sourceBindings.subjectId)
  const proposedId = (dependencies.newId ?? randomUUID)()
  const persisted = await dependencies.insertProposal(record(
    proposedId, actor, result.target, result.decision, result.proposalKey,
    result.sourceBindings, dependencies.now().toISOString(),
  ))
  return TrainingProgressionProjectionV1Schema.parse({
    schemaVersion: 'training-progression-projection.v1',
    result: {
      kind: 'proposal', proposalId: persisted.id,
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
        .select('id').eq('proposal_key', proposal.proposalKey).single()
      if (existing.error || !existing.data || typeof existing.data.id !== 'string') {
        throw new ProgressionProposalError('progression_proposal_unavailable')
      }
      return { id: existing.data.id }
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
