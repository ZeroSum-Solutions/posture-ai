import { z } from 'zod'
import { compareCanonicalKgDecimals } from '../quantity'
import {
  BodyweightAssistancePolicyReferenceV1Schema,
  type BodyweightAssistancePolicyReferenceV1,
} from '../catalog/types'
import {
  ExactLoadQuantityV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const BODYWEIGHT_ASSISTANCE_POLICY_SCHEMA_VERSION =
  'bodyweight-assistance-progression-policy.v1' as const
export const BODYWEIGHT_ASSISTANCE_DECISION_SCHEMA_VERSION =
  'bodyweight-assistance-progression-decision.v1' as const

export const BodyweightAssistanceLoadBasisV1Schema = z.enum([
  'bodyweight_external',
  'machine_assistance',
])

export const BodyweightAssistanceLoadV1Schema = z.discriminatedUnion('loadBasis', [
  z.object({
    loadBasis: z.literal('bodyweight_external'),
    equipmentId: TrainingStableIdV1Schema,
    externalLoad: ExactLoadQuantityV1Schema,
  }).strict(),
  z.object({
    loadBasis: z.literal('machine_assistance'),
    equipmentId: TrainingStableIdV1Schema,
    assistance: ExactLoadQuantityV1Schema,
  }).strict(),
])

export { BodyweightAssistancePolicyReferenceV1Schema }

const policyProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('synthetic_fixture'),
    fixtureId: TrainingStableIdV1Schema,
    fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.enum(['Practice data', 'Simulation']),
  }).strict(),
  z.object({
    kind: z.literal('reviewed_authored_policy'),
    policyRecordId: TrainingStableIdV1Schema,
    reviewRecordId: TrainingStableIdV1Schema,
    reviewedAt: z.string().datetime({ offset: true }),
  }).strict(),
])

const policyBase = {
  schemaVersion: z.literal(BODYWEIGHT_ASSISTANCE_POLICY_SCHEMA_VERSION),
  policyId: TrainingStableIdV1Schema,
  policyVersion: TrainingStableIdV1Schema,
  progressionMode: z.literal('rep_only_same_benchmark'),
  provenance: policyProvenanceSchema,
}

export const BodyweightAssistanceProgressionPolicyV1Schema = z.discriminatedUnion('loadBasis', [
  z.object({
    ...policyBase,
    loadBasis: z.literal('bodyweight_external'),
  }).strict(),
  z.object({
    ...policyBase,
    loadBasis: z.literal('machine_assistance'),
    supportedAssistanceRange: z.object({
      equipmentId: TrainingStableIdV1Schema,
      minimum: ExactLoadQuantityV1Schema,
      maximum: ExactLoadQuantityV1Schema,
    }).strict(),
  }).strict().superRefine((policy, ctx) => {
    if (compareCanonicalKgDecimals(
      policy.supportedAssistanceRange.minimum.canonicalKg,
      policy.supportedAssistanceRange.maximum.canonicalKg,
    ) > 0) {
      ctx.addIssue({
        code: 'custom', message: 'Assistance range cannot be inverted',
        path: ['supportedAssistanceRange'],
      })
    }
  }),
])

export const BodyweightAssistanceBenchmarkV1Schema = z.object({
  exerciseVersionId: TrainingStableIdV1Schema,
  equipmentId: TrainingStableIdV1Schema,
  loadBasis: BodyweightAssistanceLoadBasisV1Schema,
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  rom: TrainingStableIdV1Schema,
  tempo: TrainingStableIdV1Schema,
  exposureType: TrainingStableIdV1Schema,
  workingSetCount: z.number().int().min(1).max(20),
  repRange: z.object({
    minimum: z.number().int().min(1).max(100),
    maximum: z.number().int().min(1).max(100),
  }).strict(),
  targetRir: z.object({
    minimum: z.number().int().min(0).max(5),
    maximum: z.number().int().min(0).max(5),
  }).strict(),
  policyId: TrainingStableIdV1Schema,
  policyVersion: TrainingStableIdV1Schema,
}).strict().superRefine((benchmark, ctx) => {
  if (benchmark.repRange.minimum > benchmark.repRange.maximum) {
    ctx.addIssue({ code: 'custom', message: 'Rep range cannot be inverted', path: ['repRange'] })
  }
  if (benchmark.targetRir.minimum > benchmark.targetRir.maximum) {
    ctx.addIssue({ code: 'custom', message: 'RIR range cannot be inverted', path: ['targetRir'] })
  }
})

