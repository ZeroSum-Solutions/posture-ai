import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingServerActor } from '../access/server-actor'
import {
  resolveSyntheticBodyweightAssistancePolicy,
} from '../catalog/syntheticRegistry'
import { DEFAULT_TRAINING_CATALOG_RESOLVER } from '../catalog/contextRegistry'
import type { TrainingCatalogOriginV1 } from '../catalog/types'
import {
  AcceptManualRecalibrationProposalInputV1Schema,
  CreateManualRecalibrationProposalInputV1Schema,
  ManualRecalibrationAcceptanceV1Schema,
  ManualRecalibrationProposalProjectionV1Schema,
  type ManualRecalibrationAcceptanceV1,
  type ManualRecalibrationProposalProjectionV1,
} from '../contracts/manual-recalibration-persistence'
import type { ManualRecalibrationOfferV1, ManualRecalibrationSourceDecisionV1 } from '../contracts/manual-recalibration'
import { ExecutionContextV1Schema, TrainingProgramRevisionV1Schema, TrainingStableIdV1Schema, executionContextsMatch } from '../contracts/program'
import { buildManualRecalibrationOffer, type ManualRecalibrationCatalogRegistryV1 } from '../engine/manualRecalibration'
import { hashCanonicalDecisionIdentity } from '../progression/identity'
import { buildPersistedProgressionProjection } from '../progression/persistedProposal'
import { adaptStrengthSessionEvidence } from '../progression/sessionEvidence'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const proposalLifetimeSchema = z.object({
  proposalId: z.string().uuid(),
  status: z.enum(['active', 'renewed', 'accepted']),
  expiresAt: z.string().datetime({ offset: true }),
}).strict()
const candidateSchema = z.object({
  assignment: z.object({
    id: TrainingStableIdV1Schema,
    subjectId: TrainingStableIdV1Schema,
    programMode: z.enum(['self_directed', 'coach_assigned']),
    owningPractitionerId: z.string().uuid().nullable(),
    simulationRunId: z.string().uuid().nullable(),
    activeRevision: revisionSchema,
    revision: revisionSchema,
  }).passthrough(),
  program: TrainingProgramRevisionV1Schema,
  programHash: z.string().regex(/^[a-f0-9]{64}$/),
  currentProfileRevision: revisionSchema,
  profileRevision: revisionSchema,
  profile: z.unknown(),
  eligibility: z.unknown(),
  progressionSeriesId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  evidence: z.array(z.unknown()).min(1).max(64),
  targets: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    sessionRevision: revisionSchema,
    exerciseInstanceId: TrainingStableIdV1Schema,
    scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict()).min(1).max(64),
  sourceSessionRevision: revisionSchema,
  sourceSessionState: z.enum(['completed', 'completed_with_omissions']),
}).passthrough()
type Candidate = z.infer<typeof candidateSchema>

export interface ManualRecalibrationRegistryV1 {
  readonly catalog: ManualRecalibrationCatalogRegistryV1
  readonly bodyweightAssistancePolicy: { readonly resolve: typeof resolveSyntheticBodyweightAssistancePolicy }
}

export const DEFAULT_MANUAL_RECALIBRATION_REGISTRY: ManualRecalibrationRegistryV1 = Object.freeze({
  catalog: DEFAULT_TRAINING_CATALOG_RESOLVER,
  bodyweightAssistancePolicy: { resolve: resolveSyntheticBodyweightAssistancePolicy },
})

export interface StoredManualRecalibrationProposalV1 {
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
  readonly sourceSessionRevisions: readonly { readonly sessionId: string; readonly revision: number }[]
  readonly sourceProfileRevision: number
  readonly sourceEligibilityRevisionId: string
  readonly sourceProgramHash: string
  readonly executionContext: z.infer<typeof ExecutionContextV1Schema>
  readonly catalogVersion: string
  readonly catalogOrigin: TrainingCatalogOriginV1
  readonly targetBindings: readonly Candidate['targets'][number][]
  readonly offer: Extract<ManualRecalibrationOfferV1, { kind: 'options' }>
  readonly createdAt: string
  readonly expiresAt: string
}

