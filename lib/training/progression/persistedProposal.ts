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
import {
  BodyweightAssistanceProgressionDecisionV1Schema,
  type BodyweightAssistanceBenchmarkV1,
  type BodyweightAssistanceExposureV1,
  type BodyweightAssistanceLoadV1,
  type BodyweightAssistancePolicyRegistryV1,
  type BodyweightAssistanceProgressionDecisionV1,
} from '../contracts/bodyweight-assistance'
import { resolveSyntheticBodyweightAssistancePolicy } from '../catalog/syntheticRegistry'
import { buildBodyweightAssistanceProgression } from '../engine/bodyweightAssistanceProgression'
import { decideStrengthProgression } from './decision'
import { hashCanonicalDecisionIdentity } from './identity'
import {
  adaptStrengthSessionEvidence,
  buildProgressionReadySessionEvidence,
  type SessionEvidenceUnavailableV1,
} from './sessionEvidence'
import type { StrengthPrescriptionV1 } from './types'

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

export type PersistedProgressionProposalDecisionV1 =
  | z.infer<typeof ProgressionProposalV1Schema>
  | Extract<BodyweightAssistanceProgressionDecisionV1, { status: 'proposed' }>

export type PersistedProgressionNoChangeDecisionV1 =
  | Exclude<ReturnType<typeof decideStrengthProgression>, { status: 'proposed' }>
  | Extract<BodyweightAssistanceProgressionDecisionV1, { status: 'not_proposed' }>

function isBodyweightAssistanceDecision(
  decision: ReturnType<typeof decideStrengthProgression> | BodyweightAssistanceProgressionDecisionV1,
): decision is BodyweightAssistanceProgressionDecisionV1 {
  return 'schemaVersion' in decision
    && decision.schemaVersion === 'bodyweight-assistance-progression-decision.v1'
}

