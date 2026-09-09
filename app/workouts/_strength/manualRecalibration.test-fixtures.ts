import { ManualRecalibrationOfferV1Schema } from '@/lib/training/contracts/manual-recalibration'
import { createLoadQuantity } from '@/lib/training/quantity'
import { calibrationOffer } from './activeCalibration.test-fixtures'

export function manualRecalibrationOffer(basis: 'barbell_total' | 'machine_assistance' = 'barbell_total') {
  const prior = calibrationOffer(basis)
  return ManualRecalibrationOfferV1Schema.parse({
    ...prior,
    schemaVersion: 'manual-recalibration-offer.v1',
    sourceBindings: {
      ...prior.sourceBindings,
      sourceDecision: {
        decisionIdentity: 'decision-1', reason: 'effort_too_easy_recalibration',
        sourceSessionId: 'session-1', sourceExerciseInstanceId: 'exercise-1',
        sourceSessionRevision: 8, sourceSessionState: 'completed',
        sourceExposureRevisionIds: ['exposure-1'],
        lastComparableActualLoad: prior.currentLoad,
      },
    },
    seriesIntent: { ...prior.seriesIntent, reason: 'explicit_too_easy_recalibration' },
    options: (basis === 'machine_assistance' ? ['25.125', '20'] : ['36', '36.125']).map((value, optionIndex) => ({
      optionIndex, equipmentId: prior.currentLoad.equipmentId, basis,
      quantity: createLoadQuantity({ value, unit: 'kg' }),
      harderDirection: basis === 'machine_assistance' ? 'lower_machine_assistance' : 'higher_resistance_or_external_load',
      confirmation: {
        explicitSelectionRequired: true,
        outlierDisposition: basis === 'machine_assistance' ? 'not_applicable_to_assistance'
          : optionIndex === 0 ? 'within_20_percent' : 'greater_than_20_percent_acknowledgement_required',
      },
    })),
  })
}
