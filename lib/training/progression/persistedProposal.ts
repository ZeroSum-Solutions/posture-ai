import { z } from 'zod'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import { EligibilitySnapshotV1Schema } from '../contracts/eligibility'
import {
  ExecutionContextV1Schema,
  TrainingProgramRevisionV1Schema,
  TrainingStableIdV1Schema,
  executionContextsMatch,
  type ProgramExercisePrescriptionV1,
  type TrainingProgramRevisionV1,
} from '../contracts/program'
import { ProgressionProposalV1Schema, type ProgressionTargetV1 } from '../contracts/progression'
import { decideStrengthProgression } from './decision'
import { hashCanonicalDecisionIdentity } from './identity'
import {
  adaptStrengthSessionEvidence,
  buildProgressionReadySessionEvidence,
  type SessionEvidenceUnavailableV1,
} from './sessionEvidence'

const candidateSchema = z.object({
  assignment: z.object({
    id: TrainingStableIdV1Schema,
    subjectId: TrainingStableIdV1Schema,
    programMode: z.enum(['self_directed', 'coach_assigned']),
    owningPractitionerId: TrainingStableIdV1Schema.nullable(),
    simulationRunId: z.string().uuid().nullable(),
    activeRevision: z.number().int().positive(),
    revision: z.number().int().positive(),
  }).strict(),
  program: TrainingProgramRevisionV1Schema,
  programHash: z.string().regex(/^[a-f0-9]{64}$/),
  currentProfileRevision: z.number().int().positive(),
  profileRevision: z.number().int().positive(),
  profile: AthleteTrainingProfileV1Schema,
  eligibility: EligibilitySnapshotV1Schema,
  progressionSeriesId: TrainingStableIdV1Schema,
  evidence: z.array(z.unknown()).min(1).max(64),
  targets: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    sessionRevision: z.number().int().positive(),
    exerciseInstanceId: TrainingStableIdV1Schema,
    scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict()).max(64),
  executionContext: ExecutionContextV1Schema,
}).strict()

export type PersistedProgressionCandidateV1 = z.infer<typeof candidateSchema>

export interface ProgressionProposalSourceBindingsV1 {
  readonly subjectId: string
  readonly assignmentRevision: number
  readonly programHash: string
  readonly profileRevision: number
  readonly eligibilitySourceRevisionId: string
  readonly progressionSeriesId: string
  readonly executionContext: z.infer<typeof ExecutionContextV1Schema>
  readonly sourceSessions: readonly { readonly sessionId: string; readonly revision: number }[]
  readonly mutableTargets: readonly PersistedProgressionCandidateV1['targets'][number][]
}

export type ProgressionProjectionDraftV1 =
  | { readonly kind: 'proposal'; readonly proposalKey: string; readonly target: ProgressionTargetV1; readonly decision: z.infer<typeof ProgressionProposalV1Schema>; readonly sourceBindings: ProgressionProposalSourceBindingsV1 }
  | { readonly kind: 'not_proposed'; readonly target: ProgressionTargetV1; readonly decision: ReturnType<typeof decideStrengthProgression> }
  | { readonly kind: 'no_pending_target'; readonly reason: 'no_pending_strength_target' }
  | { readonly kind: 'profile_stale' }
  | { readonly kind: 'evidence_unavailable'; readonly reason: SessionEvidenceUnavailableV1['reason']; readonly missingFields: readonly string[] }
  | { readonly kind: 'invalid_projection' }

function targetPrescription(exercise: ProgramExercisePrescriptionV1, sessionId: string) {
  const progression = exercise.progression
  if (!progression) return null
  return {
    prescriptionId: `${sessionId}:${exercise.exerciseInstanceId}`,
    prescribedLoad: {
      equipmentId: exercise.acceptedInitialLoad.equipmentId,
      basis: exercise.acceptedInitialLoad.loadBasis,
      quantity: exercise.acceptedInitialLoad.quantity,
    },
    exerciseVersionId: exercise.exerciseVersionId,
    equipmentId: exercise.acceptedInitialLoad.equipmentId,
    loadBasis: exercise.acceptedInitialLoad.loadBasis,
    side: progression.side,
    rom: progression.rom,
    tempo: progression.tempo,
    prescribedWorkingSets: exercise.setIds.length,
    repRange: { min: exercise.repRange.minimum, max: exercise.repRange.maximum },
    targetRir: { min: exercise.targetRir.minimum, max: exercise.targetRir.maximum },
    exposureType: progression.exposureType,
    loadEpoch: progression.loadEpoch,
  }
}

