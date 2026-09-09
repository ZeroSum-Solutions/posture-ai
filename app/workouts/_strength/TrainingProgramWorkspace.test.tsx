// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingProgramWorkspace from './TrainingProgramWorkspace'

const request = vi.hoisted(() => vi.fn())
vi.mock('./TrainingProgramWorkspace.gateway', () => ({ requestTrainingProgramWorkspace: request }))
vi.mock('./TrainingExerciseSwapPanel', () => ({
  default: ({
    sessionId,
    exerciseInstanceId,
    onAccepted,
  }: {
    sessionId: string
    exerciseInstanceId: string
    onAccepted: (assignmentId: string, programRevisionNumber: number) => void
  }) => <div data-testid={`swap-panel-${exerciseInstanceId}`} style={{ minWidth: 0 }}>
    <button type="button" onClick={() => onAccepted('assignment-1', 2)}>
      Accept fixture swap for {sessionId}
    </button>
  </div>,
}))

vi.mock('./TrainingConditioningRevisionPanel', () => ({
  default: ({ assignmentId, onAccepted }: { assignmentId: string; onAccepted: (receipt: { assignmentId: string; programRevisionNumber: number }) => void }) => <button type="button" onClick={() => onAccepted({ assignmentId, programRevisionNumber: 2 })}>Accept fixture conditioning revision</button>,
}))

afterEach(cleanup)
beforeEach(() => request.mockReset())

const assignment = {
  assignmentId: 'assignment-1', subjectId: 'subject-1', programMode: 'self_directed', status: 'active',
  cycleLengthWeeks: 12, cycleStartLocalDate: '2026-09-08', revisionNumber: 1, createdAt: '2026-09-08T12:00:00.000Z',
  executionContext: { kind: 'synthetic_simulation', simulationRunId: '45000000-0000-4000-8000-000000000004', fixtureId: 'fixture-1', fixtureHash: 'a'.repeat(64), label: 'Practice data' },
}
const strength = {
  sessionId: 'strength-1', kind: 'strength', state: 'completed_with_omissions', scheduledLocalDate: '2026-09-08', weekNumber: 1, athleteTimezone: 'UTC', revision: 3,
  completedAt: '2026-09-08T15:00:00.000Z', stoppedForSymptoms: false,
  planned: { kind: 'strength', exercises: [{ exerciseInstanceId: 'exercise-1', label: 'Goblet squat', setIds: ['set-1', 'set-2'], targetReps: [8, 8], repRange: { minimum: 6, maximum: 8 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120, side: 'bilateral', load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '12.5', unit: 'kg' }, canonicalKg: '12.5' } } }] },
  actual: { kind: 'strength', prescribedSetCount: 2, recordedSetCount: 1, omittedSetCount: 1, sets: [{ setId: 'set-1', exerciseInstanceId: 'exercise-1', setKind: 'working', workingSetOrdinal: 1, quantity: { entered: { value: '15', unit: 'kg' }, canonicalKg: '15' }, reps: 8, rir: 'unknown', side: 'bilateral', symptomState: 'none', occurredAt: '2026-09-08T14:00:00.000Z' }] },
}
const conditioning = {
  sessionId: 'conditioning-1', kind: 'conditioning', state: 'in_progress', scheduledLocalDate: '2026-09-09', weekNumber: 1, athleteTimezone: 'UTC', revision: 2,
  completedAt: null, stoppedForSymptoms: false,
  planned: { kind: 'conditioning', boutId: 'conditioning-1', label: 'Walking', durationSeconds: 630, effortCue: 'Comfortable pace.' },
  actual: { kind: 'conditioning', recorded: { durationSeconds: 585, perceivedEffort: 4, symptomState: 'none', occurredAt: '2026-09-09T12:00:00.000Z' } },
}
const scheduledStrength = {
  ...strength,
  state: 'scheduled', completedAt: null, revision: 1,
  actual: { kind: 'strength', prescribedSetCount: 2, recordedSetCount: 0, omittedSetCount: 2, sets: [] },
}
const projection = (view: 'today' | 'program' | 'history', sessions: unknown[], nextCursor: string | null = null) => ({
  schemaVersion: 'training-program-workspace.v1', assignment, view, focus: view === 'today' ? 'in_progress' : 'none', sessions, nextCursor,
})

