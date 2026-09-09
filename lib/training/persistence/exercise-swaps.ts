import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TRAINING_CATALOG_RESOLVER } from '../catalog/contextRegistry'
import { resolveSyntheticBodyweightAssistancePolicy } from '../catalog/syntheticRegistry'
import { resolveExerciseSwapAlternatives } from '../catalog/exerciseSwaps'
import {
  TrainingCatalogV1Schema,
  type TrainingCatalogOriginV1,
  type TrainingCatalogV1,
} from '../catalog/types'
import {
  AcceptExerciseSwapProposalInputV1Schema,
  CreateExerciseSwapProposalsInputV1Schema,
  ExerciseSwapAcceptanceV1Schema,
  ExerciseSwapProposalProjectionV1Schema,
  ExerciseSwapProposalV1Schema,
  type ExerciseSwapAcceptanceV1,
  type ExerciseSwapProposalProjectionV1,
  type ExerciseSwapProposalV1,
} from '../contracts/exercise-swap'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import type { BodyweightAssistancePolicyRegistryV1 } from '../contracts/bodyweight-assistance'
import {
  ProgramExercisePrescriptionV1Schema,
  TrainingProgramRevisionV1Schema,
  catalogOriginsMatch,
  type ExecutionContextV1,
} from '../contracts/program'
import type { TrainingServerActor } from '../access/server-actor'
import { hashCanonicalDecisionIdentity } from '../progression/identity'
import { createLoadQuantity } from '../quantity'

type AllowedActor = Extract<TrainingServerActor, { ok: true }>
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const targetBindingSchema = z.object({
  sessionId: z.string().min(1).max(128),
  sessionRevision: revisionSchema,
  scheduledLocalDate: localDateSchema,
  exerciseInstanceId: z.string().min(1).max(128),
  sourceExercise: ProgramExercisePrescriptionV1Schema,
}).strict()

const candidateSchema = z.object({
  schemaVersion: z.literal('training-exercise-swap-candidate.v1'),
  status: z.literal('ready'),
  assignmentId: z.string().min(1).max(128),
  assignmentRevision: revisionSchema,
  baseProgramRevisionNumber: revisionSchema,
  subjectId: z.string().uuid(),
  programHash: z.string().regex(/^[a-f0-9]{64}$/),
  program: TrainingProgramRevisionV1Schema,
  profile: AthleteTrainingProfileV1Schema,
  currentProfileRevision: revisionSchema,
  sourceExerciseVersionId: z.string().min(1).max(128),
  sourceExerciseInstanceId: z.string().min(1).max(128),
  targets: z.array(targetBindingSchema).min(1).max(64),
}).strict()
const candidateReadSchema = z.discriminatedUnion('status', [
  candidateSchema,
  z.object({
    schemaVersion: z.literal('training-exercise-swap-candidate.v1'),
    status: z.literal('no_future_target'),
  }).strict(),
])

export interface ExerciseSwapCatalogRegistryV1 {
  resolve(catalogVersion: string, catalogOrigin: TrainingCatalogOriginV1): TrainingCatalogV1 | null
}

export const DEFAULT_EXERCISE_SWAP_CATALOG_REGISTRY: ExerciseSwapCatalogRegistryV1 = Object.freeze({
  resolve: DEFAULT_TRAINING_CATALOG_RESOLVER.resolve,
})

export const DEFAULT_EXERCISE_SWAP_BODYWEIGHT_ASSISTANCE_POLICY_REGISTRY:
BodyweightAssistancePolicyRegistryV1 = Object.freeze({
  resolve: resolveSyntheticBodyweightAssistancePolicy,
})

