// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingExerciseSwapPanel from './TrainingExerciseSwapPanel'

const proposalId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const nextRequestId = '33333333-3333-4333-8333-333333333333'
const assignmentId = 'assignment-1'
const loadOptions = [
  {
    optionIndex: 0, equipmentId: 'db-home', loadBasis: 'dumbbell_single_implement',
    implementCount: 1, holdingConfiguration: 'two_hands_single_implement',
    quantity: { entered: { value: '10', unit: 'kg' }, canonicalKg: '10' },
  },
  {
    optionIndex: 1, equipmentId: 'db-home', loadBasis: 'dumbbell_per_hand',
    implementCount: 2, holdingConfiguration: 'one_per_hand',
    quantity: { entered: { value: '12.5', unit: 'kg' }, canonicalKg: '12.5' },
  },
] as const

function projection(id = proposalId) {
  return {
    schemaVersion: 'training-exercise-swap-projection.v1',
    result: {
      kind: 'proposals',
      proposals: [{
        schemaVersion: 'training-exercise-swap-proposal.v1', proposalId: id,
        assignmentId, baseProgramRevisionNumber: 3,
        sourceExercise: { exerciseVersionId: 'goblet-squat.v1', label: 'Goblet squat' },
        replacementExercise: {
          exerciseVersionId: 'front-squat.v1', label: 'Front squat',
          trainingIntentId: 'knee-dominant-squat', recalibrationRequired: true,
          differences: [
            { kind: 'equipment_setup', description: 'Uses two dumbbells instead of one.' },
            { kind: 'body_position', description: 'The load is held at both shoulders.' },
          ],
        },
        loadOptions,
        affectedFutureSessions: [
          { sessionId: 'session-2', exerciseInstanceId: 'exercise-2', scheduledLocalDate: '2026-09-12' },
          { sessionId: 'session-3', exerciseInstanceId: 'exercise-3', scheduledLocalDate: '2026-09-19' },
        ],
        catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' },
      }],
    },
  }
}

function acceptance(id = proposalId, optionIndex = 1) {
  return {
    schemaVersion: 'training-exercise-swap-acceptance.v1', proposalId: id, assignmentId,
    programRevisionNumber: 4, replacementExerciseVersionId: 'front-squat.v1',
    selectedLoad: loadOptions[optionIndex], affectedSessionIds: ['session-2', 'session-3'],
    recalibration: {
      required: true, reason: 'exercise_variant_changed', loadDisposition: 'starting_target_to_confirm',
    },
  }
}

afterEach(cleanup)
beforeEach(() => {
  vi.unstubAllGlobals()
  const randomUUID = vi.fn().mockReturnValueOnce(requestId).mockReturnValue(nextRequestId)
  vi.stubGlobal('crypto', { randomUUID })
})

describe('TrainingExerciseSwapPanel', () => {
  it('shows authored differences and exact load bases without preselecting or changing prior sessions', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true })
    const fetchMock = vi.fn().mockResolvedValue(Response.json(projection()))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))

    expect(await screen.findByRole('heading', { name: 'Front squat' })).toBeTruthy()
    expect(screen.getByText(/Uses two dumbbells instead of one/)).toBeTruthy()
    expect(screen.getByText(/does not infer equivalent strength/)).toBeTruthy()
    expect(screen.getByText(/Earlier and already-started sessions remain unchanged/)).toBeTruthy()
    expect((screen.getByLabelText('10 kg · one dumbbell total · held with two hands') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('12.5 kg · per hand · two dumbbells') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Accept selected starting target' }) as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    })
    expect(screen.getByText('12.5 kg · per hand · two dumbbells').style.overflowWrap).toBe('anywhere')
    expect((screen.getByRole('group', { name: 'Starting target to confirm' }) as HTMLFieldSetElement).style.minWidth).toBe('0')
  })

  it('retries an ambiguous acceptance with the exact request ID and selected option', async () => {
    const onAccepted = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(projection()))
      .mockResolvedValueOnce(Response.json({ error: 'temporary' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(acceptance()))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" onAccepted={onAccepted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
    fireEvent.click(await screen.findByLabelText('12.5 kg · per hand · two dumbbells'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected starting target' }))

    expect(await screen.findByText(/Save not confirmed/)).toBeTruthy()
    expect((screen.getByLabelText('10 kg · one dumbbell total · held with two hands').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry same acceptance' }))

    expect(await screen.findByText('Exercise swap confirmed in program revision 4.')).toBeTruthy()
    const firstBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const retryBody = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(firstBody).toEqual({ requestId, selectedLoadOptionIndex: 1 })
    expect(retryBody).toEqual(firstBody)
    expect(onAccepted).toHaveBeenCalledWith(assignmentId, 4)
  })

  it('clears a stale selection and requires a fresh explicit choice after refresh', async () => {
    const freshProposalId = '44444444-4444-4444-8444-444444444444'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(projection()))
      .mockResolvedValueOnce(Response.json(
        { error: 'exercise_swap_source_stale', action: 'refresh_exercise_swaps' },
        { status: 409 },
      ))
      .mockResolvedValueOnce(Response.json(projection(freshProposalId)))
      .mockResolvedValueOnce(Response.json(acceptance(freshProposalId, 0)))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
    fireEvent.click(await screen.findByLabelText('12.5 kg · per hand · two dumbbells'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected starting target' }))

    expect(await screen.findByText(/proposal is out of date/)).toBeTruthy()
    expect((screen.getByLabelText('12.5 kg · per hand · two dumbbells') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh alternatives' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect((screen.getByLabelText('10 kg · one dumbbell total · held with two hands') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByLabelText('10 kg · one dumbbell total · held with two hands'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected starting target' }))
    expect(await screen.findByText('Exercise swap confirmed in program revision 4.')).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ requestId, selectedLoadOptionIndex: 1 })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ requestId: nextRequestId, selectedLoadOptionIndex: 0 })
  })

  it('does not confirm a mismatched receipt and explains closed or unauthorized results', async () => {
    const onAccepted = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(projection()))
      .mockResolvedValueOnce(Response.json(acceptance('55555555-5555-4555-8555-555555555555')))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" onAccepted={onAccepted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
    fireEvent.click(await screen.findByLabelText('12.5 kg · per hand · two dumbbells'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected starting target' }))
    expect(await screen.findByText(/response did not match this proposal/)).toBeTruthy()
    expect(screen.queryByText(/swap confirmed/)).toBeNull()
    expect(onAccepted).not.toHaveBeenCalled()

    unmount()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    const forbidden = render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
    expect(await screen.findByText(/available only to the athlete or the coach who owns this program/)).toBeTruthy()

    forbidden.unmount()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-exercise-swap-projection.v1',
      result: { kind: 'no_reviewed_alternative', proposals: [] },
    })))
    render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
    expect(await screen.findByText('No reviewed alternative is available')).toBeTruthy()
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy()
  })
})


