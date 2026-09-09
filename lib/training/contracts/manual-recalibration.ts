import { z } from 'zod'
import { compareCanonicalKgDecimals, compareLoadIncreaseToRatio } from '../quantity'
import {
  ActiveCalibrationLoadV1Schema,
  ActiveCalibrationSourceBindingsV1Schema,
} from './active-calibration'
import { TrainingStableIdV1Schema } from './program'

export const MANUAL_RECALIBRATION_OFFER_SCHEMA_VERSION = 'manual-recalibration-offer.v1' as const
export const MANUAL_RECALIBRATION_SELECTION_SCHEMA_VERSION = 'manual-recalibration-selection.v1' as const

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const loadEpochSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const ManualRecalibrationSourceDecisionV1Schema = z.object({
  decisionIdentity: z.string().trim().min(1).max(160),
  reason: z.literal('effort_too_easy_recalibration'),
  sourceSessionId: TrainingStableIdV1Schema,
  sourceExerciseInstanceId: TrainingStableIdV1Schema,
  sourceSessionRevision: revisionSchema,
  sourceSessionState: z.enum(['completed', 'completed_with_omissions']),
  sourceExposureRevisionIds: z.array(z.string().trim().min(1).max(160)).min(1).max(64),
  lastComparableActualLoad: ActiveCalibrationLoadV1Schema,
}).strict()

export const ManualRecalibrationSourceBindingsV1Schema = ActiveCalibrationSourceBindingsV1Schema.extend({
  sourceDecision: ManualRecalibrationSourceDecisionV1Schema,
}).strict()

export const ManualRecalibrationSeriesIntentV1Schema = z.object({
  kind: z.literal('new_series_on_acceptance'),
  reason: z.literal('explicit_too_easy_recalibration'),
  sourceProgressionSeriesId: TrainingStableIdV1Schema,
  sourceLoadEpoch: loadEpochSchema,
  nextLoadEpoch: loadEpochSchema,
}).strict().superRefine((intent, ctx) => {
  if (intent.nextLoadEpoch !== intent.sourceLoadEpoch + 1) {
    ctx.addIssue({ code: 'custom', message: 'Next load epoch must increment exactly once', path: ['nextLoadEpoch'] })
  }
})

const outlierDispositionSchema = z.enum([
  'within_20_percent',
  'greater_than_20_percent_acknowledgement_required',
  'zero_prior_requires_calibration_confirmation',
  'not_applicable_to_assistance',
])

export const ManualRecalibrationOptionV1Schema = ActiveCalibrationLoadV1Schema.extend({
  optionIndex: z.number().int().min(0).max(49_999),
  harderDirection: z.enum(['higher_resistance_or_external_load', 'lower_machine_assistance']),
  confirmation: z.object({
    explicitSelectionRequired: z.literal(true),
    outlierDisposition: outlierDispositionSchema,
  }).strict(),
}).strict()

const dedicatedPolicySchema = z.object({
  policyId: TrainingStableIdV1Schema,
  policyVersion: TrainingStableIdV1Schema,
}).strict()

const offerBase = {
  schemaVersion: z.literal(MANUAL_RECALIBRATION_OFFER_SCHEMA_VERSION),
  sourceBindings: ManualRecalibrationSourceBindingsV1Schema,
  currentLoad: ActiveCalibrationLoadV1Schema,
  bodyweightAssistancePolicy: dedicatedPolicySchema.optional(),
  seriesIntent: ManualRecalibrationSeriesIntentV1Schema,
}

type RecalibrationShape = {
  sourceBindings: z.infer<typeof ManualRecalibrationSourceBindingsV1Schema>
  currentLoad: z.infer<typeof ActiveCalibrationLoadV1Schema>
  bodyweightAssistancePolicy?: z.infer<typeof dedicatedPolicySchema>
  seriesIntent: z.infer<typeof ManualRecalibrationSeriesIntentV1Schema>
  options?: readonly z.infer<typeof ManualRecalibrationOptionV1Schema>[]
}

function expectedOutlierDisposition(
  baselineLoad: RecalibrationShape['currentLoad'],
  option: z.infer<typeof ManualRecalibrationOptionV1Schema>,
): z.infer<typeof outlierDispositionSchema> {
  if (baselineLoad.basis === 'machine_assistance') return 'not_applicable_to_assistance'
  const comparison = compareLoadIncreaseToRatio(baselineLoad.quantity, option.quantity, {
    numerator: 1,
    denominator: 5,
  })
  if (comparison === 'exceeds_limit') return 'greater_than_20_percent_acknowledgement_required'
  if (comparison === 'calibration_required') return 'zero_prior_requires_calibration_confirmation'
  return 'within_20_percent'
}

