import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveSyntheticConditioningPairingPolicies,
} from '../catalog/syntheticRegistry'
import { DEFAULT_TRAINING_CATALOG_RESOLVER } from '../catalog/contextRegistry'
import { TrainingCatalogV1Schema, type TrainingCatalogOriginV1, type TrainingCatalogV1 } from '../catalog/types'
import {
  AcceptConditioningRevisionProposalInputV1Schema,
  ConditioningPairingPolicyV1Schema,
  ConditioningRevisionAcceptanceV1Schema,
  ConditioningRevisionOptionsV1Schema,
  ConditioningRevisionProposalProjectionV1Schema,
  CreateConditioningRevisionProposalInputV1Schema,
  type ConditioningPairingPolicyV1,
  type ConditioningRevisionAcceptanceV1,
  type ConditioningRevisionOptionsV1,
  type ConditioningRevisionProposalProjectionV1,
  type ConditioningRevisionResultV1,
  type ConditioningRevisionSelectionV1,
} from '../contracts/conditioning-revision'
import {
  TrainingProgramRevisionV1Schema,
  catalogOriginsMatch,
  type ExecutionContextV1,
} from '../contracts/program'
import type { TrainingServerActor } from '../access/server-actor'
import { buildConditioningRevision } from '../engine/conditioningRevision'
import { hashCanonicalDecisionIdentity } from '../progression/identity'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const candidateReadSchema = z.discriminatedUnion('status', [
  z.object({
    schemaVersion: z.literal('conditioning-revision-candidate.v1'),
    status: z.literal('ready'),
    assignmentId: z.string().min(1).max(128),
    assignmentRevision: revisionSchema,
    subjectId: z.string().uuid(),
    currentLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    programHash: z.string().regex(/^[a-f0-9]{64}$/),
    currentProfileRevision: revisionSchema,
    program: TrainingProgramRevisionV1Schema,
    sessionStates: z.array(z.object({
      sessionId: z.string().min(1).max(128),
      state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
      revision: revisionSchema,
      scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hasPrescription: z.boolean(),
    }).strict()).min(1).max(24),
  }).strict(),
  z.object({
    schemaVersion: z.literal('conditioning-revision-candidate.v1'),
    status: z.literal('no_changeable_bouts'),
  }).strict(),
])

export interface ConditioningRevisionRegistryV1 {
  resolveCatalog(version: string, origin: TrainingCatalogOriginV1): TrainingCatalogV1 | null
  resolvePairingPolicies(context: ExecutionContextV1, catalog: TrainingCatalogV1): readonly ConditioningPairingPolicyV1[]
}

export const DEFAULT_CONDITIONING_REVISION_REGISTRY: ConditioningRevisionRegistryV1 = Object.freeze({
  resolveCatalog: DEFAULT_TRAINING_CATALOG_RESOLVER.resolve,
  resolvePairingPolicies: resolveSyntheticConditioningPairingPolicies,
})

export interface StoredConditioningRevisionProposalV1 {
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
  readonly selection: ConditioningRevisionSelectionV1
  readonly revision: Extract<ConditioningRevisionResultV1['result'], { kind: 'revision_ready' }>
  readonly targetRevisions: readonly {
    readonly sessionId: string
    readonly sessionRevision: number
    readonly scheduledLocalDate: string
  }[]
  readonly createdAt: string
  readonly expiresAt: string
}

export interface ConditioningRevisionDependencies {
  now(): Date
  newId?(): string
  loadCandidate(assignmentId: string): Promise<unknown | null>
  insertProposal(proposal: StoredConditioningRevisionProposalV1): Promise<{ readonly id: string }>
  acceptProposal(proposalId: string, requestId: string): Promise<unknown>
}

export type ConditioningRevisionReadDependencies = Pick<ConditioningRevisionDependencies, 'loadCandidate'>

export type ConditioningRevisionErrorCode =
  | 'conditioning_revision_unavailable'
  | 'conditioning_revision_forbidden'
  | 'conditioning_revision_source_stale'
  | 'conditioning_revision_request_id_conflict'

export class ConditioningRevisionError extends Error {
  constructor(readonly code: ConditioningRevisionErrorCode) {
    super(code)
    this.name = 'ConditioningRevisionError'
  }
}

