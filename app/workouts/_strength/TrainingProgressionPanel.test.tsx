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

const recoveryReport = {
  schemaVersion: 'recovery-context.v1' as const,
  capturedAt: '2026-09-09T08:00:00.000Z',
  sleep: 'concern_reported' as const,
  fatigue: 'unknown' as const,
  schedule: 'no_concern_reported' as const,
  illness: 'unknown' as const,
}

function recoveryReview(
  choice: 'hold' | 'request_review' | 'new_familiarization' = 'hold',
  report = recoveryReport,
) {
  const reason = {
    hold: 'explicit_recovery_hold',
    request_review: 'explicit_recovery_review_requested',
    new_familiarization: 'explicit_new_familiarization_requested',
  } as const
  return {
    schemaVersion: 'training-progression-projection.v1',
    result: {
      kind: 'recovery_review', proposalId: null,
      requestBinding: { sessionId, exerciseInstanceId },
      record: {
        schemaVersion: 'training-recovery-context-record.v1',
        recordId: '55555555-5555-4555-8555-555555555555',
        subjectId: 'subject-1', assignmentId: 'assignment-1',
        sourceProgramRevisionNumber: 2, sourceProgramHash: 'a'.repeat(64),
        sourceSessionId: sessionId, sourceSessionRevision: 3,
        exerciseInstanceId, progressionSeriesId: 'series-1',
        executionContext: { kind: 'live' },
        context: { report, choice },
        recordedAt: '2026-09-09T08:00:01.000Z',
      },
      review: { kind: choice, reason: reason[choice], report },
    },
  }
}

