// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Panel from './ActiveCalibrationPanel'
import { calibrationOffer } from './activeCalibration.test-fixtures'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const proposalId = '11111111-1111-4111-8111-111111111111'
function setup() {
  const offer = calibrationOffer('machine_assistance')
  const projection = { schemaVersion: 'active-calibration-projection.v1', proposalId, offer }
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(projection), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  render(<Panel sessionId="source-session" exerciseInstanceId="source-exercise" expected={{
    subjectId: offer.sourceBindings.subjectId, assignmentId: offer.sourceBindings.assignmentId,
    progressionSeriesId: offer.sourceBindings.priorProgressionSeriesId, executionContext: offer.sourceBindings.executionContext,
  }} />)
  if (offer.kind !== 'options') throw new Error('Test requires selectable offer')
  const selected = offer.options[0]
  const receipt = {
    schemaVersion: 'active-calibration-acceptance.v1', proposalId,
    assignmentId: offer.sourceBindings.assignmentId, programRevisionNumber: 3,
    executionContext: offer.sourceBindings.executionContext,
    selectedLoad: { equipmentId: selected.equipmentId, basis: selected.basis, quantity: selected.quantity },
    seriesIntent: offer.seriesIntent, newProgressionSeriesId: 'fresh-series',
    affectedTargets: [{ sessionId: offer.sourceBindings.target.sessionId, exerciseInstanceId: offer.sourceBindings.target.exerciseInstanceId }],
  }
  return { fetcher, receipt, projection }
}
async function choose() {
  fireEvent.click(screen.getByRole('button', { name: 'Review easier settings' }))
  fireEvent.change(await screen.findByRole('combobox', { name: 'New setting' }), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm new setting' }))
}

describe('ActiveCalibrationPanel', () => {
  it('rejects an offer belonging to a different subject before exposing its choices', async () => {
    const { fetcher, projection } = setup()
    const foreign = structuredClone(projection)
    foreign.offer.sourceBindings.subjectId = 'another-subject'
    fetcher.mockReset().mockResolvedValueOnce(new Response(JSON.stringify(foreign), { status: 200 }))
    fireEvent.click(screen.getByRole('button', { name: 'Review easier settings' }))
    await screen.findByText(/settings did not match this exercise/)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('requests the actual source and confirms only its exact selected receipt', async () => {
    const { fetcher, receipt } = setup()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 200 }))
    await choose()
    await screen.findByText(/New setting confirmed for future sessions/)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ sessionId: 'source-session', exerciseInstanceId: 'source-exercise' })
    expect(fetcher.mock.calls[1][0]).toBe(`/api/training/active-calibrations/proposals/${proposalId}/accept`)
  })

  it.each(['assignment', 'selectedLoad', 'target', 'series'])('does not acknowledge a mismatched %s receipt and preserves exact retry', async mismatch => {
    const { fetcher, receipt } = setup()
    const invalid = structuredClone(receipt)
    if (mismatch === 'assignment') invalid.assignmentId = 'another-assignment'
    if (mismatch === 'selectedLoad') invalid.selectedLoad.equipmentId = 'another-machine'
    if (mismatch === 'target') invalid.affectedTargets[0].exerciseInstanceId = 'another-exercise'
    if (mismatch === 'series') invalid.seriesIntent.nextLoadEpoch = 4
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(invalid), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 200 }))
    await choose()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry the same selection' }))
    await screen.findByText(/New setting confirmed for future sessions/)
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[1][1].body)
  })

  it('shows current coach authority denial without claiming acceptance', async () => {
    const { fetcher } = setup()
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await choose()
    await screen.findByText(/assigned coach must confirm/)
    expect(screen.queryByText(/New setting confirmed/)).toBeNull()
  })
})