function parseCandidate(value: unknown, actor: AllowedActor) {
  const candidate = candidateReadSchema.safeParse(value)
  if (!candidate.success) throw new ConditioningRevisionError('conditioning_revision_unavailable')
  if (candidate.data.status === 'ready'
    && actor.actorKind === 'athlete'
    && actor.subjectId !== candidate.data.subjectId) {
    throw new ConditioningRevisionError('conditioning_revision_forbidden')
  }
  return candidate.data
}

function resolveRegistry(
  program: z.infer<typeof TrainingProgramRevisionV1Schema>,
  registry: ConditioningRevisionRegistryV1,
) {
  const raw = registry.resolveCatalog(program.catalogVersion, program.catalogOrigin)
  const catalog = TrainingCatalogV1Schema.safeParse(raw)
  if (!catalog.success || catalog.data.catalogVersion !== program.catalogVersion
    || !catalogOriginsMatch(catalog.data.origin, program.catalogOrigin)) {
    throw new ConditioningRevisionError('conditioning_revision_unavailable')
  }
  const policies = ConditioningPairingPolicyV1Schema.array().max(100).safeParse(
    registry.resolvePairingPolicies(program.executionContext, catalog.data),
  )
  if (!policies.success) throw new ConditioningRevisionError('conditioning_revision_unavailable')
  return { catalog: catalog.data, policies: policies.data }
}

function sourceFor(candidate: Extract<z.infer<typeof candidateReadSchema>, { status: 'ready' }>) {
  const timezones = new Set(candidate.program.conditioningBouts.map(bout => bout.athleteTimezone))
  if (candidate.program.assignmentId !== candidate.assignmentId
    || candidate.program.subjectId !== candidate.subjectId
    || candidate.currentProfileRevision !== Number(candidate.program.profileRevisionId)
    || timezones.size !== 1) {
    throw new ConditioningRevisionError('conditioning_revision_unavailable')
  }
  return {
    schemaVersion: 'conditioning-revision-source.v1',
    assignmentId: candidate.assignmentId,
    subjectId: candidate.subjectId,
    baseProgramRevisionNumber: candidate.program.revisionNumber,
    compiledProgramRevisionId: candidate.program.compiledProgramRevisionId,
    compilerPolicyVersion: candidate.program.compilerPolicyVersion,
    executionContext: candidate.program.executionContext,
    catalogVersion: candidate.program.catalogVersion,
    athleteTimezone: [...timezones][0],
    strengthSessions: candidate.program.sessions.map(session => ({
      sessionId: session.sessionId, scheduledLocalDate: session.scheduledLocalDate,
    })),
    conditioningBouts: candidate.program.conditioningBouts,
  }
}

function currentArrangement(bout: z.infer<typeof TrainingProgramRevisionV1Schema>['conditioningBouts'][number]) {
  return bout.scheduleArrangement?.kind ?? 'separate'
}

