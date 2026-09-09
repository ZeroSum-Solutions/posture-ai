import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  ActiveCalibrationOfferV1Schema,
  ActiveCalibrationSelectionV1Schema,
  ActiveCalibrationTargetV1Schema,
} from './active-calibration'

const sourceBindings = {
  subjectId: 'subject-1', assignmentId: 'assignment-1', sourceProgramRevisionNumber: 2,
  sourceProgramHash: 'a'.repeat(64), sourceProfileRevisionId: '3',
  sourceEligibilityRevisionId: 'eligibility-3', executionContext: { kind: 'live' as const },
  catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const },
  target: {
    sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
    sessionState: 'scheduled' as const, prescriptionState: 'unprescribed' as const,
  },
  exerciseVersionId: 'squat.v1', priorProgressionSeriesId: 'series-squat', priorLoadEpoch: 2,
}
const currentLoad = {
  equipmentId: 'rack-1', basis: 'barbell_total' as const,
  quantity: createLoadQuantity({ value: '60', unit: 'kg' }),
}
const seriesIntent = {
  kind: 'new_series_on_acceptance' as const, reason: 'explicit_familiarization' as const,
  sourceProgressionSeriesId: 'series-squat', sourceLoadEpoch: 2, nextLoadEpoch: 3,
}

describe('active calibration contracts', () => {
  it('requires an unstarted, unprescribed target and rejects browser-owned state shortcuts', () => {
    expect(ActiveCalibrationTargetV1Schema.parse(sourceBindings.target)).toEqual(sourceBindings.target)
    for (const invalid of [
      { ...sourceBindings.target, sessionState: 'in_progress' },
      { ...sourceBindings.target, sessionState: 'completed' },
      { ...sourceBindings.target, prescriptionState: 'prescribed' },
      { ...sourceBindings.target, eligibility: 'client_claimed' },
    ]) expect(ActiveCalibrationTargetV1Schema.safeParse(invalid).success).toBe(false)
  })

  it('keeps offered exact loads, source bindings, and a future-only series intent', () => {
    const offer = {
      schemaVersion: 'active-calibration-offer.v1', kind: 'options',
      status: 'requires_explicit_selection', sourceBindings, currentLoad, seriesIntent,
      options: [{
        optionIndex: 0, equipmentId: 'rack-1', basis: 'barbell_total',
        quantity: createLoadQuantity({ value: '55', unit: 'kg' }),
        easierDirection: 'lower_resistance_or_external_load',
      }],
    } as const
    expect(ActiveCalibrationOfferV1Schema.parse(offer)).toEqual(offer)
    expect(ActiveCalibrationOfferV1Schema.safeParse({
      ...offer, seriesIntent: { ...seriesIntent, nextLoadEpoch: 4 },
    }).success).toBe(false)
    expect(ActiveCalibrationOfferV1Schema.safeParse({
      ...offer, options: [{ ...offer.options[0], optionIndex: -1 }],
    }).success).toBe(false)
  })

  it('records an explicit selection as not yet applied', () => {
    const selectedOption = {
      optionIndex: 0, equipmentId: 'rack-1', basis: 'barbell_total' as const,
      quantity: createLoadQuantity({ value: '55', unit: 'kg' }),
      easierDirection: 'lower_resistance_or_external_load' as const,
    }
    const selection = {
      schemaVersion: 'active-calibration-selection.v1', status: 'selected_not_applied',
      requestId: '11111111-1111-4111-8111-111111111111',
      sourceBindings, selectedOption, seriesIntent,
    } as const
    expect(ActiveCalibrationSelectionV1Schema.parse(selection)).toEqual(selection)
    expect(ActiveCalibrationSelectionV1Schema.safeParse({ ...selection, status: 'accepted' }).success).toBe(false)
    expect(ActiveCalibrationSelectionV1Schema.safeParse({
      ...selection,
      selectedOption: { ...selectedOption, basis: 'machine_assistance' },
    }).success).toBe(false)
  })
})