describe('dedicated exercise-swap load bases', () => {
  const cases = [
    {
      loadBasis: 'bodyweight_external', implementCount: 0,
      holdingConfiguration: 'bodyweight_plus_external_load', value: '0',
      label: '0 kg · external load only · excludes body mass',
    },
    {
      loadBasis: 'machine_assistance', implementCount: 1,
      holdingConfiguration: 'machine_assistance', value: '12.5',
      label: '12.5 kg · machine assistance · less assistance is harder',
    },
  ] as const

  for (const item of cases) {
    it(`shows and explicitly accepts ${item.loadBasis} with its exact policy`, async () => {
      const option = {
        optionIndex: 0, equipmentId: 'dedicated-test-equipment',
        loadBasis: item.loadBasis, implementCount: item.implementCount,
        holdingConfiguration: item.holdingConfiguration,
        quantity: { entered: { value: item.value, unit: 'kg' }, canonicalKg: item.value },
        bodyweightAssistancePolicy: { policyId: 'test-rep-only', policyVersion: '1' },
      }
      const base = projection()
      const offered = { ...base, result: { ...base.result, proposals: [{ ...base.result.proposals[0], loadOptions: [option] }] } }
      const onAccepted = vi.fn()
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(Response.json(offered))
        .mockResolvedValueOnce(Response.json({ ...acceptance(), selectedLoad: option }))
      vi.stubGlobal('fetch', fetchMock)
      render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" onAccepted={onAccepted} />)
      fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
      const control = await screen.findByLabelText(item.label)
      expect((control as HTMLInputElement).checked).toBe(false)
      expect((screen.getByRole('button', { name: 'Accept selected starting target' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(control)
      fireEvent.click(screen.getByRole('button', { name: 'Accept selected starting target' }))
      await screen.findByText('Exercise swap confirmed in program revision 4.')
      expect(onAccepted).toHaveBeenCalledWith(assignmentId, 4)
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ requestId, selectedLoadOptionIndex: 0 })
    })
  }

  it('does not confirm a receipt that substitutes a different dedicated policy', async () => {
    const option = {
      optionIndex: 0, equipmentId: 'dedicated-test-equipment',
      loadBasis: 'bodyweight_external', implementCount: 0,
      holdingConfiguration: 'bodyweight_plus_external_load',
      quantity: { entered: { value: '0', unit: 'kg' }, canonicalKg: '0' },
      bodyweightAssistancePolicy: { policyId: 'test-rep-only', policyVersion: '1' },
    }
    const base = projection()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ ...base, result: { ...base.result, proposals: [{ ...base.result.proposals[0], loadOptions: [option] }] } }))
      .mockResolvedValueOnce(Response.json({ ...acceptance(), selectedLoad: { ...option, bodyweightAssistancePolicy: { policyId: 'different-test-policy', policyVersion: '1' } } })))
    const onAccepted = vi.fn()
    render(<TrainingExerciseSwapPanel sessionId="session-1" exerciseInstanceId="exercise-1" onAccepted={onAccepted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }))
    fireEvent.click(await screen.findByLabelText('0 kg · external load only · excludes body mass'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected starting target' }))
    await screen.findByText(/Save not confirmed/)
    expect(onAccepted).not.toHaveBeenCalled()
  })
})