function findExercise(program: TrainingProgramRevisionV1, sessionId: string, exerciseInstanceId: string) {
  return program.sessions.find(session => session.sessionId === sessionId)?.exercises
    .find(exercise => exercise.exerciseInstanceId === exerciseInstanceId)
}

function sameTargetReps(left: readonly number[] | undefined, right: readonly number[]): boolean {
  return left !== undefined
    && left.length === right.length
    && left.every((reps, index) => reps === right[index])
}

function sameComparator(left: ProgramExercisePrescriptionV1, right: ProgramExercisePrescriptionV1): boolean {
  return left.exerciseVersionId === right.exerciseVersionId
    && left.acceptedInitialLoad.equipmentId === right.acceptedInitialLoad.equipmentId
    && left.acceptedInitialLoad.loadBasis === right.acceptedInitialLoad.loadBasis
    && left.progression?.progressionSeriesId === right.progression?.progressionSeriesId
    && left.progression?.side === right.progression?.side
    && left.progression?.rom === right.progression?.rom
    && left.progression?.tempo === right.progression?.tempo
    && left.progression?.exposureType === right.progression?.exposureType
    && left.progression?.loadEpoch === right.progression?.loadEpoch
    && left.setIds.length === right.setIds.length
    && left.repRange.minimum === right.repRange.minimum
    && left.repRange.maximum === right.repRange.maximum
    && left.targetRir.minimum === right.targetRir.minimum
    && left.targetRir.maximum === right.targetRir.maximum
}

export function proposalPersistenceKey(input: {
  readonly decisionKey: string
  readonly assignmentId: string
  readonly baseProgramRevisionNumber: number
  readonly targetSessionId: string
  readonly targetExerciseInstanceId: string
  readonly targetSessionRevision: number
  readonly assignmentRevision: number
  readonly programHash: string
  readonly sourceSessions: readonly { readonly sessionId: string; readonly revision: number }[]
  readonly executionContext: z.infer<typeof ExecutionContextV1Schema>
}): string {
  return hashCanonicalDecisionIdentity(input)
}

export function applyAcceptedProgressionProposal(input: {
  readonly activeProgram: TrainingProgramRevisionV1
  readonly proposalId: string
  readonly decision: z.infer<typeof ProgressionProposalV1Schema>
  readonly target: ProgressionTargetV1
  readonly mutableTargets: readonly PersistedProgressionCandidateV1['targets'][number][]
  readonly actorUserId: string
  readonly acceptedAt: string
}): TrainingProgramRevisionV1 {
  const target = findExercise(input.activeProgram, input.target.sessionId, input.target.exerciseInstanceId)
  if (!target?.progression || input.decision.proposal.targetReps.length !== target.setIds.length) {
    throw new Error('Invalid progression target')
  }
  const mutable = new Set(input.mutableTargets.map(item => `${item.sessionId}:${item.exerciseInstanceId}`))
  const nextEpoch = input.decision.kind === 'load_proposal'
    ? target.progression.loadEpoch + 1
    : target.progression.loadEpoch
  const sessions = input.activeProgram.sessions.map(session => ({
    ...session,
    exercises: session.exercises.map(exercise => {
      if (!mutable.has(`${session.sessionId}:${exercise.exerciseInstanceId}`)
        || !sameComparator(target, exercise)) return exercise
      return {
        ...exercise,
        targetReps: [...input.decision.proposal.targetReps],
        progression: { ...exercise.progression!, loadEpoch: nextEpoch },
        acceptedInitialLoad: input.decision.kind === 'load_proposal' ? {
          ...exercise.acceptedInitialLoad,
          acceptanceId: `progression:${input.proposalId}`,
          acceptedAt: input.acceptedAt,
          acceptedByUserId: input.actorUserId,
          quantity: input.decision.proposal.load.quantity,
        } : exercise.acceptedInitialLoad,
      }
    }),
  }))
  return TrainingProgramRevisionV1Schema.parse({
    ...input.activeProgram,
    revisionNumber: input.activeProgram.revisionNumber + 1,
    publishedAt: input.acceptedAt,
    author: {
      kind: input.activeProgram.programMode === 'self_directed' ? 'athlete' : 'coach',
      userId: input.actorUserId,
    },
    sessions,
  })
}