describe('TrainingProgressionPanel', () => {
  it.each([
    ['bodyweight_external', '0', 'external load added to bodyweight'],
    ['machine_assistance', '30.125', 'machine assistance'],
  ] as const)('renders a dedicated %s rep proposal without changing its load', async (basis, value, label) => {
    const quantity = { entered: { value, unit: 'kg' }, canonicalKg: value }
    const response = {
      ...proposal(),
      result: {
        ...proposal().result,
        executionContext: { kind: 'synthetic_simulation', simulationRunId: '55555555-5555-4555-8555-555555555555', fixtureId: 'fixture-1', fixtureHash: 'a'.repeat(64), label: 'Practice data' },
        decision: {
          schemaVersion: 'bodyweight-assistance-progression-decision.v1',
          policyId: 'policy-1', policyVersion: '1', sourceExposureRevisionId: 'exposure-1',
          kind: 'rep_proposal', status: 'proposed', reason: 'one_rep_progression', loadChange: 'none',
          preservedLoad: basis === 'bodyweight_external'
            ? { loadBasis: basis, equipmentId: 'equipment-1', externalLoad: quantity }
            : { loadBasis: basis, equipmentId: 'equipment-1', assistance: quantity },
          targetReps: [9, 8, 8],
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)))
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText(`${value} kg · ${label}`)
    expect(screen.getByText('9 / 8 / 8 reps')).toBeTruthy()
    expect(screen.getByText('Practice data · Simulation')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeTruthy()
    expect(screen.queryByText('Suggested load and reps')).toBeNull()
  })

  it('renders a dedicated policy hold without offering acceptance', async () => {
    const response = {
      ...proposal(), result: {
        ...proposal().result, kind: 'not_proposed', proposalId: null,
        executionContext: { kind: 'live' },
        decision: {
          schemaVersion: 'bodyweight-assistance-progression-decision.v1',
          policyId: 'policy-1', policyVersion: '1', sourceExposureRevisionId: 'exposure-1',
          kind: 'hold', status: 'not_proposed', reason: 'policy_unavailable_hold',
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)))
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('A reviewed progression rule is not available for this setup.')
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review starting settings' })).toBeNull()
  })

  it.each(['resistance', 'assistance'])('connects a %s too-easy decision to explicit familiarization without automatically requesting a load', async mode => {
    const base = proposal()
    const { proposal: _suggestion, ...audit } = base.result.decision
    const decision = mode === 'resistance' ? {
      ...audit, kind: 'recalibrate', status: 'not_proposed', reasonCodes: ['effort_too_easy_recalibration'],
    } : {
      schemaVersion: 'bodyweight-assistance-progression-decision.v1',
      policyId: 'policy-1', policyVersion: '1', sourceExposureRevisionId: 'exposure-1',
      kind: 'recalibrate', status: 'not_proposed', reason: 'effort_too_easy_recalibration',
    }
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      schemaVersion: base.schemaVersion,
      result: { kind: 'not_proposed', proposalId: null, target: base.result.target,
        executionContext: { kind: 'live' }, decision },
    }))
    vi.stubGlobal('fetch', fetcher)
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByRole('button', { name: 'Review starting settings' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Confirm new setting' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
  })

  it('shows a prior-session hold bound by the server to the current review request', async () => {
    const saved = recoveryReview()
    saved.result.record.sourceSessionId = 'prior-session'
    saved.result.record.exerciseInstanceId = 'prior-exercise'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(saved)))
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('Keep the current target')
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
  })

  it('rejects a saved hold projected for a different current request', async () => {
    const saved = recoveryReview()
    saved.result.requestBinding.sessionId = 'unrelated-session'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(saved)))
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('The recovery receipt did not match this report. Retry the same report to confirm its outcome.')
    expect(screen.queryByText('Keep the current target')).toBeNull()
  })

  it('shows a saved hold when reviewing after reload without a new report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(recoveryReview()))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('Keep the current target')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('recoveryContext')
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Review recorded performance with a new report' })).toBeTruthy()
  })

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

  it('retries one frozen recovery request after an ambiguous response and locks its fields', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('connection ended after send'))
      .mockImplementationOnce((_url: string, init: RequestInit) => Response.json(recoveryReview(
        'hold', JSON.parse(String(init.body)).recoveryContext.context.report,
      )))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add recovery check-in' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Sleep' }), { target: { value: 'concern_reported' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'What would you like to review?' }), { target: { value: 'hold' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))

    await screen.findByText('Recovery review is not confirmed. Retry the same report to check whether it was saved.')
    expect((screen.getByRole('combobox', { name: 'Sleep' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Remove recovery check-in' })).toBeNull()
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(firstBody.recoveryContext).toMatchObject({
      requestId: '44444444-4444-4444-8444-444444444444',
      context: { report: { sleep: 'concern_reported' }, choice: 'hold' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Retry same recovery report' }))
    await screen.findByText('Keep the current target')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(firstBody)
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
    expect(screen.getByText(/No numeric load, rep, or session change/)).toBeTruthy()
  })

  it.each([
    ['request_review', 'Program review requested'],
    ['new_familiarization', 'Fresh starting point requested'],
  ] as const)('renders explicit %s recovery review without numeric acceptance', async (choice, heading) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => Response.json(recoveryReview(
      choice, JSON.parse(String(init.body)).recoveryContext.context.report,
    ))))
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add recovery check-in' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'What would you like to review?' }), { target: { value: choice } })
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))

    await screen.findByText(heading)
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
    expect(screen.getByText(/No numeric load, rep, or session change/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review easier settings' }) !== null).toBe(choice === 'new_familiarization')
  })

  it('requires an explicit new report before returning from a hold to performance review', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => Response.json(recoveryReview(
        'hold', JSON.parse(String(init.body)).recoveryContext.context.report,
      )))
      .mockResolvedValueOnce(Response.json(proposal()))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add recovery check-in' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Sleep' }), { target: { value: 'concern_reported' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'What would you like to review?' }), { target: { value: 'hold' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('Keep the current target')

    fireEvent.click(screen.getByRole('button', { name: 'Review recorded performance with a new report' }))
    expect((screen.getByRole('combobox', { name: 'What would you like to review?' }) as HTMLSelectElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))
    await screen.findByText('Suggested load and reps')
    const resumedBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(resumedBody.recoveryContext.context).not.toHaveProperty('choice')
    expect(resumedBody.recoveryContext.context.report.sleep).toBe('concern_reported')
  })

  it('rejects a recovery receipt bound to a different source exercise and keeps the exact report pending', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const mismatched = recoveryReview(
        'hold', JSON.parse(String(init.body)).recoveryContext.context.report,
      )
      mismatched.result.record.exerciseInstanceId = 'exercise-other'
      return Response.json(mismatched)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TrainingProgressionPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add recovery check-in' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'What would you like to review?' }), { target: { value: 'hold' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review next target' }))

    await screen.findByText('The recovery receipt did not match this report. Retry the same report to confirm its outcome.')
    expect(screen.getByRole('button', { name: 'Retry same recovery report' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).toBeNull()
    expect((screen.getByRole('combobox', { name: 'Sleep' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  })
})