export interface ManualRecalibrationDependencies {
  readonly now: () => Date
  readonly newId?: () => string
  readonly loadCandidate: (sessionId: string, exerciseInstanceId: string) => Promise<unknown | null>
  readonly insertProposal: (proposal: StoredManualRecalibrationProposalV1) => Promise<{ readonly id: string }>
  readonly acceptProposal: (
    proposalId: string,
    requestId: string,
    optionIndex: number,
    outlierAcknowledged: boolean,
  ) => Promise<unknown>
}

export type ManualRecalibrationErrorCode =
  | 'manual_recalibration_unavailable'
  | 'manual_recalibration_forbidden'
  | 'manual_recalibration_source_stale'
  | 'manual_recalibration_request_id_conflict'
  | 'manual_recalibration_acknowledgement_required'

export class ManualRecalibrationError extends Error {
  constructor(readonly code: ManualRecalibrationErrorCode) {
    super(code)
    this.name = 'ManualRecalibrationError'
  }
}

function parseCandidate(raw: unknown, actor: AllowedActor): Candidate {
  const parsed = candidateSchema.safeParse(raw)
  if (!parsed.success) throw new ManualRecalibrationError('manual_recalibration_unavailable')
  const candidate = parsed.data
  if (actor.actorKind === 'athlete' && actor.subjectId !== candidate.assignment.subjectId) {
    throw new ManualRecalibrationError('manual_recalibration_forbidden')
  }
  if (actor.actorKind === 'practitioner' && (
    candidate.assignment.programMode !== 'coach_assigned'
    || candidate.assignment.owningPractitionerId !== actor.userId
  )) throw new ManualRecalibrationError('manual_recalibration_forbidden')
  if (candidate.program.assignmentId !== candidate.assignment.id
    || candidate.program.subjectId !== candidate.assignment.subjectId
    || candidate.program.revisionNumber !== candidate.assignment.activeRevision
    || candidate.profileRevision !== candidate.currentProfileRevision
    || candidate.program.profileRevisionId !== String(candidate.profileRevision)
    || candidate.program.eligibilitySourceRevisionId !== (candidate.eligibility as { sourceRevisionId?: unknown }).sourceRevisionId
    || !executionContextsMatch(candidate.program.executionContext, candidate.executionContext)) {
    throw new ManualRecalibrationError('manual_recalibration_source_stale')
  }
  const ordered = [...candidate.targets].sort((left, right) => (
    left.scheduledLocalDate.localeCompare(right.scheduledLocalDate)
    || left.sessionId.localeCompare(right.sessionId)
    || left.exerciseInstanceId.localeCompare(right.exerciseInstanceId)
  ))
  if (hashCanonicalDecisionIdentity(ordered) !== hashCanonicalDecisionIdentity(candidate.targets)) {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  return candidate
}

function sourceDecision(
  candidate: Candidate,
  sessionId: string,
  exerciseInstanceId: string,
  now: Date,
  registry: ManualRecalibrationRegistryV1,
): ManualRecalibrationSourceDecisionV1 {
  const progressionCandidate = {
    assignment: {
      id: candidate.assignment.id,
      subjectId: candidate.assignment.subjectId,
      programMode: candidate.assignment.programMode,
      owningPractitionerId: candidate.assignment.owningPractitionerId,
      simulationRunId: candidate.assignment.simulationRunId,
      activeRevision: candidate.assignment.activeRevision,
      revision: candidate.assignment.revision,
    },
    program: candidate.program,
    programHash: candidate.programHash,
    currentProfileRevision: candidate.currentProfileRevision,
    profileRevision: candidate.profileRevision,
    profile: candidate.profile,
    eligibility: candidate.eligibility,
    progressionSeriesId: candidate.progressionSeriesId,
    evidence: candidate.evidence,
    targets: candidate.targets,
    executionContext: candidate.executionContext,
  }
  const result = buildPersistedProgressionProjection(
    progressionCandidate,
    now,
    registry.bodyweightAssistancePolicy,
  )
  if (result.kind !== 'not_proposed') {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  const generic = 'reasonCodes' in result.decision
  const exactReason = generic
    ? result.decision.reasonCodes.length === 1
      && result.decision.reasonCodes[0] === 'effort_too_easy_recalibration'
    : result.decision.reason === 'effort_too_easy_recalibration'
  if (!exactReason) throw new ManualRecalibrationError('manual_recalibration_unavailable')
  const sourceExposureRevisionIds = generic
    ? result.decision.sourceExposureRevisionIds
    : [result.decision.sourceExposureRevisionId]
  const evidenceBindings = candidate.evidence.map(raw => z.object({
    session: z.object({ sessionId: TrainingStableIdV1Schema, revision: revisionSchema }).passthrough(),
  }).passthrough().safeParse(raw))
  if (evidenceBindings.some(binding => !binding.success)) {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  const latestBinding = evidenceBindings.at(-1)
  if (!latestBinding?.success
    || latestBinding.data.session.sessionId !== sessionId
    || latestBinding.data.session.revision !== candidate.sourceSessionRevision) {
    throw new ManualRecalibrationError('manual_recalibration_source_stale')
  }
  const matching = candidate.evidence.map(raw => adaptStrengthSessionEvidence(raw))
    .filter(item => item.kind === 'ready' && sourceExposureRevisionIds.includes(item.exposure.sourceRevisionId))
  const latest = matching.at(-1)
  if (!latest || latest.kind !== 'ready') {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  const working = latest.exposure.sets.filter(set => set.kind === 'working' && set.actualReps > 0)
  const last = working.at(-1)
  if (!last || working.some(set => (
    set.load.equipmentId !== last.load.equipmentId
    || set.load.basis !== last.load.basis
    || set.load.quantity.entered.unit !== last.load.quantity.entered.unit
    || set.load.quantity.canonicalKg !== last.load.quantity.canonicalKg
  ))) {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  return {
    decisionIdentity: generic
      ? result.decision.decisionKey
      : `${result.decision.schemaVersion}:sha256:${hashCanonicalDecisionIdentity(result.decision)}`,
    reason: 'effort_too_easy_recalibration',
    sourceSessionId: sessionId,
    sourceExerciseInstanceId: exerciseInstanceId,
    sourceSessionRevision: candidate.sourceSessionRevision,
    sourceSessionState: candidate.sourceSessionState,
    sourceExposureRevisionIds: [...sourceExposureRevisionIds],
    lastComparableActualLoad: last.load,
  }
}

function sourceSessionRevisions(candidate: Candidate) {
  const parsed = candidate.evidence.map(raw => z.object({
    session: z.object({ sessionId: TrainingStableIdV1Schema, revision: revisionSchema }).passthrough(),
  }).passthrough().safeParse(raw))
  if (parsed.some(item => !item.success)) throw new ManualRecalibrationError('manual_recalibration_unavailable')
  const sessions = parsed.map(item => item.success && {
    sessionId: item.data.session.sessionId,
    revision: item.data.session.revision,
  })
    .filter((item): item is { sessionId: string; revision: number } => Boolean(item))
  if (new Set(sessions.map(item => item.sessionId)).size !== sessions.length) {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  return sessions
}

export async function createStoredManualRecalibrationProposal(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ManualRecalibrationDependencies,
  registry: ManualRecalibrationRegistryV1 = DEFAULT_MANUAL_RECALIBRATION_REGISTRY,
): Promise<ManualRecalibrationProposalProjectionV1> {
  const input = CreateManualRecalibrationProposalInputV1Schema.parse(rawInput)
  const now = dependencies.now()
  const candidate = parseCandidate(await dependencies.loadCandidate(input.sessionId, input.exerciseInstanceId), actor)
  const decision = sourceDecision(candidate, input.sessionId, input.exerciseInstanceId, now, registry)
  const sourceRevisions = sourceSessionRevisions(candidate)
  const target = candidate.targets[0]
  const offer = buildManualRecalibrationOffer({
    program: candidate.program,
    sourceProgramHash: candidate.programHash,
    currentProfileRevisionId: String(candidate.currentProfileRevision),
    currentProfile: candidate.profile as never,
    currentEligibility: candidate.eligibility as never,
    evaluatedAt: now.toISOString(),
    sourceDecision: decision,
    target: {
      sessionId: target.sessionId,
      exerciseInstanceId: target.exerciseInstanceId,
      sessionState: 'scheduled',
      prescriptionState: 'unprescribed',
    },
    catalogRegistry: registry.catalog,
    bodyweightAssistancePolicyRegistry: registry.bodyweightAssistancePolicy,
  })
  if (offer.kind === 'unavailable') return ManualRecalibrationProposalProjectionV1Schema.parse({
    schemaVersion: 'manual-recalibration-projection.v1', proposalId: null, offer,
  })
  const proposalKey = hashCanonicalDecisionIdentity({
    schemaVersion: 'manual-recalibration-proposal-key.v1',
    assignmentRevision: candidate.assignment.revision,
    sourceSessionId: input.sessionId,
    sourceExerciseInstanceId: input.exerciseInstanceId,
    sourceSessionRevision: candidate.sourceSessionRevision,
    sourceProgramHash: candidate.programHash,
    sourceDecision: decision,
    offer,
    targetBindings: candidate.targets,
  })
  const stored = await dependencies.insertProposal(Object.freeze({
    id: (dependencies.newId ?? randomUUID)(), proposalKey, createdByUserId: actor.userId,
    subjectId: candidate.assignment.subjectId, assignmentId: candidate.assignment.id,
    baseProgramRevisionNumber: candidate.assignment.activeRevision,
    baseAssignmentRevision: candidate.assignment.revision,
    sourceSessionId: input.sessionId, sourceExerciseInstanceId: input.exerciseInstanceId,
    sourceSessionRevision: candidate.sourceSessionRevision,
    sourceSessionRevisions: sourceRevisions,
    sourceProfileRevision: candidate.currentProfileRevision,
    sourceEligibilityRevisionId: String((candidate.eligibility as { sourceRevisionId: unknown }).sourceRevisionId),
    sourceProgramHash: candidate.programHash, executionContext: candidate.executionContext,
    catalogVersion: candidate.program.catalogVersion, catalogOrigin: candidate.program.catalogOrigin,
    targetBindings: candidate.targets, offer,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
  }))
  return ManualRecalibrationProposalProjectionV1Schema.parse({
    schemaVersion: 'manual-recalibration-projection.v1', proposalId: stored.id, offer,
  })
}

export async function acceptStoredManualRecalibrationProposal(
  proposalId: string,
  rawInput: unknown,
  dependencies: ManualRecalibrationDependencies,
): Promise<ManualRecalibrationAcceptanceV1> {
  const id = z.string().uuid().parse(proposalId)
  const input = AcceptManualRecalibrationProposalInputV1Schema.parse(rawInput)
  const parsed = ManualRecalibrationAcceptanceV1Schema.safeParse(await dependencies.acceptProposal(
    id, input.requestId, input.optionIndex, input.outlierAcknowledged,
  ))
  if (!parsed.success || parsed.data.proposalId !== id) {
    throw new ManualRecalibrationError('manual_recalibration_unavailable')
  }
  return parsed.data
}

type RpcClient = Pick<SupabaseClient, 'rpc'>
type InsertClient = Pick<SupabaseClient, 'from'>

export function createSupabaseManualRecalibrationDependencies(
  authenticated: RpcClient,
  service: InsertClient,
  now: () => Date = () => new Date(),
): ManualRecalibrationDependencies {
  return {
    now,
    loadCandidate: async (sessionId, exerciseInstanceId) => {
      const result = await authenticated.rpc('read_training_active_calibration_candidate', {
        p_session_id: sessionId, p_exercise_instance_id: exerciseInstanceId,
      })
      if (result.error) throw new ManualRecalibrationError('manual_recalibration_unavailable')
      return result.data
    },
    insertProposal: async proposal => {
      const row = {
        id: proposal.id, proposal_key: proposal.proposalKey, created_by_user_id: proposal.createdByUserId,
        subject_id: proposal.subjectId, assignment_id: proposal.assignmentId,
        base_program_revision_number: proposal.baseProgramRevisionNumber,
        base_assignment_revision: proposal.baseAssignmentRevision,
        source_session_id: proposal.sourceSessionId,
        source_exercise_instance_id: proposal.sourceExerciseInstanceId,
        source_session_revision: proposal.sourceSessionRevision,
        source_session_revisions: proposal.sourceSessionRevisions,
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        source_program_hash: proposal.sourceProgramHash, execution_context: proposal.executionContext,
        catalog_version: proposal.catalogVersion, catalog_origin: proposal.catalogOrigin,
        target_bindings: proposal.targetBindings, offer_json: proposal.offer,
        created_at: proposal.createdAt, expires_at: proposal.expiresAt,
      }
      const inserted = await service.from('training_manual_recalibration_proposals')
        .insert(row).select('id').single()
      if (!inserted.error && inserted.data && typeof inserted.data.id === 'string') return { id: inserted.data.id }
      if (inserted.error?.code !== '23505') throw new ManualRecalibrationError('manual_recalibration_unavailable')
      const existing = await service.from('training_manual_recalibration_proposals')
        .select('id,proposal_key,subject_id,assignment_id,base_program_revision_number,base_assignment_revision,source_session_id,source_exercise_instance_id,source_session_revision,source_session_revisions,source_profile_revision,source_eligibility_revision_id,source_program_hash,execution_context,catalog_version,catalog_origin,target_bindings,offer_json,expires_at')
        .eq('proposal_key', proposal.proposalKey).single()
      if (existing.error || !existing.data || typeof existing.data.id !== 'string') {
        throw new ManualRecalibrationError('manual_recalibration_unavailable')
      }
      const { id, expires_at: _existingExpiry, ...existingIdentity } = existing.data
      const {
        id: _id, created_by_user_id: _creator, created_at: _createdAt, expires_at: _expiresAt,
        ...attemptedIdentity
      } = row
      void _id; void _creator; void _createdAt; void _expiresAt; void _existingExpiry
      if (hashCanonicalDecisionIdentity(existingIdentity) !== hashCanonicalDecisionIdentity(attemptedIdentity)) {
        throw new ManualRecalibrationError('manual_recalibration_request_id_conflict')
      }
      const renewed = await authenticated.rpc('renew_training_manual_recalibration_proposal', {
        p_proposal_id: id,
      })
      if (renewed.error?.code === '42501') {
        throw new ManualRecalibrationError('manual_recalibration_forbidden')
      }
      if (['PT409', '40001', '40P01'].includes(renewed.error?.code ?? '')) {
        throw new ManualRecalibrationError('manual_recalibration_source_stale')
      }
      const lifetime = proposalLifetimeSchema.safeParse(renewed.data)
      if (renewed.error || !lifetime.success || lifetime.data.proposalId !== id) {
        throw new ManualRecalibrationError('manual_recalibration_unavailable')
      }
      return { id }
    },
    acceptProposal: async (proposalId, requestId, optionIndex, outlierAcknowledged) => {
      const result = await authenticated.rpc('accept_training_manual_recalibration_proposal', {
        p_proposal_id: proposalId, p_request_id: requestId, p_option_index: optionIndex,
        p_outlier_acknowledged: outlierAcknowledged,
      })
      if (!result.error) return result.data
      const message = result.error.message ?? ''
      if (result.error.code === 'PT409' && message.includes('request ID')) {
        throw new ManualRecalibrationError('manual_recalibration_request_id_conflict')
      }
      if (result.error.code === 'PT409' && message.includes('acknowledgement')) {
        throw new ManualRecalibrationError('manual_recalibration_acknowledgement_required')
      }
      if (['PT409', '40001', '40P01'].includes(result.error.code ?? '')) {
        throw new ManualRecalibrationError('manual_recalibration_source_stale')
      }
      if (['42501', 'P0001'].includes(result.error.code ?? '')) {
        throw new ManualRecalibrationError('manual_recalibration_forbidden')
      }
      throw new ManualRecalibrationError('manual_recalibration_unavailable')
    },
  }
}