export interface StoredExerciseSwapProposalV1 {
  id: string
  proposalKey: string
  createdByUserId: string
  subjectId: string
  assignmentId: string
  baseProgramRevisionNumber: number
  baseAssignmentRevision: number
  sourceExerciseVersionId: string
  replacementExerciseVersionId: string
  catalogVersion: string
  catalogOrigin: TrainingCatalogOriginV1
  programHash: string
  sourceProfileRevision: number
  sourceEligibilityRevisionId: string
  executionContext: ExecutionContextV1
  loadOptions: ExerciseSwapProposalV1['loadOptions']
  targetBindings: z.infer<typeof targetBindingSchema>[]
  replacementDefaults: {
    progressionDefaults: NonNullable<TrainingCatalogV1['exercises'][number]['progressionDefaults']>
    warmupSets: readonly {
      targetReps: number
      prescribedLoad: ReturnType<typeof createLoadQuantity>
    }[] | null
  }
  proposal: ExerciseSwapProposalV1
  createdAt: string
  expiresAt: string
}

export interface ExerciseSwapDependencies {
  now(): Date
  newId?(): string
  loadCandidate(sessionId: string, exerciseInstanceId: string): Promise<unknown | null>
  insertProposal(proposal: StoredExerciseSwapProposalV1): Promise<ExerciseSwapProposalV1>
  acceptProposal(proposalId: string, requestId: string, selectedLoadOptionIndex: number): Promise<unknown>
}

export type ExerciseSwapErrorCode =
  | 'exercise_swap_unavailable'
  | 'exercise_swap_forbidden'
  | 'exercise_swap_request_id_conflict'
  | 'exercise_swap_selection_invalid'
  | 'exercise_swap_source_stale'

export class ExerciseSwapError extends Error {
  constructor(readonly code: ExerciseSwapErrorCode) {
    super(code)
    this.name = 'ExerciseSwapError'
  }
}

function assertCatalog(
  registry: ExerciseSwapCatalogRegistryV1,
  catalogVersion: string,
  catalogOrigin: TrainingCatalogOriginV1,
): TrainingCatalogV1 | null {
  const parsed = TrainingCatalogV1Schema.safeParse(registry.resolve(catalogVersion, catalogOrigin))
  return parsed.success
    && parsed.data.catalogVersion === catalogVersion
    && catalogOriginsMatch(parsed.data.origin, catalogOrigin)
    ? parsed.data
    : null
}

