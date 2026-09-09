import { ActiveCalibrationOfferV1Schema } from '@/lib/training/contracts/active-calibration'
import { createLoadQuantity } from '@/lib/training/quantity'

export function calibrationOffer(basis: 'barbell_total' | 'machine_assistance' | 'bodyweight_external' = 'barbell_total') {
  return ActiveCalibrationOfferV1Schema.parse({
    schemaVersion: 'active-calibration-offer.v1', kind: 'options', status: 'requires_explicit_selection',
    sourceBindings: {
      subjectId: 'subject-1', assignmentId: 'assignment-1', sourceProgramRevisionNumber: 2,
      sourceProgramHash: 'a'.repeat(64), sourceProfileRevisionId: '3', sourceEligibilityRevisionId: 'eligibility-3',
      executionContext: { kind: 'live' }, catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' },
      target: { sessionId: 'session-2', exerciseInstanceId: 'exercise-2', sessionState: 'scheduled', prescriptionState: 'unprescribed' },
      exerciseVersionId: 'exercise.v1', priorProgressionSeriesId: 'series-1', priorLoadEpoch: 2,
    },
    currentLoad: { equipmentId: 'equipment-1', basis, quantity: createLoadQuantity({ value: '30', unit: 'kg' }) },
    ...(basis === 'barbell_total' ? {} : { bodyweightAssistancePolicy: { policyId: 'policy-1', policyVersion: '1' } }),
    seriesIntent: { kind: 'new_series_on_acceptance', reason: 'explicit_familiarization', sourceProgressionSeriesId: 'series-1', sourceLoadEpoch: 2, nextLoadEpoch: 3 },
    options: (basis === 'machine_assistance' ? ['30.125', '35'] : ['0', '25.125']).map((value, optionIndex) => ({
      optionIndex, equipmentId: 'equipment-1', basis, quantity: createLoadQuantity({ value, unit: 'kg' }),
      easierDirection: basis === 'machine_assistance' ? 'higher_machine_assistance' : 'lower_resistance_or_external_load',
    })),
  })
}