describe('TrainingProgramWorkspace', () => {
  it('keeps simulation provenance visible and renders exact planned versus actual values', async () => {
    request.mockResolvedValueOnce(projection('today', [strength]))
    render(<TrainingProgramWorkspace assignmentId="assignment-1" />)

    await screen.findByText('12-week program')
    expect(screen.getAllByText('Practice data').length).toBeGreaterThan(0)
    expect(screen.getByText(/12.5 kg · one dumbbell total · bilateral · RIR 2–3/)).toBeTruthy()
    expect(screen.getByText(/Set 1: 15 kg · 8 reps · RIR not recorded/)).toBeTruthy()
    expect(screen.getByText(/1 of 2 prescribed working sets recorded · 1 not recorded/)).toBeTruthy()
    expect(screen.queryByText(/Warm-up 1:/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Accept fixture swap/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open session' }).getAttribute('href')).toBe('/train?training_session_id=strength-1')
  })

  it('places swap controls only on scheduled strength exercises and reloads the authoritative revision after acceptance', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true })
    const replaced = {
      ...scheduledStrength,
      planned: {
        ...scheduledStrength.planned,
        exercises: [{ ...scheduledStrength.planned.exercises[0], label: 'Front squat' }],
      },
    }
    request
      .mockResolvedValueOnce(projection('today', [scheduledStrength]))
      .mockResolvedValueOnce({
        ...projection('today', [replaced]),
        assignment: { ...assignment, revisionNumber: 2 },
      })
    render(<TrainingProgramWorkspace assignmentId="assignment-1" />)

    const swap = await screen.findByTestId('swap-panel-exercise-1')
    expect(swap.style.minWidth).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'Accept fixture swap for strength-1' }))

    await screen.findAllByText('Front squat')
    expect(request).toHaveBeenNthCalledWith(1, { assignmentId: 'assignment-1', view: 'today' })
    expect(request).toHaveBeenNthCalledWith(2, { assignmentId: 'assignment-1', view: 'today' })
    expect(screen.queryAllByText('Goblet squat')).toHaveLength(0)
  })

  it('labels planned and recorded warm-ups separately without changing working completion counts', async () => {
    const withWarmup = {
      ...strength,
      planned: {
        ...strength.planned,
        exercises: [{
          ...strength.planned.exercises[0],
          warmupSets: [{
            setId: 'warmup-1', targetReps: 6,
            load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '5.0', unit: 'kg' }, canonicalKg: '5' } },
          }],
        }],
      },
      actual: {
        ...strength.actual,
        recordedSetCount: 0,
        omittedSetCount: 2,
        sets: [{
          setId: 'warmup-1', exerciseInstanceId: 'exercise-1', setKind: 'warmup', workingSetOrdinal: null,
          quantity: { entered: { value: '5.0', unit: 'kg' }, canonicalKg: '5' }, reps: 6, rir: 'unknown',
          side: 'bilateral', symptomState: 'none', occurredAt: '2026-09-08T13:55:00.000Z',
        }],
      },
    }
    request.mockResolvedValueOnce(projection('today', [withWarmup]))
    render(<TrainingProgramWorkspace assignmentId="assignment-1" />)

    await screen.findByText('12-week program')
    expect(screen.getByText('Warm-up 1: 5.0 kg · one dumbbell total · 6 reps')).toBeTruthy()
    expect(screen.getByText(/Warm-up 1: 5.0 kg · 6 reps · RIR not recorded/)).toBeTruthy()
    expect(screen.getByText(/0 of 2 prescribed working sets recorded · 2 not recorded/)).toBeTruthy()
    expect(screen.queryByText(/Set extra/)).toBeNull()
  })

  it('clears the previous assignment immediately when the selected program changes', async () => {
    request.mockResolvedValueOnce(projection('today', [strength])).mockImplementationOnce(() => new Promise(() => {}))
    const view = render(<TrainingProgramWorkspace assignmentId="assignment-1" />)
    await screen.findAllByText('Goblet squat')
    view.rerender(<TrainingProgramWorkspace assignmentId="assignment-2" />)
    expect(screen.queryByText('12-week program')).toBeNull()
    expect(screen.queryAllByText('Goblet squat')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toContain('Loading today')
  })

  it('loads Program and History independently and appends bounded pages without losing sessions', async () => {
    request
      .mockResolvedValueOnce(projection('today', [conditioning]))
      .mockResolvedValueOnce(projection('program', [strength], 'cursor-1'))
      .mockResolvedValueOnce(projection('program', [conditioning]))
      .mockResolvedValueOnce(projection('history', [strength]))
    render(<TrainingProgramWorkspace assignmentId="assignment-1" />)
    await screen.findByText('Your next scheduled session.', {}, { timeout: 2 }).catch(() => screen.findByText('Continue the session already in progress.'))

    fireEvent.click(screen.getByRole('tab', { name: 'Program' }))
    await screen.findAllByText('Goblet squat')
    fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }))
    await screen.findByText('Walking')
    expect(screen.getAllByRole('link', { name: /session/ })).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    await waitFor(() => expect(screen.getByText('Finished with omissions')).toBeTruthy())
    expect(request).toHaveBeenCalledWith({ assignmentId: 'assignment-1', view: 'program', cursor: 'cursor-1' })
  })

  it('surfaces load and pagination failures with a retry that does not erase loaded sessions', async () => {
    request.mockRejectedValueOnce(new Error('The training program could not be loaded.')).mockResolvedValueOnce(projection('today', [strength]))
    render(<TrainingProgramWorkspace assignmentId="assignment-1" />)
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded')
    fireEvent.click(screen.getByRole('button', { name: 'Retry today' }))
    await screen.findAllByText('Goblet squat')

    request.mockResolvedValueOnce(projection('program', [strength], 'cursor-1')).mockRejectedValueOnce(new Error('More sessions could not be loaded.'))
    fireEvent.click(screen.getByRole('tab', { name: 'Program' }))
    await screen.findByRole('button', { name: 'Load more sessions' })
    fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }))
    expect((await screen.findByRole('alert')).textContent).toContain('More sessions could not be loaded.')
    expect(screen.getAllByText('Goblet squat')).toHaveLength(2)
  })

  it('uses the practitioner workspace links when requested and keeps panels keyboard named', async () => {
    request.mockResolvedValueOnce(projection('today', [conditioning]))
    render(<TrainingProgramWorkspace assignmentId="assignment-1" sessionHrefBase="/workouts" backHref="/workouts" />)
    const panel = await screen.findByRole('tabpanel', { name: 'Today' })
    expect(within(panel).getByRole('link', { name: 'Resume session' }).getAttribute('href')).toBe('/workouts?training_session_id=conditioning-1')
    expect(screen.getByRole('link', { name: 'Back to training' }).getAttribute('href')).toBe('/workouts')
  })
})

