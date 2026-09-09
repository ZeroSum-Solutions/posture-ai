import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  ManualRecalibrationOfferV1Schema,
  ManualRecalibrationSelectionV1Schema,
  ManualRecalibrationSourceDecisionV1Schema,
} from './manual-recalibration'

const sourceDecision = {
  decisionIdentity: 'decision-too-easy-1',
  reason: 'effort_too_easy_recalibration' as const,
  sourceSessionId: 'session-1',
  sourceExerciseInstanceId: 'exercise-1',
  sourceSessionRevision: 4,
  sourceSessionState: 'completed' as const,
  sourceExposureRevisionIds: ['log-1:2'],
  lastComparableActualLoad: {
    equipmentId: 'rack-1', basis: 'barbell_total' as const,
    quantity: createLoadQuantity({ value: '60', unit: 'kg' }),
  },
}

const sourceBindings = {
  subjectId: 'subject-1', assignmentId: 'assignment-1', sourceProgramRevisionNumber: 2,
  sourceProgramHash: 'a'.repeat(64), sourceProfileRevisionId: '3',
  sourceEligibilityRevisionId: 'eligibility-3', executionContext: { kind: 'live' as const },
  catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const },
  target: {
    sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
    sessionState: 'scheduled' as const, prescriptionState: 'unprescribed' as const,
  },
  exerciseVersionId: 'press.v1', priorProgressionSeriesId: 'series-press', priorLoadEpoch: 2,
  sourceDecision,
}

const currentLoad = {
  equipmentId: 'rack-1', basis: 'barbell_total' as const,
  quantity: createLoadQuantity({ value: '60', unit: 'kg' }),
}
const seriesIntent = {
  kind: 'new_series_on_acceptance' as const,
  reason: 'explicit_too_easy_recalibration' as const,
  sourceProgressionSeriesId: 'series-press', sourceLoadEpoch: 2, nextLoadEpoch: 3,
}

function resistanceOffer() {
  return {
    schemaVersion: 'manual-recalibration-offer.v1' as const,
    kind: 'options' as const,
    status: 'requires_explicit_selection' as const,
    sourceBindings,
    currentLoad,
    seriesIntent,
    options: [
      {
        optionIndex: 0, equipmentId: 'rack-1', basis: 'barbell_total' as const,
        quantity: createLoadQuantity({ value: '72', unit: 'kg' }),
        harderDirection: 'higher_resistance_or_external_load' as const,
        confirmation: {
          explicitSelectionRequired: true as const,
          outlierDisposition: 'within_20_percent' as const,
        },
      },
      {
        optionIndex: 1, equipmentId: 'rack-1', basis: 'barbell_total' as const,
        quantity: createLoadQuantity({ value: '73', unit: 'kg' }),
        harderDirection: 'higher_resistance_or_external_load' as const,
        confirmation: {
          explicitSelectionRequired: true as const,
          outlierDisposition: 'greater_than_20_percent_acknowledgement_required' as const,
        },
      },
    ],
  }
}

describe('manual recalibration contracts', () => {
  it('binds the exact too-easy source and exact 20 percent boundary', () => {
    expect(ManualRecalibrationSourceDecisionV1Schema.parse(sourceDecision)).toEqual(sourceDecision)
    expect(ManualRecalibrationOfferV1Schema.parse(resistanceOffer())).toEqual(resistanceOffer())
    expect(ManualRecalibrationSourceDecisionV1Schema.safeParse({
      ...sourceDecision, reason: 'effort_unknown_hold',
    }).success).toBe(false)
  })

  it('rejects a non-harder option, a forged outlier disposition, and a mismatched series intent', () => {
    const offer = resistanceOffer()
    expect(ManualRecalibrationOfferV1Schema.safeParse({
      ...offer,
      options: [{
        ...offer.options[0],
        quantity: createLoadQuantity({ value: '55', unit: 'kg' }),
      }],
    }).success).toBe(false)
    expect(ManualRecalibrationOfferV1Schema.safeParse({
      ...offer,
      options: [{
        ...offer.options[1],
        confirmation: { ...offer.options[1].confirmation, outlierDisposition: 'within_20_percent' },
      }],
    }).success).toBe(false)
    expect(ManualRecalibrationOfferV1Schema.safeParse({
      ...offer,
      seriesIntent: { ...seriesIntent, sourceProgressionSeriesId: 'another-series' },
    }).success).toBe(false)
  })

  it('requires lower machine assistance and preserves its dedicated policy identity', () => {
    const assistanceOffer = {
      ...resistanceOffer(),
      sourceBindings: {
        ...resistanceOffer().sourceBindings,
        sourceDecision: {
          ...resistanceOffer().sourceBindings.sourceDecision,
          lastComparableActualLoad: {
            equipmentId: 'assist-1', basis: 'machine_assistance' as const,
            quantity: createLoadQuantity({ value: '30', unit: 'kg' }),
          },
        },
      },
      currentLoad: {
        equipmentId: 'assist-1', basis: 'machine_assistance' as const,
        quantity: createLoadQuantity({ value: '30', unit: 'kg' }),
      },
      bodyweightAssistancePolicy: { policyId: 'assist-policy', policyVersion: '1' },
      options: [{
        optionIndex: 0, equipmentId: 'assist-1', basis: 'machine_assistance' as const,
        quantity: createLoadQuantity({ value: '20', unit: 'kg' }),
        harderDirection: 'lower_machine_assistance' as const,
        confirmation: {
          explicitSelectionRequired: true as const,
          outlierDisposition: 'not_applicable_to_assistance' as const,
        },
      }],
    }
    expect(ManualRecalibrationOfferV1Schema.parse(assistanceOffer)).toEqual(assistanceOffer)
    expect(ManualRecalibrationOfferV1Schema.safeParse({
      ...assistanceOffer, bodyweightAssistancePolicy: undefined,
    }).success).toBe(false)
    expect(ManualRecalibrationOfferV1Schema.safeParse({
      ...assistanceOffer,
      options: [{
        ...assistanceOffer.options[0],
        quantity: createLoadQuantity({ value: '40', unit: 'kg' }),
      }],
    }).success).toBe(false)
  })

  it('keeps an explicit choice unapplied and rejects browser-forged acceptance or option values', () => {
    const offer = resistanceOffer()
    const selection = {
      schemaVersion: 'manual-recalibration-selection.v1' as const,
      status: 'selected_not_applied' as const,
      requestId: '11111111-1111-4111-8111-111111111111',
      sourceBindings: offer.sourceBindings,
      currentLoad: offer.currentLoad,
      selectedOption: offer.options[1],
      seriesIntent: offer.seriesIntent,
    }
    expect(ManualRecalibrationSelectionV1Schema.parse(selection)).toEqual(selection)
    expect(ManualRecalibrationSelectionV1Schema.safeParse({ ...selection, status: 'accepted' }).success).toBe(false)
    expect(ManualRecalibrationSelectionV1Schema.safeParse({
      ...selection,
      selectedOption: { ...selection.selectedOption, equipmentId: 'other-rack' },
    }).success).toBe(false)
  })
})
