import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingServerActor } from '../access/server-actor'
import {
  resolveSyntheticBodyweightAssistancePolicy,
} from '../catalog/syntheticRegistry'
import { DEFAULT_TRAINING_CATALOG_RESOLVER } from '../catalog/contextRegistry'
import type { TrainingCatalogOriginV1 } from '../catalog/types'
import type { ActiveCalibrationOfferV1 } from '../contracts/active-calibration'
import {
  ActiveCalibrationAcceptanceV1Schema,
  ActiveCalibrationProposalProjectionV1Schema,
  AcceptActiveCalibrationProposalInputV1Schema,
  CreateActiveCalibrationProposalInputV1Schema,
  type ActiveCalibrationAcceptanceV1,
  type ActiveCalibrationProposalProjectionV1,
} from '../contracts/active-calibration-persistence'
import { EligibilitySnapshotV1Schema } from '../contracts/eligibility'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import {
  ExecutionContextV1Schema,
  TrainingProgramRevisionV1Schema,
  TrainingStableIdV1Schema,
  executionContextsMatch,
} from '../contracts/program'
import {
  buildActiveCalibrationOffer,
  type ActiveCalibrationCatalogRegistryV1,
} from '../engine/activeCalibration'
import { hashCanonicalDecisionIdentity } from '../progression/identity'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const proposalLifetimeSchema = z.object({
  proposalId: z.string().uuid(),
  status: z.enum(['active', 'renewed', 'accepted']),
  expiresAt: z.string().datetime({ offset: true }),
}).strict()

