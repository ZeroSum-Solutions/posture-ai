import { describe, expect, it } from 'vitest'
import { manualRecalibrationOffer } from '../../../app/workouts/_strength/manualRecalibration.test-fixtures'
import {
  AcceptManualRecalibrationProposalInputV1Schema,
  CreateManualRecalibrationProposalInputV1Schema,
  ManualRecalibrationAcceptanceV1Schema,
  ManualRecalibrationProposalProjectionV1Schema,
} from './manual-recalibration-persistence'

const proposalId = '11111111-1111-4111-8111-111111111111'

describe('manual recalibration persistence boundary', () => {
  it('requires explicit acknowledgement state and prevents client-authored load or decision input', () => {
    const selection = { requestId: proposalId, optionIndex: 1, outlierAcknowledged: true }
    expect(AcceptManualRecalibrationProposalInputV1Schema.parse(selection)).toEqual(selection)
    expect(AcceptManualRecalibrationProposalInputV1Schema.safeParse({ requestId: proposalId, optionIndex: 1 }).success).toBe(false)
    expect(AcceptManualRecalibrationProposalInputV1Schema.safeParse({ ...selection, quantity: '70' }).success).toBe(false)
    expect(CreateManualRecalibrationProposalInputV1Schema.safeParse({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1', reason: 'effort_too_easy_recalibration',
    }).success).toBe(false)
  })

  it('requires a durable proposal identity for a selectable offer', () => {
    const projection = { schemaVersion: 'manual-recalibration-projection.v1', proposalId, offer: manualRecalibrationOffer() }
    expect(ManualRecalibrationProposalProjectionV1Schema.safeParse(projection).success).toBe(true)
    expect(ManualRecalibrationProposalProjectionV1Schema.safeParse({ ...projection, proposalId: null }).success).toBe(false)
  })

  it('preserves the source decision and actual-load baseline in a new-series receipt', () => {
    const offer = manualRecalibrationOffer()
    if (offer.kind !== 'options') throw new Error('Expected selectable fixture')
    const selected = offer.options[1]
    const receipt = {
      schemaVersion: 'manual-recalibration-acceptance.v1', proposalId,
      assignmentId: offer.sourceBindings.assignmentId,
      programRevisionNumber: offer.sourceBindings.sourceProgramRevisionNumber + 1,
      executionContext: offer.sourceBindings.executionContext,
      selectedLoad: { equipmentId: selected.equipmentId, basis: selected.basis, quantity: selected.quantity },
      sourceDecision: offer.sourceBindings.sourceDecision,
      outlierAcknowledged: true,
      seriesIntent: offer.seriesIntent,
      newProgressionSeriesId: 'manual-recalibration-1',
      affectedTargets: [{ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }],
    }
    expect(ManualRecalibrationAcceptanceV1Schema.parse(receipt)).toEqual(receipt)
    expect(ManualRecalibrationAcceptanceV1Schema.safeParse({ ...receipt, sourceDecision: undefined }).success).toBe(false)
    expect(ManualRecalibrationAcceptanceV1Schema.safeParse({ ...receipt, newProgressionSeriesId: offer.seriesIntent.sourceProgressionSeriesId }).success).toBe(false)
  })
})