function validateRecalibrationShape(value: RecalibrationShape, ctx: z.RefinementCtx): void {
  const dedicated = value.currentLoad.basis === 'bodyweight_external'
    || value.currentLoad.basis === 'machine_assistance'
  if (dedicated !== (value.bodyweightAssistancePolicy !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Bodyweight and assistance recalibration must preserve exact policy identity',
      path: ['bodyweightAssistancePolicy'],
    })
  }
  if (value.seriesIntent.sourceProgressionSeriesId
      !== value.sourceBindings.priorProgressionSeriesId
    || value.seriesIntent.sourceLoadEpoch !== value.sourceBindings.priorLoadEpoch) {
    ctx.addIssue({ code: 'custom', message: 'Series intent must match its immutable source', path: ['seriesIntent'] })
  }

  const baseline = value.sourceBindings.sourceDecision.lastComparableActualLoad
  if (baseline.equipmentId !== value.currentLoad.equipmentId
    || baseline.basis !== value.currentLoad.basis
    || baseline.quantity.entered.unit !== value.currentLoad.quantity.entered.unit) {
    ctx.addIssue({
      code: 'custom',
      message: 'Comparable actual baseline must preserve equipment, basis and entered unit',
      path: ['sourceBindings', 'sourceDecision', 'lastComparableActualLoad'],
    })
  }

  const seenIndexes = new Set<number>()
  value.options?.forEach((option, index) => {
    if (seenIndexes.has(option.optionIndex)) {
      ctx.addIssue({ code: 'custom', message: 'Option indexes must be unique', path: ['options', index, 'optionIndex'] })
    }
    seenIndexes.add(option.optionIndex)

    if (option.equipmentId !== value.currentLoad.equipmentId
      || option.basis !== value.currentLoad.basis
      || option.quantity.entered.unit !== value.currentLoad.quantity.entered.unit) {
      ctx.addIssue({ code: 'custom', message: 'Option must preserve equipment, basis and entered unit', path: ['options', index] })
      return
    }

    const assistance = value.currentLoad.basis === 'machine_assistance'
    const actualDirection = compareCanonicalKgDecimals(
      option.quantity.canonicalKg,
      value.currentLoad.quantity.canonicalKg,
    )
    const directionMatches = assistance
      ? option.harderDirection === 'lower_machine_assistance'
        && actualDirection < 0
      : option.harderDirection === 'higher_resistance_or_external_load'
        && actualDirection > 0
    if (!directionMatches || actualDirection === 0) {
      ctx.addIssue({ code: 'custom', message: 'Option must be strictly harder for its load basis', path: ['options', index] })
    }

    if (option.confirmation.outlierDisposition !== expectedOutlierDisposition(baseline, option)) {
      ctx.addIssue({ code: 'custom', message: 'Outlier disposition must be derived from exact quantities', path: ['options', index, 'confirmation', 'outlierDisposition'] })
    }
  })
}

export const ManualRecalibrationOfferV1Schema = z.discriminatedUnion('kind', [
  z.object({
    ...offerBase,
    kind: z.literal('options'),
    status: z.literal('requires_explicit_selection'),
    options: z.array(ManualRecalibrationOptionV1Schema).min(1).max(50_000),
  }).strict(),
  z.object({
    ...offerBase,
    kind: z.literal('unavailable'),
    status: z.literal('not_offered'),
    reason: z.literal('no_harder_achievable_setting'),
  }).strict(),
]).superRefine(validateRecalibrationShape)

export const SelectManualRecalibrationOptionInputV1Schema = z.object({
  requestId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(49_999),
}).strict()

export const ManualRecalibrationSelectionV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_RECALIBRATION_SELECTION_SCHEMA_VERSION),
  status: z.literal('selected_not_applied'),
  requestId: z.string().uuid(),
  sourceBindings: ManualRecalibrationSourceBindingsV1Schema,
  currentLoad: ActiveCalibrationLoadV1Schema,
  bodyweightAssistancePolicy: dedicatedPolicySchema.optional(),
  selectedOption: ManualRecalibrationOptionV1Schema,
  seriesIntent: ManualRecalibrationSeriesIntentV1Schema,
}).strict().superRefine((selection, ctx) => validateRecalibrationShape({
  sourceBindings: selection.sourceBindings,
  currentLoad: selection.currentLoad,
  bodyweightAssistancePolicy: selection.bodyweightAssistancePolicy,
  seriesIntent: selection.seriesIntent,
  options: [selection.selectedOption],
}, ctx))

export type ManualRecalibrationSourceDecisionV1 = z.infer<typeof ManualRecalibrationSourceDecisionV1Schema>
export type ManualRecalibrationOfferV1 = z.infer<typeof ManualRecalibrationOfferV1Schema>
export type ManualRecalibrationSelectionV1 = z.infer<typeof ManualRecalibrationSelectionV1Schema>