const targetBindingSchema = z.object({
  sessionId: TrainingStableIdV1Schema,
  sessionRevision: revisionSchema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

const candidateSchema = z.object({
  assignment: z.object({
    id: TrainingStableIdV1Schema,
    subjectId: TrainingStableIdV1Schema,
    programMode: z.enum(['self_directed', 'coach_assigned']),
    owningPractitionerId: z.string().uuid().nullable(),
    activeRevision: revisionSchema,
    revision: revisionSchema,
  }).passthrough(),
  program: TrainingProgramRevisionV1Schema,
  programHash: z.string().regex(/^[a-f0-9]{64}$/),
  currentProfileRevision: revisionSchema,
  profileRevision: revisionSchema,
  profile: AthleteTrainingProfileV1Schema,
  eligibility: EligibilitySnapshotV1Schema,
  progressionSeriesId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  targets: z.array(targetBindingSchema).min(1).max(64),
  sourceSessionRevision: revisionSchema,
  sourceSessionState: z.enum(['completed', 'completed_with_omissions']),
}).passthrough()
type Candidate = z.infer<typeof candidateSchema>

export interface ActiveCalibrationRegistryV1 {
  readonly catalog: ActiveCalibrationCatalogRegistryV1
  readonly bodyweightAssistancePolicy: {
    readonly resolve: typeof resolveSyntheticBodyweightAssistancePolicy
  }
}

export const DEFAULT_ACTIVE_CALIBRATION_REGISTRY: ActiveCalibrationRegistryV1 = Object.freeze({
  catalog: DEFAULT_TRAINING_CATALOG_RESOLVER,
  bodyweightAssistancePolicy: { resolve: resolveSyntheticBodyweightAssistancePolicy },
})

export interface StoredActiveCalibrationProposalV1 {
  readonly id: string
  readonly proposalKey: string
  readonly createdByUserId: string
  readonly subjectId: string
  readonly assignmentId: string
  readonly baseProgramRevisionNumber: number
  readonly baseAssignmentRevision: number
  readonly sourceSessionId: string
  readonly sourceExerciseInstanceId: string
  readonly sourceSessionRevision: number
  readonly sourceProfileRevision: number
  readonly sourceEligibilityRevisionId: string
  readonly sourceProgramHash: string
  readonly executionContext: z.infer<typeof ExecutionContextV1Schema>
  readonly catalogVersion: string
  readonly catalogOrigin: TrainingCatalogOriginV1
  readonly targetBindings: readonly z.infer<typeof targetBindingSchema>[]
  readonly offer: Extract<ActiveCalibrationOfferV1, { kind: 'options' }>
  readonly createdAt: string
  readonly expiresAt: string
}

export interface ActiveCalibrationDependencies {
  readonly now: () => Date
  readonly newId?: () => string
  readonly loadCandidate: (sessionId: string, exerciseInstanceId: string) => Promise<unknown | null>
  readonly insertProposal: (proposal: StoredActiveCalibrationProposalV1) => Promise<{ readonly id: string }>
  readonly acceptProposal: (proposalId: string, requestId: string, optionIndex: number) => Promise<unknown>
}

export type ActiveCalibrationErrorCode =
  | 'active_calibration_unavailable'
  | 'active_calibration_forbidden'
  | 'active_calibration_source_stale'
  | 'active_calibration_request_id_conflict'

export class ActiveCalibrationError extends Error {
  constructor(readonly code: ActiveCalibrationErrorCode) {
    super(code)
    this.name = 'ActiveCalibrationError'
  }
}

function parseCandidate(raw: unknown, actor: AllowedActor): Candidate {
  const parsed = candidateSchema.safeParse(raw)
  if (!parsed.success) throw new ActiveCalibrationError('active_calibration_unavailable')
  const candidate = parsed.data
  if (actor.actorKind === 'athlete' && actor.subjectId !== candidate.assignment.subjectId) {
    throw new ActiveCalibrationError('active_calibration_forbidden')
  }
  if (actor.actorKind === 'practitioner' && (
    candidate.assignment.programMode !== 'coach_assigned'
    || candidate.assignment.owningPractitionerId !== actor.userId
  )) {
    throw new ActiveCalibrationError('active_calibration_forbidden')
  }
  if (candidate.program.assignmentId !== candidate.assignment.id
    || candidate.program.subjectId !== candidate.assignment.subjectId
    || candidate.program.revisionNumber !== candidate.assignment.activeRevision
    || candidate.profileRevision !== candidate.currentProfileRevision
    || candidate.program.profileRevisionId !== String(candidate.profileRevision)
    || candidate.program.eligibilitySourceRevisionId !== candidate.eligibility.sourceRevisionId
    || !executionContextsMatch(candidate.program.executionContext, candidate.executionContext)) {
    throw new ActiveCalibrationError('active_calibration_source_stale')
  }
  const ordered = [...candidate.targets].sort((left, right) => (
    left.scheduledLocalDate.localeCompare(right.scheduledLocalDate)
    || left.sessionId.localeCompare(right.sessionId)
    || left.exerciseInstanceId.localeCompare(right.exerciseInstanceId)
  ))
  if (hashCanonicalDecisionIdentity(ordered) !== hashCanonicalDecisionIdentity(candidate.targets)) {
    throw new ActiveCalibrationError('active_calibration_unavailable')
  }
  return candidate
}

export async function createStoredActiveCalibrationProposal(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ActiveCalibrationDependencies,
  registry: ActiveCalibrationRegistryV1 = DEFAULT_ACTIVE_CALIBRATION_REGISTRY,
): Promise<ActiveCalibrationProposalProjectionV1> {
  const input = CreateActiveCalibrationProposalInputV1Schema.parse(rawInput)
  const candidate = parseCandidate(await dependencies.loadCandidate(input.sessionId, input.exerciseInstanceId), actor)
  const target = candidate.targets[0]
  const offer = buildActiveCalibrationOffer({
    program: candidate.program,
    sourceProgramHash: candidate.programHash,
    currentProfileRevisionId: String(candidate.currentProfileRevision),
    currentProfile: candidate.profile,
    currentEligibility: candidate.eligibility,
    evaluatedAt: dependencies.now().toISOString(),
    target: {
      sessionId: target.sessionId,
      exerciseInstanceId: target.exerciseInstanceId,
      sessionState: 'scheduled',
      prescriptionState: 'unprescribed',
    },
    catalogRegistry: registry.catalog,
    bodyweightAssistancePolicyRegistry: registry.bodyweightAssistancePolicy,
  })
  if (offer.kind === 'unavailable') {
    return ActiveCalibrationProposalProjectionV1Schema.parse({
      schemaVersion: 'active-calibration-projection.v1', proposalId: null, offer,
    })
  }
  const now = dependencies.now()
  const proposalKey = hashCanonicalDecisionIdentity({
    schemaVersion: 'active-calibration-proposal-key.v1',
    assignmentRevision: candidate.assignment.revision,
    sourceSessionId: input.sessionId,
    sourceExerciseInstanceId: input.exerciseInstanceId,
    sourceSessionRevision: candidate.sourceSessionRevision,
    programHash: candidate.programHash,
    offer,
    targetBindings: candidate.targets,
  })
  const stored = await dependencies.insertProposal(Object.freeze({
    id: (dependencies.newId ?? randomUUID)(), proposalKey,
    createdByUserId: actor.userId,
    subjectId: candidate.assignment.subjectId,
    assignmentId: candidate.assignment.id,
    baseProgramRevisionNumber: candidate.assignment.activeRevision,
    baseAssignmentRevision: candidate.assignment.revision,
    sourceSessionId: input.sessionId,
    sourceExerciseInstanceId: input.exerciseInstanceId,
    sourceSessionRevision: candidate.sourceSessionRevision,
    sourceProfileRevision: candidate.currentProfileRevision,
    sourceEligibilityRevisionId: candidate.eligibility.sourceRevisionId,
    sourceProgramHash: candidate.programHash,
    executionContext: candidate.executionContext,
    catalogVersion: candidate.program.catalogVersion,
    catalogOrigin: candidate.program.catalogOrigin,
    targetBindings: candidate.targets,
    offer,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
  }))
  return ActiveCalibrationProposalProjectionV1Schema.parse({
    schemaVersion: 'active-calibration-projection.v1', proposalId: stored.id, offer,
  })
}

export async function acceptStoredActiveCalibrationProposal(
  proposalId: string,
  rawInput: unknown,
  dependencies: ActiveCalibrationDependencies,
): Promise<ActiveCalibrationAcceptanceV1> {
  const id = z.string().uuid().parse(proposalId)
  const input = AcceptActiveCalibrationProposalInputV1Schema.parse(rawInput)
  const parsed = ActiveCalibrationAcceptanceV1Schema.safeParse(
    await dependencies.acceptProposal(id, input.requestId, input.optionIndex),
  )
  if (!parsed.success || parsed.data.proposalId !== id) {
    throw new ActiveCalibrationError('active_calibration_unavailable')
  }
  return parsed.data
}

type RpcClient = Pick<SupabaseClient, 'rpc'>
type InsertClient = Pick<SupabaseClient, 'from'>

export function createSupabaseActiveCalibrationDependencies(
  authenticated: RpcClient,
  service: InsertClient,
  now: () => Date = () => new Date(),
): ActiveCalibrationDependencies {
  return {
    now,
    loadCandidate: async (sessionId, exerciseInstanceId) => {
      const result = await authenticated.rpc('read_training_active_calibration_candidate', {
        p_session_id: sessionId, p_exercise_instance_id: exerciseInstanceId,
      })
      if (result.error) throw new ActiveCalibrationError('active_calibration_unavailable')
      return result.data
    },
    insertProposal: async proposal => {
      const row = {
        id: proposal.id, proposal_key: proposal.proposalKey,
        created_by_user_id: proposal.createdByUserId, subject_id: proposal.subjectId,
        assignment_id: proposal.assignmentId,
        base_program_revision_number: proposal.baseProgramRevisionNumber,
        base_assignment_revision: proposal.baseAssignmentRevision,
        source_session_id: proposal.sourceSessionId,
        source_exercise_instance_id: proposal.sourceExerciseInstanceId,
        source_session_revision: proposal.sourceSessionRevision,
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        source_program_hash: proposal.sourceProgramHash,
        execution_context: proposal.executionContext,
        catalog_version: proposal.catalogVersion, catalog_origin: proposal.catalogOrigin,
        target_bindings: proposal.targetBindings, offer_json: proposal.offer,
        created_at: proposal.createdAt, expires_at: proposal.expiresAt,
      }
      const inserted = await service.from('training_active_calibration_proposals')
        .insert(row).select('id').single()
      if (!inserted.error && inserted.data && typeof inserted.data.id === 'string') return { id: inserted.data.id }
      if (inserted.error?.code !== '23505') throw new ActiveCalibrationError('active_calibration_unavailable')
      const existing = await service.from('training_active_calibration_proposals')
        .select('id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,base_assignment_revision,source_session_id,source_exercise_instance_id,source_session_revision,source_profile_revision,source_eligibility_revision_id,source_program_hash,execution_context,catalog_version,catalog_origin,target_bindings,offer_json,expires_at')
        .eq('proposal_key', proposal.proposalKey).single()
      if (existing.error || !existing.data || typeof existing.data.id !== 'string') {
        throw new ActiveCalibrationError('active_calibration_unavailable')
      }
      const {
        id, created_by_user_id: _existingCreator, expires_at: _existingExpiry,
        ...existingIdentity
      } = existing.data
      const {
        id: _id, created_by_user_id: _attemptedCreator, created_at: _createdAt,
        expires_at: _attemptedExpiry, ...attemptedIdentity
      } = row
      void _existingCreator; void _existingExpiry; void _id
      void _attemptedCreator; void _createdAt; void _attemptedExpiry
      if (hashCanonicalDecisionIdentity(existingIdentity) !== hashCanonicalDecisionIdentity(attemptedIdentity)) {
        throw new ActiveCalibrationError('active_calibration_request_id_conflict')
      }
      const renewed = await authenticated.rpc('renew_training_active_calibration_proposal', {
        p_proposal_id: id,
      })
      if (renewed.error?.code === '42501') {
        throw new ActiveCalibrationError('active_calibration_forbidden')
      }
      if (['PT409', '40001', '40P01'].includes(renewed.error?.code ?? '')) {
        throw new ActiveCalibrationError('active_calibration_source_stale')
      }
      const lifetime = proposalLifetimeSchema.safeParse(renewed.data)
      if (renewed.error || !lifetime.success || lifetime.data.proposalId !== id) {
        throw new ActiveCalibrationError('active_calibration_unavailable')
      }
      return { id }
    },
    acceptProposal: async (proposalId, requestId, optionIndex) => {
      const result = await authenticated.rpc('accept_training_active_calibration_proposal', {
        p_proposal_id: proposalId, p_request_id: requestId, p_option_index: optionIndex,
      })
      if (!result.error) return result.data
      const message = result.error.message ?? ''
      if (result.error.code === 'PT409' && message.includes('request ID')) {
        throw new ActiveCalibrationError('active_calibration_request_id_conflict')
      }
      if (['PT409', '40001', '40P01'].includes(result.error.code ?? '')) {
        throw new ActiveCalibrationError('active_calibration_source_stale')
      }
      if (['42501', 'P0001'].includes(result.error.code ?? '')) {
        throw new ActiveCalibrationError('active_calibration_forbidden')
      }
      throw new ActiveCalibrationError('active_calibration_unavailable')
    },
  }
}