export const BodyweightAssistanceTargetV1Schema = z.object({
  load: BodyweightAssistanceLoadV1Schema,
  targetReps: z.array(z.number().int().min(1).max(100)).min(1).max(20),
}).strict()

const performedSetSchema = z.object({
  setOrdinal: z.number().int().min(1).max(20),
  load: BodyweightAssistanceLoadV1Schema,
  reps: z.number().int().min(0).max(100),
  rir: z.union([z.number().int().min(0).max(5), z.literal('6_plus'), z.literal('unknown')]),
  symptomState: z.enum(['none', 'adverse_reported']),
}).strict()

export const BodyweightAssistanceExposureV1Schema = z.object({
  sourceExposureRevisionId: TrainingStableIdV1Schema,
  isComplete: z.boolean(),
  benchmark: BodyweightAssistanceBenchmarkV1Schema,
  sets: z.array(performedSetSchema).min(1).max(20),
}).strict()

const decisionAuditFields = {
  schemaVersion: z.literal(BODYWEIGHT_ASSISTANCE_DECISION_SCHEMA_VERSION),
  policyId: TrainingStableIdV1Schema,
  policyVersion: TrainingStableIdV1Schema,
  sourceExposureRevisionId: TrainingStableIdV1Schema,
}

export const BodyweightAssistanceProgressionDecisionV1Schema = z.discriminatedUnion('status', [
  z.object({
    ...decisionAuditFields,
    kind: z.literal('rep_proposal'),
    status: z.literal('proposed'),
    reason: z.literal('one_rep_progression'),
    loadChange: z.literal('none'),
    preservedLoad: BodyweightAssistanceLoadV1Schema,
    targetReps: z.array(z.number().int().min(1).max(100)).min(1).max(20),
  }).strict(),
  z.object({
    ...decisionAuditFields,
    kind: z.enum(['hold', 'review', 'recalibrate']),
    status: z.literal('not_proposed'),
    reason: z.enum([
      'policy_unavailable_hold',
      'benchmark_changed_recalibration',
      'assistance_range_recalibration',
      'incomplete_exposure_hold',
      'adverse_symptom_review',
      'effort_unknown_hold',
      'effort_too_easy_recalibration',
      'below_range_or_target_effort_hold',
      'benchmark_ceiling_review',
      'valid_state_hold',
    ]),
  }).strict(),
])

export type BodyweightAssistanceLoadV1 = z.infer<typeof BodyweightAssistanceLoadV1Schema>
export type { BodyweightAssistancePolicyReferenceV1 }
export type BodyweightAssistanceProgressionPolicyV1 = z.infer<typeof BodyweightAssistanceProgressionPolicyV1Schema>
export type BodyweightAssistanceBenchmarkV1 = z.infer<typeof BodyweightAssistanceBenchmarkV1Schema>
export type BodyweightAssistanceTargetV1 = z.infer<typeof BodyweightAssistanceTargetV1Schema>
export type BodyweightAssistanceExposureV1 = z.infer<typeof BodyweightAssistanceExposureV1Schema>
export type BodyweightAssistanceProgressionDecisionV1 = z.infer<typeof BodyweightAssistanceProgressionDecisionV1Schema>
export type BodyweightAssistanceExecutionContextV1 = z.infer<typeof ExecutionContextV1Schema>

export interface BodyweightAssistancePolicyRegistryV1 {
  readonly resolve: (
    reference: BodyweightAssistancePolicyReferenceV1,
    executionContext: BodyweightAssistanceExecutionContextV1,
  ) => BodyweightAssistanceProgressionPolicyV1 | null
}