export async function createStoredExerciseSwapProposals(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ExerciseSwapDependencies,
  catalogRegistry: ExerciseSwapCatalogRegistryV1 = DEFAULT_EXERCISE_SWAP_CATALOG_REGISTRY,
  bodyweightAssistancePolicyRegistry: BodyweightAssistancePolicyRegistryV1 =
  DEFAULT_EXERCISE_SWAP_BODYWEIGHT_ASSISTANCE_POLICY_REGISTRY,
): Promise<ExerciseSwapProposalProjectionV1> {
  const input = CreateExerciseSwapProposalsInputV1Schema.parse(rawInput)
  const read = candidateReadSchema.safeParse(await dependencies.loadCandidate(
    input.sessionId,
    input.exerciseInstanceId,
  ))
  if (!read.success) throw new ExerciseSwapError('exercise_swap_unavailable')
  if (read.data.status === 'no_future_target') {
    return ExerciseSwapProposalProjectionV1Schema.parse({
      schemaVersion: 'training-exercise-swap-projection.v1',
      result: { kind: 'no_future_target', proposals: [] },
    })
  }
  const candidate = read.data
  if (actor.actorKind === 'athlete' && actor.subjectId !== candidate.subjectId) {
    throw new ExerciseSwapError('exercise_swap_forbidden')
  }
  if (candidate.program.assignmentId !== candidate.assignmentId
    || candidate.program.subjectId !== candidate.subjectId
    || candidate.program.revisionNumber !== candidate.baseProgramRevisionNumber
    || candidate.program.profileRevisionId !== String(candidate.currentProfileRevision)
    || candidate.targets.some(target => (
      target.sourceExercise.exerciseVersionId !== candidate.sourceExerciseVersionId
    ))) {
    throw new ExerciseSwapError('exercise_swap_unavailable')
  }
  const catalog = assertCatalog(
    catalogRegistry,
    candidate.program.catalogVersion,
    candidate.program.catalogOrigin,
  )
  if (!catalog) throw new ExerciseSwapError('exercise_swap_unavailable')
  const alternatives = resolveExerciseSwapAlternatives({
    catalog,
    profile: candidate.profile,
    sourceExerciseVersionId: candidate.sourceExerciseVersionId,
    executionContext: candidate.program.executionContext,
    bodyweightAssistancePolicyRegistry,
  })
  if (alternatives.length === 0) {
    return ExerciseSwapProposalProjectionV1Schema.parse({
      schemaVersion: 'training-exercise-swap-projection.v1',
      result: { kind: 'no_reviewed_alternative', proposals: [] },
    })
  }
  const source = catalog.exercises.find(exercise => (
    exercise.exerciseVersionId === candidate.sourceExerciseVersionId
  ))
  if (!source) throw new ExerciseSwapError('exercise_swap_unavailable')
  const createdAt = dependencies.now()
  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1_000).toISOString()
  const proposals = await Promise.all(alternatives.map(async (alternative) => {
    const id = (dependencies.newId ?? randomUUID)()
    const proposal = ExerciseSwapProposalV1Schema.parse({
      schemaVersion: 'training-exercise-swap-proposal.v1',
      proposalId: id,
      assignmentId: candidate.assignmentId,
      baseProgramRevisionNumber: candidate.baseProgramRevisionNumber,
      sourceExercise: { exerciseVersionId: source.exerciseVersionId, label: source.label },
      replacementExercise: {
        exerciseVersionId: alternative.exercise.exerciseVersionId,
        label: alternative.exercise.label,
        trainingIntentId: alternative.trainingIntentId,
        differences: alternative.differences,
        recalibrationRequired: true,
      },
      loadOptions: alternative.loadOptions,
      affectedFutureSessions: candidate.targets.map(target => ({
        sessionId: target.sessionId,
        exerciseInstanceId: target.exerciseInstanceId,
        scheduledLocalDate: target.scheduledLocalDate,
      })),
      catalogVersion: catalog.catalogVersion,
      catalogOrigin: catalog.origin,
    })
    const proposalKey = hashCanonicalDecisionIdentity({
      schemaVersion: proposal.schemaVersion,
      assignmentRevision: candidate.assignmentRevision,
      programHash: candidate.programHash,
      proposal: { ...proposal, proposalId: null },
      targetBindings: candidate.targets,
    })
    return dependencies.insertProposal({
      id, proposalKey, createdByUserId: actor.userId, subjectId: candidate.subjectId,
      assignmentId: candidate.assignmentId,
      baseProgramRevisionNumber: candidate.baseProgramRevisionNumber,
      baseAssignmentRevision: candidate.assignmentRevision,
      sourceExerciseVersionId: source.exerciseVersionId,
      replacementExerciseVersionId: alternative.exercise.exerciseVersionId,
      catalogVersion: catalog.catalogVersion, catalogOrigin: catalog.origin,
      programHash: candidate.programHash,
      sourceProfileRevision: candidate.currentProfileRevision,
      sourceEligibilityRevisionId: candidate.program.eligibilitySourceRevisionId,
      executionContext: candidate.program.executionContext,
      loadOptions: proposal.loadOptions,
      targetBindings: candidate.targets,
      replacementDefaults: {
        progressionDefaults: alternative.exercise.progressionDefaults!,
        warmupSets: alternative.exercise.warmupSets?.map(warmup => ({
          targetReps: warmup.targetReps,
          prescribedLoad: createLoadQuantity(warmup.load),
        })) ?? null,
      },
      proposal, createdAt: createdAt.toISOString(), expiresAt,
    })
  }))
  return ExerciseSwapProposalProjectionV1Schema.parse({
    schemaVersion: 'training-exercise-swap-projection.v1',
    result: { kind: 'proposals', proposals },
  })
}