export async function readConditioningRevisionOptions(
  assignmentId: string,
  actor: AllowedActor,
  dependencies: ConditioningRevisionReadDependencies,
  registry: ConditioningRevisionRegistryV1 = DEFAULT_CONDITIONING_REVISION_REGISTRY,
): Promise<ConditioningRevisionOptionsV1> {
  const id = z.string().min(1).max(128).parse(assignmentId)
  const candidate = parseCandidate(await dependencies.loadCandidate(id), actor)
  if (candidate.status === 'no_changeable_bouts') {
    return ConditioningRevisionOptionsV1Schema.parse({
      schemaVersion: 'conditioning-revision-options.v1',
      result: { kind: 'unavailable', reason: 'no_changeable_bouts' },
    })
  }
  const { catalog, policies } = resolveRegistry(candidate.program, registry)
  const states = new Map(candidate.sessionStates.map(state => [state.sessionId, state]))
  const changeableBouts = candidate.program.conditioningBouts.filter((bout) => {
    const state = states.get(bout.boutId)
    return state?.state === 'scheduled' && !state.hasPrescription
      && bout.scheduledLocalDate >= candidate.currentLocalDate
  })
  if (changeableBouts.length === 0) {
    return ConditioningRevisionOptionsV1Schema.parse({
      schemaVersion: 'conditioning-revision-options.v1',
      result: { kind: 'unavailable', reason: 'no_changeable_bouts' },
    })
  }
  return ConditioningRevisionOptionsV1Schema.parse({
    schemaVersion: 'conditioning-revision-options.v1',
    result: {
      kind: 'options', assignmentId: candidate.assignmentId, subjectId: candidate.subjectId,
      executionContext: candidate.program.executionContext,
      currentLocalDate: candidate.currentLocalDate,
      athleteTimezone: changeableBouts[0].athleteTimezone,
      changeableBouts: changeableBouts.map(bout => ({
        boutId: bout.boutId, modalityId: bout.modalityId,
        scheduledLocalDate: bout.scheduledLocalDate,
        acceptedDurationSeconds: bout.acceptedDurationSeconds,
        arrangement: currentArrangement(bout),
        ...(bout.progressionIdentity ? { progressionIdentity: bout.progressionIdentity } : {}),
      })),
      modalities: catalog.conditioningModes.filter(mode => (
        mode.lifecycle === 'active'
        && (candidate.program.executionContext.kind === 'live'
          ? mode.contentReviewStatus === 'reviewed'
          : mode.contentReviewStatus === 'reviewed_fixture')
      )).map(mode => ({
        modalityId: mode.modalityId, label: mode.label,
        existingModeDurationMaximumSeconds: 1_800,
        newModeDurationMaximumSeconds: 1_200,
        strengthFirstPairingAvailable: policies.some(policy => (
          policy.modalityId === mode.modalityId
          && policy.pairing === 'moderate_strength_first_allowed'
        )),
      })),
    },
  })
}

export async function createStoredConditioningRevisionProposal(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ConditioningRevisionDependencies,
  registry: ConditioningRevisionRegistryV1 = DEFAULT_CONDITIONING_REVISION_REGISTRY,
): Promise<ConditioningRevisionProposalProjectionV1> {
  const input = CreateConditioningRevisionProposalInputV1Schema.parse(rawInput)
  const candidate = parseCandidate(await dependencies.loadCandidate(input.assignmentId), actor)
  if (candidate.status === 'no_changeable_bouts') {
    return ConditioningRevisionProposalProjectionV1Schema.parse({
      schemaVersion: 'conditioning-revision-projection.v1', proposalId: null,
      revision: { schemaVersion: 'conditioning-revision.v1', result: { kind: 'unavailable', reason: 'no_changeable_bouts' } },
    })
  }
  const { catalog, policies } = resolveRegistry(candidate.program, registry)
  const source = sourceFor(candidate)
  const revision = buildConditioningRevision({
    currentLocalDate: candidate.currentLocalDate, currentPlan: source,
    sessionStates: candidate.sessionStates.map(({ sessionId, state, hasPrescription }) => ({
      sessionId, state, hasPrescription,
    })),
    selection: input.selection, catalog, pairingPolicies: policies,
  })
  if (revision.result.kind !== 'revision_ready') {
    return ConditioningRevisionProposalProjectionV1Schema.parse({
      schemaVersion: 'conditioning-revision-projection.v1', proposalId: null, revision,
    })
  }
  const replacementIds = new Set(revision.result.replacements.map(item => item.sourceBoutId))
  const targetRevisions = candidate.sessionStates.filter(state => replacementIds.has(state.sessionId))
    .map(state => ({
      sessionId: state.sessionId, sessionRevision: state.revision,
      scheduledLocalDate: state.scheduledLocalDate,
    }))
  if (targetRevisions.length !== replacementIds.size
    || candidate.sessionStates.some(state => replacementIds.has(state.sessionId)
      && (state.state !== 'scheduled' || state.hasPrescription))) {
    throw new ConditioningRevisionError('conditioning_revision_source_stale')
  }
  const proposalKey = hashCanonicalDecisionIdentity({
    schemaVersion: 'conditioning-revision-proposal-key.v1',
    assignmentRevision: candidate.assignmentRevision,
    programHash: candidate.programHash,
    selection: input.selection,
    revision: revision.result,
    targetRevisions,
  })
  const now = dependencies.now()
  const stored = await dependencies.insertProposal(Object.freeze({
    id: (dependencies.newId ?? randomUUID)(), proposalKey,
    createdByUserId: actor.userId, subjectId: candidate.subjectId,
    assignmentId: candidate.assignmentId,
    baseProgramRevisionNumber: candidate.program.revisionNumber,
    baseAssignmentRevision: candidate.assignmentRevision,
    sourceProfileRevision: candidate.currentProfileRevision,
    sourceEligibilityRevisionId: candidate.program.eligibilitySourceRevisionId,
    sourceProgramHash: candidate.programHash,
    executionContext: candidate.program.executionContext,
    selection: input.selection, revision: revision.result, targetRevisions,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
  }))
  return ConditioningRevisionProposalProjectionV1Schema.parse({
    schemaVersion: 'conditioning-revision-projection.v1', proposalId: stored.id, revision,
  })
}

