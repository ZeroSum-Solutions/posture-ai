import { z } from 'zod'
import { TrainingCatalogOriginV1Schema } from '../catalog/types'
import {
  EquipmentLoadBasisV1Schema,
  ExactLoadQuantityV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const ACTIVE_CALIBRATION_OFFER_SCHEMA_VERSION = 'active-calibration-offer.v1' as const
export const ACTIVE_CALIBRATION_SELECTION_SCHEMA_VERSION = 'active-calibration-selection.v1' as const

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const loadEpochSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const ActiveCalibrationTargetV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  sessionState: z.literal('scheduled'),
  prescriptionState: z.literal('unprescribed'),
}).strict()

export const ActiveCalibrationLoadV1Schema = z.object({
  equipmentId: TrainingStableIdV1Schema,
  basis: EquipmentLoadBasisV1Schema,
  quantity: ExactLoadQuantityV1Schema,
}).strict()

export const ActiveCalibrationSourceBindingsV1Schema = z.object({
  subjectId: TrainingStableIdV1Schema,
  assignmentId: TrainingStableIdV1Schema,
  sourceProgramRevisionNumber: revisionSchema,
  sourceProgramHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceProfileRevisionId: TrainingStableIdV1Schema,
  sourceEligibilityRevisionId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  catalogVersion: TrainingStableIdV1Schema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
  target: ActiveCalibrationTargetV1Schema,
  exerciseVersionId: TrainingStableIdV1Schema,
  priorProgressionSeriesId: TrainingStableIdV1Schema,
  priorLoadEpoch: loadEpochSchema,
}).strict()

export const ActiveCalibrationSeriesIntentV1Schema = z.object({
  kind: z.literal('new_series_on_acceptance'),
  reason: z.literal('explicit_familiarization'),
  sourceProgressionSeriesId: TrainingStableIdV1Schema,
  sourceLoadEpoch: loadEpochSchema,
  nextLoadEpoch: loadEpochSchema,
}).strict().superRefine((intent, ctx) => {
  if (intent.nextLoadEpoch !== intent.sourceLoadEpoch + 1) {
    ctx.addIssue({ code: 'custom', message: 'Next load epoch must increment exactly once', path: ['nextLoadEpoch'] })
  }
})

export const ActiveCalibrationOptionV1Schema = ActiveCalibrationLoadV1Schema.extend({
  optionIndex: z.number().int().min(0).max(49_999),
  easierDirection: z.enum(['lower_resistance_or_external_load', 'higher_machine_assistance']),
}).strict()

const offerBase = {
  schemaVersion: z.literal(ACTIVE_CALIBRATION_OFFER_SCHEMA_VERSION),
  sourceBindings: ActiveCalibrationSourceBindingsV1Schema,
  currentLoad: ActiveCalibrationLoadV1Schema,
  bodyweightAssistancePolicy: z.object({
    policyId: TrainingStableIdV1Schema,
    policyVersion: TrainingStableIdV1Schema,
  }).strict().optional(),
  seriesIntent: ActiveCalibrationSeriesIntentV1Schema,
}

function requireDedicatedPolicy(
  value: { currentLoad: z.infer<typeof ActiveCalibrationLoadV1Schema>; bodyweightAssistancePolicy?: unknown },
  ctx: z.RefinementCtx,
): void {
  const dedicated = value.currentLoad.basis === 'bodyweight_external'
    || value.currentLoad.basis === 'machine_assistance'
  if (dedicated !== (value.bodyweightAssistancePolicy !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Bodyweight and assistance calibration must preserve its exact policy identity',
      path: ['bodyweightAssistancePolicy'],
    })
  }
}

export const ActiveCalibrationOfferV1Schema = z.discriminatedUnion('kind', [
  z.object({
    ...offerBase,
    kind: z.literal('options'),
    status: z.literal('requires_explicit_selection'),
    options: z.array(ActiveCalibrationOptionV1Schema).min(1).max(50_000),
  }).strict(),
  z.object({
    ...offerBase,
    kind: z.literal('unavailable'),
    status: z.literal('not_offered'),
    reason: z.literal('no_easier_achievable_setting'),
  }).strict(),
]).superRefine(requireDedicatedPolicy)

export const SelectActiveCalibrationOptionInputV1Schema = z.object({
  requestId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(49_999),
}).strict()

export const ActiveCalibrationSelectionV1Schema = z.object({
  schemaVersion: z.literal(ACTIVE_CALIBRATION_SELECTION_SCHEMA_VERSION),
  status: z.literal('selected_not_applied'),
  requestId: z.string().uuid(),
  sourceBindings: ActiveCalibrationSourceBindingsV1Schema,
  bodyweightAssistancePolicy: z.object({
    policyId: TrainingStableIdV1Schema,
    policyVersion: TrainingStableIdV1Schema,
  }).strict().optional(),
  selectedOption: ActiveCalibrationOptionV1Schema,
  seriesIntent: ActiveCalibrationSeriesIntentV1Schema,
}).strict().superRefine((selection, ctx) => requireDedicatedPolicy({
  currentLoad: selection.selectedOption,
  bodyweightAssistancePolicy: selection.bodyweightAssistancePolicy,
}, ctx))

export type ActiveCalibrationTargetV1 = z.infer<typeof ActiveCalibrationTargetV1Schema>
export type ActiveCalibrationOfferV1 = z.infer<typeof ActiveCalibrationOfferV1Schema>
export type ActiveCalibrationSelectionV1 = z.infer<typeof ActiveCalibrationSelectionV1Schema>
