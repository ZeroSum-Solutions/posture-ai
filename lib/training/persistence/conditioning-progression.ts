import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingServerActor } from '../access/server-actor'
import {
  AcceptConditioningProgressionProposalInputV1Schema,
  ConditioningProgressionAcceptanceV1Schema,
  ConditioningProgressionProjectionV1Schema,
  ConditioningProgressionSourceBoutV1Schema,
  ConditioningProgressionTargetBoutV1Schema,
  CreateConditioningProgressionProposalInputV1Schema,
  type ConditioningProgressionAcceptanceV1,
  type ConditioningProgressionDecisionV1,
  type ConditioningProgressionPolicyV1,
  type ConditioningProgressionProjectionV1,
} from '../contracts/conditioning-progression'
import { ExecutionContextV1Schema, TrainingStableIdV1Schema, type ExecutionContextV1 } from '../contracts/program'
import { decideConditioningProgression } from '../progression/conditioningDecision'
import { resolveConditioningProgressionPolicy } from '../progression/conditioningPolicy'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const candidateSchema = z.object({
  schemaVersion: z.literal('conditioning-progression-candidate.v1'),
  status: z.literal('ready'),
  subjectId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  assignmentRevision: revisionSchema,
  baseProgramRevisionNumber: revisionSchema,
  sourceProfileRevision: revisionSchema,
  sourceEligibilityRevisionId: TrainingStableIdV1Schema,
  programHash: z.string().regex(/^[a-f0-9]{64}$/),
  executionContext: ExecutionContextV1Schema,
  modalityId: TrainingStableIdV1Schema,
  sourceBouts: z.array(ConditioningProgressionSourceBoutV1Schema).length(2),
  targetBouts: z.array(ConditioningProgressionTargetBoutV1Schema).length(2),
  plannedWeeklyDurationSeconds: z.number().int().min(0).max(86_400),
}).strict()
const candidateReadSchema = z.discriminatedUnion('status', [
  candidateSchema,
  z.object({
    schemaVersion: z.literal('conditioning-progression-candidate.v1'),
    status: z.literal('insufficient_history'),
  }).strict(),
  z.object({
    schemaVersion: z.literal('conditioning-progression-candidate.v1'),
    status: z.literal('no_pending_targets'),
  }).strict(),
])

export interface StoredConditioningProgressionProposalV1 {
  readonly id: string
  readonly proposalKey: string
  readonly createdByUserId: string
  readonly subjectId: string
  readonly assignmentId: string
  readonly baseProgramRevisionNumber: number
  readonly baseAssignmentRevision: number
  readonly sourceProfileRevision: number
  readonly sourceEligibilityRevisionId: string
  readonly sourceProgramHash: string
  readonly executionContext: ExecutionContextV1
  readonly policy: ConditioningProgressionPolicyV1
  readonly sourceSessionRevisions: readonly {
    readonly sessionId: string
    readonly sessionRevision: number
    readonly conditioningEventRevision: number
  }[]
  readonly mutableTargetRevisions: readonly {
    readonly sessionId: string
    readonly sessionRevision: number
    readonly boutId: string
    readonly scheduledLocalDate: string
    readonly acceptedDurationSeconds: number
  }[]
  readonly decision: Extract<ConditioningProgressionDecisionV1, { status: 'proposed' }>
  readonly createdAt: string
}

export interface ConditioningProgressionDependencies {
  readonly now: () => Date
  readonly newId?: () => string
  readonly loadCandidate: (sessionId: string) => Promise<unknown | null>
  readonly resolvePolicy?: (
    modalityId: string,
    context: ExecutionContextV1,
  ) => ConditioningProgressionPolicyV1 | null
  readonly insertProposal: (
    proposal: StoredConditioningProgressionProposalV1,
  ) => Promise<{ readonly id: string }>
  readonly acceptProposal: (proposalId: string, requestId: string) => Promise<unknown>
}

export type ConditioningProgressionErrorCode =
  | 'conditioning_progression_unavailable'
  | 'conditioning_progression_policy_unavailable'
  | 'conditioning_progression_forbidden'
  | 'conditioning_progression_source_stale'

export class ConditioningProgressionError extends Error {
  constructor(readonly code: ConditioningProgressionErrorCode) {
    super(code)
    this.name = 'ConditioningProgressionError'
  }
}

