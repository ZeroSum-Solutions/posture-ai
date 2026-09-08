// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingProgressionPanel from './TrainingProgressionPanel'

afterEach(cleanup)
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '44444444-4444-4444-8444-444444444444') })
})

const sessionId = 'session-1'
const exerciseInstanceId = 'exercise-1'
const proposalId = '33333333-3333-4333-8333-333333333333'

function proposal({
  basis = 'dumbbell_single_implement',
  value = '12.5',
  unit = 'kg',
  context = { kind: 'live' },
}: {
  basis?: 'barbell_total' | 'dumbbell_per_hand' | 'dumbbell_single_implement' | 'machine_stack'
  value?: string
  unit?: 'kg' | 'lb'
  context?: { kind: 'live' } | {
    kind: 'synthetic_simulation'
    simulationRunId: string
    fixtureId: string
    fixtureHash: string
    label: 'Practice data' | 'Simulation'
  }
} = {}) {
  return {
    schemaVersion: 'training-progression-projection.v1',
    result: {
      kind: 'proposal', proposalId,
      target: {
        assignmentId: 'assignment-1', baseProgramRevisionNumber: 2,
        sessionId: 'session-2', exerciseInstanceId: 'exercise-2', scheduledLocalDate: '2026-09-15',
      },
      decision: {
        kind: 'load_proposal', status: 'proposed', policyVersion: 'strength-progression-v1',
        executionContext: context, decisionKey: 'decision-1', subjectId: 'subject-1',
        prescriptionId: 'prescription-1', exerciseVersionId: 'exercise-version-1',
        equipmentId: 'dumbbells-1', loadBasis: basis, programRevisionId: 'program-2',
        sourceProfileRevisionId: 'profile-2', sourceEligibilityRevisionId: 'eligibility-2',
        loadEpoch: 1, reasonCodes: ['two_ceiling_successes'],
        sourceExposureRevisionIds: ['exposure-1', 'exposure-2'], sourceAcknowledgementRevisionIds: [],
        proposal: {
          load: {
            equipmentId: 'dumbbells-1', basis,
            quantity: { entered: { value, unit }, canonicalKg: unit === 'kg' ? value : '37.3079724325' },
          },
          targetReps: [8, 8, 8],
        },
      },
    },
  }
}

describe('TrainingProgressionPanel', () => {
  it('requests from saved identities only and renders exact single-implement targets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(proposal()))
    vi.stubGlobal('fetch', fetchMock)

    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))

    await screen.findByText('12.5 kg · one dumbbell total')
    expect(screen.getByText('8 / 8 / 8 reps')).toBeTruthy()
    expect(screen.getByText('2026-09-15')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/training/progression/proposals', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json' },
    }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessionId, exerciseInstanceId })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('load')
    expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeTruthy()
  })

  it.each([
    ['barbell_total', '82.25 lb · total on the bar'],
    ['dumbbell_per_hand', '82.25 lb · per hand'],
    ['dumbbell_single_implement', '82.25 lb · one dumbbell total'],
    ['machine_stack', '82.25 lb · machine stack'],
  ] as const)('labels exact entered %s loads without calculating tonnage', async (basis, label) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(proposal({ basis, value: '82.25', unit: 'lb' }))))
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))

    expect(await screen.findByText(label)).toBeTruthy()
    expect(screen.queryByText(/164\.5/)).toBeNull()
    expect(screen.queryByText(/37\.3/)).toBeNull()
  })

  it('shows simulation provenance from the decision and accepts only the proposal ID plus request ID', async () => {
    const context = {
      kind: 'synthetic_simulation' as const,
      simulationRunId: '55555555-5555-4555-8555-555555555555',
      fixtureId: 'synthetic-progression-1', fixtureHash: 'a'.repeat(64), label: 'Practice data' as const,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(proposal({ context })))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'training-progression-acceptance.v1', proposalId,
        assignmentId: 'assignment-1', programRevisionNumber: 3,
        targetSessionId: 'session-2', targetExerciseInstanceId: 'exercise-2',
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('Practice data · Simulation')
    fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))

    await screen.findByText('Suggestion accepted for the next target.')
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/training/progression/proposals/${proposalId}/accept`)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      requestId: '44444444-4444-4444-8444-444444444444',
    })
  })

  it('renders a human hold reason and never offers acceptance for a no-change decision', async () => {
    const held = proposal()
    const { proposal: ignoredProposal, ...decisionAudit } = held.result.decision
    expect(ignoredProposal).toBeDefined()
    const heldProjection = {
      schemaVersion: held.schemaVersion,
      result: {
      kind: 'not_proposed', proposalId: null, target: held.result.target,
      decision: {
        ...decisionAudit,
        kind: 'hold', status: 'not_proposed', reasonCodes: ['effort_unknown_hold'],
      },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(heldProjection)))

    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))

    await screen.findByText('Keep the current target')
    expect(screen.getByText(/Effort was not recorded clearly enough/)).toBeTruthy()
    expect(screen.getByText(/Nothing was changed or accepted/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
  })

  it('preserves a stale suggestion until an explicit refresh returns the current projection', async () => {
    const refreshed = proposal({ value: '15' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(proposal()))
      .mockResolvedValueOnce(Response.json({ error: 'progression_source_stale', action: 'refresh_progression' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(refreshed))
    vi.stubGlobal('fetch', fetchMock)

    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('12.5 kg · one dumbbell total')
    fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))

    await screen.findByText(/This suggestion is out of date/)
    expect(screen.getByText('12.5 kg · one dumbbell total')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh suggestion' }))
    await screen.findByText('15 kg · one dumbbell total')
  })

  it('keeps the suggestion visible when coach permission is denied', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(proposal()))
      .mockResolvedValueOnce(Response.json({ error: 'progression_proposal_forbidden' }, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('12.5 kg · one dumbbell total')
    fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))

    await screen.findByText(/An authorized coach must accept this suggestion/)
    expect(screen.getByText('12.5 kg · one dumbbell total')).toBeTruthy()
    expect(screen.queryByText(/accepted for the next target/i)).toBeNull()
  })
})