it('discards an older pagination response after accepted targets refresh the program', async () => {
  let resolveOldPage!: (value: unknown) => void
  request.mockResolvedValueOnce(projection('today', [conditioning]))
    .mockResolvedValueOnce(projection('program', [scheduledStrength], 'old-cursor'))
    .mockImplementationOnce(() => new Promise(resolve => { resolveOldPage = resolve }))
    .mockResolvedValueOnce(projection('program', [{
      ...scheduledStrength,
      planned: { ...scheduledStrength.planned, exercises: [{ ...scheduledStrength.planned.exercises[0], label: 'Accepted replacement' }] },
    }]))
  render(<TrainingProgramWorkspace assignmentId="assignment-1" />)
  await screen.findByText('Walking')
  fireEvent.click(screen.getByRole('tab', { name: 'Program' }))
  await screen.findByRole('button', { name: 'Load more sessions' })
  fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Accept fixture swap for strength-1' }))
  await screen.findAllByText('Accepted replacement')
  await act(async () => { resolveOldPage(projection('program', [scheduledStrength])) })
  expect(screen.getAllByText('Accepted replacement')).toHaveLength(2)
  expect(screen.queryAllByText('Goblet squat')).toHaveLength(0)
})

it('keeps conditioning acceptance visible after refreshed program data replaces the editor', async () => {
  request.mockResolvedValueOnce(projection('today', [conditioning]))
    .mockResolvedValueOnce(projection('program', [conditioning, scheduledStrength]))
    .mockResolvedValueOnce(projection('program', [{ ...conditioning, planned: { ...conditioning.planned, durationSeconds: 661 } }]))
    .mockResolvedValueOnce(projection('history', [strength]))
  render(<TrainingProgramWorkspace assignmentId="assignment-1" />)
  await screen.findByText('Walking')
  expect(screen.queryByRole('button', { name: 'Accept fixture conditioning revision' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Program' }))
  const disclosure = await screen.findByText('Change conditioning activity or schedule')
  fireEvent.click(disclosure)
  await screen.findByRole('button', { name: 'Accept fixture conditioning revision' })
  expect(screen.getAllByRole('button', { name: 'Accept fixture conditioning revision' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Accept fixture conditioning revision' }))
  await screen.findByText('11 min 1s')
  expect(screen.getByRole('status').textContent).toBe('Conditioning changes saved as program revision 2.')
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
  await screen.findAllByText('Goblet squat')
  expect(screen.getByRole('status').textContent).toBe('Conditioning changes saved as program revision 2.')
  expect(screen.queryByRole('button', { name: 'Accept fixture conditioning revision' })).toBeNull()
})

it('keeps conditioning revisions unavailable for inactive assignments', async () => {
  const expired = { ...projection('program', [conditioning]), assignment: { ...assignment, status: 'expired' } }
  request.mockResolvedValueOnce(projection('today', [conditioning])).mockResolvedValueOnce(expired)
  render(<TrainingProgramWorkspace assignmentId="assignment-1" />)
  await screen.findByText('Walking')
  fireEvent.click(screen.getByRole('tab', { name: 'Program' }))
  await screen.findByText('The accepted cycle schedule. Open any session to review or continue it.')
  expect(screen.queryByRole('button', { name: 'Accept fixture conditioning revision' })).toBeNull()
})