export async function createStoredConditioningProgressionProposal(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ConditioningProgressionDependencies,
): Promise<ConditioningProgressionProjectionV1> {
  const input = CreateConditioningProgressionProposalInputV1Schema.parse(rawInput)
  const rawCandidate = await dependencies.loadCandidate(input.sessionId)
  const candidate = candidateReadSchema.safeParse(rawCandidate)
  if (!candidate.success) throw new ConditioningProgressionError('conditioning_progression_unavailable')
  if (candidate.data.status !== 'ready') {
    return ConditioningProgressionProjectionV1Schema.parse({
      schemaVersion: 'conditioning-progression-projection.v1',
      result: { kind: candidate.data.status, proposalId: null },
    })
  }
  if (actor.actorKind === 'athlete' && actor.subjectId !== candidate.data.subjectId) {
    throw new ConditioningProgressionError('conditioning_progression_forbidden')
  }
  const policy = (dependencies.resolvePolicy ?? resolveConditioningProgressionPolicy)(
    candidate.data.modalityId,
    candidate.data.executionContext,
  )
  if (!policy) throw new ConditioningProgressionError('conditioning_progression_policy_unavailable')
  const decision = decideConditioningProgression({
    schemaVersion: 'conditioning-progression-input.v1',
    subjectId: candidate.data.subjectId,
    assignmentId: candidate.data.assignmentId,
    assignmentRevision: candidate.data.assignmentRevision,
    baseProgramRevisionNumber: candidate.data.baseProgramRevisionNumber,
    sourceProfileRevision: candidate.data.sourceProfileRevision,
    sourceEligibilityRevisionId: candidate.data.sourceEligibilityRevisionId,
    executionContext: candidate.data.executionContext,
    policy,
    sourceBouts: candidate.data.sourceBouts,
    targetBouts: candidate.data.targetBouts,
    plannedWeeklyDurationSeconds: candidate.data.plannedWeeklyDurationSeconds,
  })
  if (decision.status === 'not_proposed') {
    return ConditioningProgressionProjectionV1Schema.parse({
      schemaVersion: 'conditioning-progression-projection.v1',
      result: { kind: 'not_proposed', proposalId: null, decision },
    })
  }
  const proposal: StoredConditioningProgressionProposalV1 = Object.freeze({
    id: (dependencies.newId ?? randomUUID)(),
    proposalKey: decision.decisionKey.replace('conditioning-duration-v1:sha256:', ''),
    createdByUserId: actor.userId,
    subjectId: candidate.data.subjectId,
    assignmentId: candidate.data.assignmentId,
    baseProgramRevisionNumber: candidate.data.baseProgramRevisionNumber,
    baseAssignmentRevision: candidate.data.assignmentRevision,
    sourceProfileRevision: candidate.data.sourceProfileRevision,
    sourceEligibilityRevisionId: candidate.data.sourceEligibilityRevisionId,
    sourceProgramHash: candidate.data.programHash,
    executionContext: candidate.data.executionContext,
    policy,
    sourceSessionRevisions: Object.freeze(decision.sourceSessionRevisions.map(item => Object.freeze({ ...item }))),
    mutableTargetRevisions: Object.freeze(candidate.data.targetBouts.map(item => Object.freeze({
      sessionId: item.sessionId,
      sessionRevision: item.sessionRevision,
      boutId: item.boutId,
      scheduledLocalDate: item.scheduledLocalDate,
      acceptedDurationSeconds: item.acceptedDurationSeconds,
    }))),
    decision,
    createdAt: dependencies.now().toISOString(),
  })
  const stored = await dependencies.insertProposal(proposal)
  return ConditioningProgressionProjectionV1Schema.parse({
    schemaVersion: 'conditioning-progression-projection.v1',
    result: { kind: 'proposal', proposalId: stored.id, decision },
  })
}

export async function acceptStoredConditioningProgressionProposal(
  proposalId: string,
  rawInput: unknown,
  dependencies: ConditioningProgressionDependencies,
): Promise<ConditioningProgressionAcceptanceV1> {
  const id = z.string().uuid().parse(proposalId)
  const input = AcceptConditioningProgressionProposalInputV1Schema.parse(rawInput)
  const result = ConditioningProgressionAcceptanceV1Schema.safeParse(
    await dependencies.acceptProposal(id, input.requestId),
  )
  if (!result.success || result.data.proposalId !== id) {
    throw new ConditioningProgressionError('conditioning_progression_unavailable')
  }
  return result.data
}

type RpcClient = Pick<SupabaseClient, 'rpc'>
type InsertClient = Pick<SupabaseClient, 'from'>

export function createSupabaseConditioningProgressionDependencies(
  authenticated: RpcClient,
  service: InsertClient,
  now: () => Date = () => new Date(),
): ConditioningProgressionDependencies {
  return {
    now,
    loadCandidate: async (sessionId) => {
      const result = await authenticated.rpc('read_training_conditioning_progression_candidate', {
        p_session_id: sessionId,
      })
      if (result.error) throw new ConditioningProgressionError('conditioning_progression_unavailable')
      return result.data
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
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        source_program_hash: proposal.sourceProgramHash,
        execution_context: proposal.executionContext,
        policy_json: proposal.policy,
        source_session_revisions: proposal.sourceSessionRevisions,
        mutable_target_revisions: proposal.mutableTargetRevisions,
        decision_json: proposal.decision,
        created_at: proposal.createdAt,
      }
      const inserted = await service.from('training_conditioning_progression_proposals')
        .insert(row).select('id').single()
      if (!inserted.error && inserted.data && typeof inserted.data.id === 'string') {
        return { id: inserted.data.id }
      }
      if (inserted.error?.code !== '23505') {
        throw new ConditioningProgressionError('conditioning_progression_unavailable')
      }
      const existing = await service.from('training_conditioning_progression_proposals')
        .select('id').eq('proposal_key', proposal.proposalKey).single()
      if (existing.error || !existing.data || typeof existing.data.id !== 'string') {
        throw new ConditioningProgressionError('conditioning_progression_unavailable')
      }
      return { id: existing.data.id }
    },
    acceptProposal: async (proposalId, requestId) => {
      const result = await authenticated.rpc('accept_training_conditioning_progression_proposal', {
        p_proposal_id: proposalId,
        p_request_id: requestId,
      })
      if (result.error) {
        if (result.error.code === 'PT409' || result.error.code === '40001') {
          throw new ConditioningProgressionError('conditioning_progression_source_stale')
        }
        if (result.error.code === '42501' || result.error.code === 'P0001') {
          throw new ConditioningProgressionError('conditioning_progression_forbidden')
        }
        throw new ConditioningProgressionError('conditioning_progression_unavailable')
      }
      return result.data
    },
  }
}