export function buildPersistedProgressionProjection(raw: unknown, now: Date): ProgressionProjectionDraftV1 {
  const parsed = candidateSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'invalid_projection' }
  const candidate = parsed.data
  if (candidate.currentProfileRevision !== candidate.profileRevision
    || String(candidate.profileRevision) !== candidate.program.profileRevisionId) return { kind: 'profile_stale' }
  if (candidate.assignment.id !== candidate.program.assignmentId
    || candidate.assignment.subjectId !== candidate.program.subjectId
    || candidate.assignment.activeRevision !== candidate.program.revisionNumber
    || !executionContextsMatch(candidate.executionContext, candidate.program.executionContext)) {
    return { kind: 'invalid_projection' }
  }
  const targetRow = candidate.targets[0]
  if (!targetRow) return { kind: 'no_pending_target', reason: 'no_pending_strength_target' }
  const exercise = findExercise(candidate.program, targetRow.sessionId, targetRow.exerciseInstanceId)
  const prescription = exercise && targetPrescription(exercise, targetRow.sessionId)
  const inventory = exercise && candidate.profile.equipmentInventory.find(item => (
    item.equipmentId === exercise.acceptedInitialLoad.equipmentId
  ))
  if (!exercise || !prescription || !inventory
    || exercise.progression?.progressionSeriesId !== candidate.progressionSeriesId) {
    return { kind: 'invalid_projection' }
  }
  const ready = []
  const sourceSessions: { sessionId: string; revision: number }[] = []
  for (const rawEvidence of candidate.evidence) {
    const result = adaptStrengthSessionEvidence(rawEvidence)
    if (result.kind !== 'ready') return {
      kind: 'evidence_unavailable', reason: result.reason, missingFields: result.missingFields,
    }
    ready.push(result)
    const source = z.object({ session: z.object({
      sessionId: TrainingStableIdV1Schema,
      revision: z.number().int().positive(),
    }).passthrough() }).passthrough().safeParse(rawEvidence)
    if (!source.success) return { kind: 'invalid_projection' }
    sourceSessions.push(source.data.session)
  }
  const bundle = buildProgressionReadySessionEvidence(ready[ready.length - 1], ready)
  const decision = decideStrengthProgression({
    policyVersion: 'strength-progression-v1', now: now.toISOString(),
    executionContext: candidate.executionContext,
    subjectId: candidate.program.subjectId,
    sourceProfileRevisionId: candidate.program.profileRevisionId,
    programRevisionId: candidate.program.compiledProgramRevisionId,
    eligibility: candidate.eligibility,
    prescription,
    equipmentInventory: inventory,
    exposures: bundle.exposures,
  })
  const target: ProgressionTargetV1 = {
    assignmentId: candidate.assignment.id,
    baseProgramRevisionNumber: candidate.assignment.activeRevision,
    sessionId: targetRow.sessionId,
    exerciseInstanceId: targetRow.exerciseInstanceId,
    scheduledLocalDate: targetRow.scheduledLocalDate,
  }
  if (decision.status !== 'proposed') return { kind: 'not_proposed', target, decision }
  if (decision.kind === 'rep_proposal' && sameTargetReps(exercise.targetReps, decision.proposal.targetReps)) {
    return { kind: 'no_pending_target', reason: 'no_pending_strength_target' }
  }
  const validatedDecision = ProgressionProposalV1Schema.parse(decision)
  const proposalKey = proposalPersistenceKey({
    decisionKey: decision.decisionKey, assignmentId: candidate.assignment.id,
    baseProgramRevisionNumber: candidate.assignment.activeRevision,
    targetSessionId: target.sessionId, targetExerciseInstanceId: target.exerciseInstanceId,
    targetSessionRevision: targetRow.sessionRevision,
    assignmentRevision: candidate.assignment.revision,
    programHash: candidate.programHash,
    sourceSessions,
    executionContext: candidate.executionContext,
  })
  return {
    kind: 'proposal', proposalKey, target, decision: validatedDecision,
    sourceBindings: {
      subjectId: candidate.assignment.subjectId,
      assignmentRevision: candidate.assignment.revision,
      programHash: candidate.programHash,
      profileRevision: candidate.profileRevision,
      eligibilitySourceRevisionId: candidate.eligibility.sourceRevisionId,
      progressionSeriesId: candidate.progressionSeriesId,
      executionContext: candidate.executionContext,
      sourceSessions,
      mutableTargets: candidate.targets,
    },
  }
}
