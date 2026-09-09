import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  ActiveCalibrationAcceptanceV1Schema,
  ActiveCalibrationProposalProjectionV1Schema,
  AcceptActiveCalibrationProposalInputV1Schema,
  CreateActiveCalibrationProposalInputV1Schema,
} from './active-calibration-persistence'

const target = {
  sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
  sessionState: 'scheduled' as const, prescriptionState: 'unprescribed' as const,
}
const sourceBindings = {
  subjectId: 'subject-1', assignmentId: 'assignment-1', sourceProgramRevisionNumber: 1,
  sourceProgramHash: 'a'.repeat(64), sourceProfileRevisionId: '1',
  sourceEligibilityRevisionId: 'eligibility-1', executionContext: { kind: 'live' as const },
  catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const }, target,
  exerciseVersionId: 'squat.v1', priorProgressionSeriesId: 'series-1', priorLoadEpoch: 2,
}
const seriesIntent = {
  kind: 'new_series_on_acceptance' as const, reason: 'explicit_familiarization' as const,
  sourceProgressionSeriesId: 'series-1', sourceLoadEpoch: 2, nextLoadEpoch: 3,
}
const load = {
  equipmentId: 'bar-1', basis: 'barbell_total' as const,
  quantity: createLoadQuantity({ value: '55', unit: 'kg' }),
}
const offer = {
  schemaVersion: 'active-calibration-offer.v1' as const,
  kind: 'options' as const, status: 'requires_explicit_selection' as const,
  sourceBindings, currentLoad: { ...load, quantity: createLoadQuantity({ value: '60', unit: 'kg' }) },
  seriesIntent,
  options: [{ ...load, optionIndex: 0, easierDirection: 'lower_resistance_or_external_load' as const }],
}

describe('active calibration persistence contracts', () => {
  it('accepts only bounded source and selection inputs', () => {
    expect(CreateActiveCalibrationProposalInputV1Schema.parse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    })).toBeDefined()
    expect(CreateActiveCalibrationProposalInputV1Schema.safeParse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1', optionIndex: 0,
    }).success).toBe(false)
    expect(AcceptActiveCalibrationProposalInputV1Schema.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111', optionIndex: -1,
    }).success).toBe(false)
  })

  it('binds proposal identity only to selectable offers', () => {
    expect(ActiveCalibrationProposalProjectionV1Schema.parse({
      schemaVersion: 'active-calibration-projection.v1',
      proposalId: '22222222-2222-4222-8222-222222222222', offer,
    })).toBeDefined()
    expect(ActiveCalibrationProposalProjectionV1Schema.safeParse({
      schemaVersion: 'active-calibration-projection.v1', proposalId: null, offer,
    }).success).toBe(false)
  })

  it('requires a future-only new series in the acceptance receipt', () => {
    const receipt = {
      schemaVersion: 'active-calibration-acceptance.v1',
      proposalId: '22222222-2222-4222-8222-222222222222', assignmentId: 'assignment-1',
      programRevisionNumber: 2, executionContext: { kind: 'live' }, selectedLoad: load,
      seriesIntent, newProgressionSeriesId: 'familiarization:22222222-2222-4222-8222-222222222222',
      affectedTargets: [{ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }],
    }
    expect(ActiveCalibrationAcceptanceV1Schema.parse(receipt)).toEqual(receipt)
    expect(ActiveCalibrationAcceptanceV1Schema.safeParse({
      ...receipt, newProgressionSeriesId: seriesIntent.sourceProgressionSeriesId,
    }).success).toBe(false)
  })
})
