import { z } from 'zod'
import {
  ExactLoadQuantityV1Schema,
  TrainingStableIdV1Schema,
} from './program'
import {
  BodyweightAssistancePolicyReferenceV1Schema,
  TrainingCatalogOriginV1Schema,
  TrainingExerciseSwapDifferenceV1Schema,
} from '../catalog/types'

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const loadOptionBase = {
  optionIndex: z.number().int().min(0).max(63),
  equipmentId: TrainingStableIdV1Schema,
  quantity: ExactLoadQuantityV1Schema,
}

export const ExerciseSwapLoadOptionV1Schema = z.discriminatedUnion('loadBasis', [
  z.object({
    ...loadOptionBase,
    loadBasis: z.literal('dumbbell_single_implement'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('two_hands_single_implement'),
  }).strict(),
  z.object({
    ...loadOptionBase,
    loadBasis: z.literal('dumbbell_per_hand'),
    implementCount: z.literal(2),
    holdingConfiguration: z.literal('one_per_hand'),
  }).strict(),
  z.object({
    ...loadOptionBase,
    loadBasis: z.literal('barbell_total'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('both_hands_barbell'),
  }).strict(),
  z.object({
    ...loadOptionBase,
    loadBasis: z.literal('machine_stack'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('machine_defined'),
  }).strict(),
  z.object({
    ...loadOptionBase,
    loadBasis: z.literal('bodyweight_external'),
    implementCount: z.literal(0),
    holdingConfiguration: z.literal('bodyweight_plus_external_load'),
    bodyweightAssistancePolicy: BodyweightAssistancePolicyReferenceV1Schema,
  }).strict(),
  z.object({
    ...loadOptionBase,
    loadBasis: z.literal('machine_assistance'),
    implementCount: z.literal(1),
    holdingConfiguration: z.literal('machine_assistance'),
    bodyweightAssistancePolicy: BodyweightAssistancePolicyReferenceV1Schema,
  }).strict(),
])

export const ExerciseSwapProposalV1Schema = z.object({
  schemaVersion: z.literal('training-exercise-swap-proposal.v1'),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  baseProgramRevisionNumber: revisionSchema,
  sourceExercise: z.object({
    exerciseVersionId: TrainingStableIdV1Schema,
    label: z.string().trim().min(1).max(160),
  }).strict(),
  replacementExercise: z.object({
    exerciseVersionId: TrainingStableIdV1Schema,
    label: z.string().trim().min(1).max(160),
    trainingIntentId: TrainingStableIdV1Schema,
    differences: z.array(TrainingExerciseSwapDifferenceV1Schema).min(1).max(4),
    recalibrationRequired: z.literal(true),
  }).strict(),
  loadOptions: z.array(ExerciseSwapLoadOptionV1Schema).min(1).max(64),
  affectedFutureSessions: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    exerciseInstanceId: TrainingStableIdV1Schema,
    scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict()).min(1).max(64),
  catalogVersion: TrainingStableIdV1Schema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
}).strict().superRefine((proposal, ctx) => {
  if (proposal.sourceExercise.exerciseVersionId === proposal.replacementExercise.exerciseVersionId) {
    ctx.addIssue({ code: 'custom', message: 'Replacement must be a different exercise variant', path: ['replacementExercise', 'exerciseVersionId'] })
  }
  proposal.loadOptions.forEach((option, index) => {
    if (option.optionIndex !== index) {
      ctx.addIssue({ code: 'custom', message: 'Load option indexes must be contiguous', path: ['loadOptions', index, 'optionIndex'] })
    }
  })
  const targetKeys = proposal.affectedFutureSessions.map(target => (
    `${target.sessionId}\u0000${target.exerciseInstanceId}`
  ))
  if (new Set(targetKeys).size !== targetKeys.length) {
    ctx.addIssue({ code: 'custom', message: 'Affected future targets must be unique', path: ['affectedFutureSessions'] })
  }
})

export const CreateExerciseSwapProposalsInputV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
}).strict()

export const ExerciseSwapProposalProjectionV1Schema = z.object({
  schemaVersion: z.literal('training-exercise-swap-projection.v1'),
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('proposals'),
      proposals: z.array(ExerciseSwapProposalV1Schema).min(1).max(8),
    }).strict(),
    z.object({
      kind: z.literal('no_reviewed_alternative'),
      proposals: z.tuple([]),
    }).strict(),
    z.object({
      kind: z.literal('no_future_target'),
      proposals: z.tuple([]),
    }).strict(),
  ]),
}).strict()

export const AcceptExerciseSwapProposalInputV1Schema = z.object({
  requestId: z.string().uuid(),
  selectedLoadOptionIndex: z.number().int().min(0).max(63),
}).strict()

export const ExerciseSwapAcceptanceV1Schema = z.object({
  schemaVersion: z.literal('training-exercise-swap-acceptance.v1'),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: revisionSchema,
  replacementExerciseVersionId: TrainingStableIdV1Schema,
  selectedLoad: ExerciseSwapLoadOptionV1Schema,
  affectedSessionIds: z.array(TrainingStableIdV1Schema).min(1).max(64),
  recalibration: z.object({
    required: z.literal(true),
    reason: z.literal('exercise_variant_changed'),
    loadDisposition: z.literal('starting_target_to_confirm'),
  }).strict(),
}).strict()

export type ExerciseSwapLoadOptionV1 = z.infer<typeof ExerciseSwapLoadOptionV1Schema>
export type ExerciseSwapProposalV1 = z.infer<typeof ExerciseSwapProposalV1Schema>
export type ExerciseSwapProposalProjectionV1 = z.infer<typeof ExerciseSwapProposalProjectionV1Schema>
export type ExerciseSwapAcceptanceV1 = z.infer<typeof ExerciseSwapAcceptanceV1Schema>