export async function acceptStoredConditioningRevisionProposal(
  proposalId: string,
  rawInput: unknown,
  dependencies: ConditioningRevisionDependencies,
): Promise<ConditioningRevisionAcceptanceV1> {
  const id = z.string().uuid().parse(proposalId)
  const input = AcceptConditioningRevisionProposalInputV1Schema.parse(rawInput)
  const result = ConditioningRevisionAcceptanceV1Schema.safeParse(
    await dependencies.acceptProposal(id, input.requestId),
  )
  if (!result.success || result.data.proposalId !== id) {
    throw new ConditioningRevisionError('conditioning_revision_unavailable')
  }
  return result.data
}

type RpcClient = Pick<SupabaseClient, 'rpc'>
type InsertClient = Pick<SupabaseClient, 'from'>

export function createSupabaseConditioningRevisionReadDependencies(
  authenticated: RpcClient,
): ConditioningRevisionReadDependencies {
  return {
    loadCandidate: async (assignmentId) => {
      const result = await authenticated.rpc('read_training_conditioning_revision_candidate', {
        p_assignment_id: assignmentId,
      })
      if (result.error) throw new ConditioningRevisionError('conditioning_revision_unavailable')
      return result.data
    },
  }
}

export function createSupabaseConditioningRevisionDependencies(
  authenticated: RpcClient,
  service: InsertClient,
  now: () => Date = () => new Date(),
): ConditioningRevisionDependencies {
  return {
    now,
    ...createSupabaseConditioningRevisionReadDependencies(authenticated),
    insertProposal: async (proposal) => {
      const row = {
        id: proposal.id, proposal_key: proposal.proposalKey,
        created_by_user_id: proposal.createdByUserId, subject_id: proposal.subjectId,
        assignment_id: proposal.assignmentId,
        base_program_revision_number: proposal.baseProgramRevisionNumber,
        base_assignment_revision: proposal.baseAssignmentRevision,
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        source_program_hash: proposal.sourceProgramHash,
        execution_context: proposal.executionContext,
        selection_json: proposal.selection, revision_json: proposal.revision,
        target_revisions: proposal.targetRevisions,
        created_at: proposal.createdAt, expires_at: proposal.expiresAt,
      }
      const inserted = await service.from('training_conditioning_revision_proposals')
        .insert(row).select('id').single()
      if (!inserted.error && inserted.data && typeof inserted.data.id === 'string') return { id: inserted.data.id }
      if (inserted.error?.code !== '23505') throw new ConditioningRevisionError('conditioning_revision_unavailable')
      const existing = await service.from('training_conditioning_revision_proposals')
        .select('id').eq('proposal_key', proposal.proposalKey).single()
      if (existing.error || !existing.data || typeof existing.data.id !== 'string') {
        throw new ConditioningRevisionError('conditioning_revision_unavailable')
      }
      return { id: existing.data.id }
    },
    acceptProposal: async (proposalId, requestId) => {
      const result = await authenticated.rpc('accept_training_conditioning_revision_proposal', {
        p_proposal_id: proposalId, p_request_id: requestId,
      })
      if (!result.error) return result.data
      const message = result.error.message ?? ''
      if ((result.error.code === 'PT409' || result.error.code === '40001')
        && message.includes('request ID')) {
        throw new ConditioningRevisionError('conditioning_revision_request_id_conflict')
      }
      if (['PT409', '40001', '40P01'].includes(result.error.code ?? '')) {
        throw new ConditioningRevisionError('conditioning_revision_source_stale')
      }
      if (result.error.code === '42501') throw new ConditioningRevisionError('conditioning_revision_forbidden')
      throw new ConditioningRevisionError('conditioning_revision_unavailable')
    },
  }
}