export type ProgressionProjectionDraftV1 =
  | { readonly kind: 'proposal'; readonly proposalKey: string; readonly target: ProgressionTargetV1; readonly decision: PersistedProgressionProposalDecisionV1; readonly sourceBindings: ProgressionProposalSourceBindingsV1 }
  | { readonly kind: 'not_proposed'; readonly target: ProgressionTargetV1; readonly decision: PersistedProgressionNoChangeDecisionV1; readonly executionContext: z.infer<typeof ExecutionContextV1Schema> }
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
    ...(exercise.acceptedInitialLoad.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: exercise.acceptedInitialLoad.bodyweightAssistancePolicy }
      : {}),
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
    && left.acceptedInitialLoad.bodyweightAssistancePolicy?.policyId
      === right.acceptedInitialLoad.bodyweightAssistancePolicy?.policyId
    && left.acceptedInitialLoad.bodyweightAssistancePolicy?.policyVersion
      === right.acceptedInitialLoad.bodyweightAssistancePolicy?.policyVersion
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
  readonly decision: PersistedProgressionProposalDecisionV1
  readonly target: ProgressionTargetV1
  readonly mutableTargets: readonly PersistedProgressionCandidateV1['targets'][number][]
  readonly actorUserId: string
  readonly acceptedAt: string
}): TrainingProgramRevisionV1 {
  const target = findExercise(input.activeProgram, input.target.sessionId, input.target.exerciseInstanceId)
  const targetReps = isBodyweightAssistanceDecision(input.decision)
    ? input.decision.targetReps
    : input.decision.proposal.targetReps
  if (!target?.progression || targetReps.length !== target.setIds.length) {
    throw new Error('Invalid progression target')
  }
  if (isBodyweightAssistanceDecision(input.decision)) {
    const reference = target.acceptedInitialLoad.bodyweightAssistancePolicy
    const targetLoad = toDedicatedLoad(target.acceptedInitialLoad)
    if (!reference || !targetLoad
      || reference.policyId !== input.decision.policyId
      || reference.policyVersion !== input.decision.policyVersion
      || JSON.stringify(targetLoad) !== JSON.stringify(input.decision.preservedLoad)) {
      throw new Error('Invalid bodyweight or assistance progression target')
    }
  }
  const mutable = new Set(input.mutableTargets.map(item => `${item.sessionId}:${item.exerciseInstanceId}`))
  const nextEpoch = !isBodyweightAssistanceDecision(input.decision)
    && input.decision.kind === 'load_proposal'
    ? target.progression.loadEpoch + 1
    : target.progression.loadEpoch
  const sessions = input.activeProgram.sessions.map(session => ({
    ...session,
    exercises: session.exercises.map(exercise => {
      if (!mutable.has(`${session.sessionId}:${exercise.exerciseInstanceId}`)
        || !sameComparator(target, exercise)) return exercise
      return {
        ...exercise,
        targetReps: [...targetReps],
        progression: { ...exercise.progression!, loadEpoch: nextEpoch },
        acceptedInitialLoad: !isBodyweightAssistanceDecision(input.decision)
          && input.decision.kind === 'load_proposal' ? {
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

function toDedicatedLoad(load: ProgramExercisePrescriptionV1['acceptedInitialLoad']): BodyweightAssistanceLoadV1 | null {
  if (load.loadBasis === 'bodyweight_external') return {
    loadBasis: load.loadBasis, equipmentId: load.equipmentId, externalLoad: load.quantity,
  }
  if (load.loadBasis === 'machine_assistance') return {
    loadBasis: load.loadBasis, equipmentId: load.equipmentId, assistance: load.quantity,
  }
  return null
}

function toDedicatedBenchmark(
  prescription: StrengthPrescriptionV1,
): BodyweightAssistanceBenchmarkV1 | null {
  const policy = prescription.bodyweightAssistancePolicy
  if (!policy || (prescription.loadBasis !== 'bodyweight_external'
    && prescription.loadBasis !== 'machine_assistance')) return null
  return {
    exerciseVersionId: prescription.exerciseVersionId,
    equipmentId: prescription.equipmentId,
    loadBasis: prescription.loadBasis,
    side: prescription.side === 'left' || prescription.side === 'right'
      || prescription.side === 'bilateral' || prescription.side === 'not_applicable'
      ? prescription.side
      : 'not_applicable',
    rom: prescription.rom,
    tempo: prescription.tempo,
    exposureType: prescription.exposureType,
    workingSetCount: prescription.prescribedWorkingSets,
    repRange: { minimum: prescription.repRange.min, maximum: prescription.repRange.max },
    targetRir: { minimum: prescription.targetRir.min, maximum: prescription.targetRir.max },
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
  }
}

function toDedicatedExposure(
  exposure: ReturnType<typeof buildProgressionReadySessionEvidence>['exposures'][number],
): BodyweightAssistanceExposureV1 | null {
  const benchmark = toDedicatedBenchmark({
    ...exposure.comparator,
    prescriptionId: exposure.acceptedPrescription.sourceRevisionId,
    prescribedLoad: exposure.acceptedPrescription.load,
  })
  if (!benchmark) return null
  const sets = exposure.sets.filter(set => set.kind === 'working').map(set => {
    const load = set.load.basis === 'bodyweight_external'
      ? { loadBasis: set.load.basis, equipmentId: set.load.equipmentId, externalLoad: set.load.quantity } as const
      : set.load.basis === 'machine_assistance'
        ? { loadBasis: set.load.basis, equipmentId: set.load.equipmentId, assistance: set.load.quantity } as const
        : null
    return load && {
      setOrdinal: set.ordinal, load, reps: set.actualReps, rir: set.actualRir,
      symptomState: set.symptom === 'adverse' ? 'adverse_reported' as const : 'none' as const,
    }
  })
  if (sets.some(set => set === null)) return null
  return {
    sourceExposureRevisionId: exposure.sourceRevisionId,
    isComplete: (exposure.sessionState === 'completed'
      || exposure.sessionState === 'completed_with_omissions')
      && exposure.exerciseState === 'completed'
      && exposure.syncState === 'acknowledged',
    benchmark,
    sets: sets as BodyweightAssistanceExposureV1['sets'],
  }
}

function dedicatedPolicyRegistry(
  supplied?: BodyweightAssistancePolicyRegistryV1,
): BodyweightAssistancePolicyRegistryV1 {
  return {
    resolve: (reference, context) => context.kind === 'synthetic_simulation'
      ? resolveSyntheticBodyweightAssistancePolicy(reference, context)
      : supplied?.resolve(reference, context) ?? null,
  }
}

export function buildPersistedProgressionProjection(
  raw: unknown,
  now: Date,
  bodyweightAssistancePolicyRegistry?: BodyweightAssistancePolicyRegistryV1,
): ProgressionProjectionDraftV1 {
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
  const genericDecision = decideStrengthProgression({
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
  let decision: ReturnType<typeof decideStrengthProgression> | BodyweightAssistanceProgressionDecisionV1 = genericDecision
  if ((prescription.loadBasis === 'bodyweight_external'
    || prescription.loadBasis === 'machine_assistance')
    && genericDecision.status === 'not_proposed'
    && genericDecision.reasonCodes.length === 1
    && genericDecision.reasonCodes[0] === 'valid_state_hold') {
    const latestExposure = bundle.exposures.at(-1)
    const policyReference = prescription.bodyweightAssistancePolicy
    const benchmark = toDedicatedBenchmark(prescription)
    const currentLoad = toDedicatedLoad(exercise.acceptedInitialLoad)
    const dedicatedExposure = latestExposure && toDedicatedExposure(latestExposure)
    if (!policyReference || !benchmark || !currentLoad || !dedicatedExposure) {
      return { kind: 'invalid_projection' }
    }
    decision = buildBodyweightAssistanceProgression({
      executionContext: candidate.executionContext,
      policyReference,
      benchmark,
      currentTarget: {
        load: currentLoad,
        targetReps: exercise.targetReps
          ?? dedicatedExposure.sets.map(set => set.reps),
      },
      latestExposure: dedicatedExposure,
      registry: dedicatedPolicyRegistry(bodyweightAssistancePolicyRegistry),
    })
  }
  if (decision.status !== 'proposed') return {
    kind: 'not_proposed', target, decision, executionContext: candidate.executionContext,
  }
  const targetReps = isBodyweightAssistanceDecision(decision)
    ? decision.targetReps
    : decision.proposal.targetReps
  if (decision.kind === 'rep_proposal' && sameTargetReps(exercise.targetReps, targetReps)) {
    return { kind: 'no_pending_target', reason: 'no_pending_strength_target' }
  }
  const validatedDecision: PersistedProgressionProposalDecisionV1 =
    isBodyweightAssistanceDecision(decision)
      ? BodyweightAssistanceProgressionDecisionV1Schema.parse(decision) as Extract<BodyweightAssistanceProgressionDecisionV1, { status: 'proposed' }>
      : ProgressionProposalV1Schema.parse(decision)
  const decisionKey = isBodyweightAssistanceDecision(decision)
    ? `${decision.schemaVersion}:sha256:${hashCanonicalDecisionIdentity({
        decision,
        executionContext: candidate.executionContext,
        subjectId: candidate.assignment.subjectId,
        programRevisionId: candidate.program.compiledProgramRevisionId,
      })}`
    : decision.decisionKey
  const proposalKey = proposalPersistenceKey({
    decisionKey, assignmentId: candidate.assignment.id,
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