export async function acceptStoredExerciseSwapProposal(
  proposalId: string,
  rawInput: unknown,
  dependencies: ExerciseSwapDependencies,
): Promise<ExerciseSwapAcceptanceV1> {
  const id = z.string().uuid().parse(proposalId)
  const input = AcceptExerciseSwapProposalInputV1Schema.parse(rawInput)
  const result = ExerciseSwapAcceptanceV1Schema.safeParse(await dependencies.acceptProposal(
    id,
    input.requestId,
    input.selectedLoadOptionIndex,
  ))
  if (!result.success || result.data.proposalId !== id
    || result.data.selectedLoad.optionIndex !== input.selectedLoadOptionIndex) {
    throw new ExerciseSwapError('exercise_swap_unavailable')
  }
  return result.data
}

type RpcClient = Pick<SupabaseClient, 'rpc'>
type TableClient = Pick<SupabaseClient, 'from'>

export function createSupabaseExerciseSwapDependencies(
  authenticated: RpcClient,
  service: TableClient,
): ExerciseSwapDependencies {
  return {
    now: () => new Date(),
    loadCandidate: async (sessionId, exerciseInstanceId) => {
      const result = await authenticated.rpc('read_training_exercise_swap_candidate', {
        p_session_id: sessionId, p_exercise_instance_id: exerciseInstanceId,
      })
      if (result.error) throw new ExerciseSwapError('exercise_swap_unavailable')
      return result.data
    },
    insertProposal: async (proposal) => {
      const row = {
        id: proposal.id, proposal_key: proposal.proposalKey,
        created_by_user_id: proposal.createdByUserId, subject_id: proposal.subjectId,
        assignment_id: proposal.assignmentId,
        base_program_revision_number: proposal.baseProgramRevisionNumber,
        base_assignment_revision: proposal.baseAssignmentRevision,
        source_exercise_version_id: proposal.sourceExerciseVersionId,
        replacement_exercise_version_id: proposal.replacementExerciseVersionId,
        catalog_version: proposal.catalogVersion, catalog_origin: proposal.catalogOrigin,
        source_program_hash: proposal.programHash,
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        execution_context: proposal.executionContext,
        load_options: proposal.loadOptions,
        target_bindings: proposal.targetBindings,
        replacement_defaults: proposal.replacementDefaults,
        proposal_json: proposal.proposal, created_at: proposal.createdAt, expires_at: proposal.expiresAt,
      }
      const inserted = await service.from('training_exercise_swap_proposals')
        .insert(row).select('proposal_json').single()
      if (!inserted.error) return ExerciseSwapProposalV1Schema.parse(inserted.data?.proposal_json)
      if (inserted.error.code !== '23505') throw new ExerciseSwapError('exercise_swap_unavailable')
      const existing = await service.from('training_exercise_swap_proposals')
        .select('proposal_json').eq('proposal_key', proposal.proposalKey).single()
      if (existing.error) throw new ExerciseSwapError('exercise_swap_unavailable')
      return ExerciseSwapProposalV1Schema.parse(existing.data?.proposal_json)
    },
    acceptProposal: async (proposalId, requestId, selectedLoadOptionIndex) => {
      const result = await authenticated.rpc('accept_training_exercise_swap_proposal', {
        p_proposal_id: proposalId,
        p_request_id: requestId,
        p_selected_load_option_index: selectedLoadOptionIndex,
      })
      if ((result.error?.code === 'PT409' || result.error?.code === '40001')
        && result.error.message.includes('request ID reused with different content')) {
        throw new ExerciseSwapError('exercise_swap_request_id_conflict')
      }
      if (result.error?.code === 'PT409' || result.error?.code === '40001'
        || result.error?.code === '40P01') {
        throw new ExerciseSwapError('exercise_swap_source_stale')
      }
      if (result.error?.code === '42501') {
        throw new ExerciseSwapError('exercise_swap_forbidden')
      }
      if (result.error?.code === '22023') {
        throw new ExerciseSwapError('exercise_swap_selection_invalid')
      }
      if (result.error) throw new ExerciseSwapError('exercise_swap_unavailable')
      return result.data
    },
  }
}
