// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingSessionPlayer from './TrainingSessionPlayer'
import { TrainingRevisionConflict, type TrainingSessionProjection } from './TrainingSessionPlayer.gateway'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), start: vi.fn(), saveSet: vi.fn(), saveConditioning: vi.fn(), complete: vi.fn(),
}))

vi.mock('./TrainingSessionPlayer.gateway', async importOriginal => {
  const original = await importOriginal<typeof import('./TrainingSessionPlayer.gateway')>()
  return {
    ...original,
    readTrainingSession: mocks.read,
    startTrainingSession: mocks.start,
    saveTrainingSet: mocks.saveSet,
    saveTrainingConditioning: mocks.saveConditioning,
    completeTrainingSession: mocks.complete,
  }
})

const session = {
  id: 'session-1', subject_id: '10000000-0000-4000-8000-000000000001', assignment_id: 'assignment-1',
  session_kind: 'strength' as const, revision: 2, state: 'in_progress' as const,
  scheduled_local_date: '2026-09-14', athlete_timezone: 'UTC', stopped_for_symptoms: false,
  updated_at: '2026-09-14T00:00:00Z',
}
const acceptedLoad = {
  loadBasis: 'dumbbell_single_implement' as const,
  quantity: { entered: { value: '7.5', unit: 'kg' as const }, canonicalKg: '7.5' },
}
const liveContext = { kind: 'live' as const }
const strengthProjection = {
  schemaVersion: 'training-session-projection.v1',
  session,
  prescription: {
    schemaVersion: 'training-session-prescription.v1', sessionId: 'session-1',
    executionContext: liveContext,
    exercises: [{
      progression: { side: 'bilateral' },
      exerciseInstanceId: 'exercise-1', setIds: ['set-1', 'set-2'], repRange: { minimum: 8, maximum: 10 },
      targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120, acceptedInitialLoad: acceptedLoad,
    }],
  },
  currentActuals: [], currentConditioningActual: null,
  executionContext: liveContext,
  exerciseDisplay: { 'exercise-1': { label: 'Goblet squat', textInstruction: 'Hold one dumbbell at the chest.', mediaStatus: 'missing' } },
  conditioningDisplay: null,
} as unknown as TrainingSessionProjection

const conditioningProjection = {
  ...strengthProjection,
  session: { ...session, session_kind: 'conditioning' as const },
  prescription: {
    schemaVersion: 'training-conditioning-session-prescription.v1', sessionId: 'session-1',
    executionContext: liveContext,
    acceptedBout: { acceptedDurationSeconds: 600, effortCue: 'Stored internal cue.' },
  },
  exerciseDisplay: {},
  conditioningDisplay: { label: 'Continuous walking', effortCue: 'Keep a conversational pace.' },
} as unknown as TrainingSessionProjection

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset())
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TrainingSessionPlayer', () => {
  it('uses prescribed rest and catches up from elapsed wall time after interval delivery is delayed', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    expect(screen.getByRole('timer', { name: 'Rest time remaining 2 minutes' }).textContent).toBe('2:00')
    fireEvent.click(screen.getByRole('button', { name: 'Start rest timer' }))
    act(() => {
      now = 30_000
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('timer', { name: 'Rest time remaining 1 minute 30 seconds' }).textContent).toBe('1:30')

    act(() => {
      now = 120_000
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('timer', { name: 'Rest time remaining 0 seconds' }).textContent).toBe('0:00')
    expect(screen.getByText('Rest complete. Begin the next set when ready.')).toBeTruthy()
  })

  it('pauses without consuming time, then resumes and resets to the prescribed duration', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    fireEvent.click(screen.getByRole('button', { name: 'Start rest timer' }))
    act(() => {
      now = 30_000
      document.dispatchEvent(new Event('visibilitychange'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pause rest timer' }))
    act(() => {
      now = 90_000
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('timer', { name: 'Rest time remaining 1 minute 30 seconds' }).textContent).toBe('1:30')

    fireEvent.click(screen.getByRole('button', { name: 'Resume rest timer' }))
    act(() => {
      now = 120_000
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('timer', { name: 'Rest time remaining 1 minute' }).textContent).toBe('1:00')
    fireEvent.click(screen.getByRole('button', { name: 'Reset rest timer' }))
    expect(screen.getByRole('timer', { name: 'Rest time remaining 2 minutes' }).textContent).toBe('2:00')
    expect(screen.getByRole('button', { name: 'Start rest timer' })).toBeTruthy()
  })

  it('skips rest without logging a set, completing the session, or changing progression', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getByRole('button', { name: 'Skip rest timer' }))

    expect(screen.getByRole('timer', { name: 'Rest time remaining 0 seconds' }).textContent).toBe('0:00')
    expect(screen.getByText('Rest skipped. Begin the next set when ready.')).toBeTruthy()
    expect(mocks.saveSet).not.toHaveBeenCalled()
    expect(mocks.saveConditioning).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('shows accepted progression targets for each set while preserving logged reps', async () => {
    const projection = structuredClone(strengthProjection)
    if (projection.prescription?.schemaVersion !== 'training-session-prescription.v1') throw new Error('strength fixture required')
    projection.prescription.exercises[0].targetReps = [9, 10]
    mocks.read.mockResolvedValue(projection)
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Target: 9 reps')
    expect(screen.getByText('Target: 10 reps')).toBeTruthy()
    expect(screen.getAllByRole('spinbutton', { name: 'Reps' }).map(input => (input as HTMLInputElement).value)).toEqual(['9', '10'])
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Reps' })[0], { target: { value: '7' } })
    mocks.saveSet.mockResolvedValue({ revision: 3, state: 'in_progress' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledWith(expect.objectContaining({ actual: expect.objectContaining({ reps: 7 }) })))
  })

  it('persistently identifies a direct synthetic session URL as practice data', async () => {
    const practiceContext = {
      kind: 'synthetic_simulation' as const,
      simulationRunId: '20000000-0000-4000-8000-000000000001',
      fixtureId: 'fixture-1', fixtureHash: 'a'.repeat(64), label: 'Practice data' as const,
    }
    mocks.read.mockResolvedValue({
      ...strengthProjection,
      session: { ...strengthProjection.session, state: 'scheduled' },
      executionContext: practiceContext,
      prescription: null,
    })

    render(<TrainingSessionPlayer sessionId="session-1" />)

    await screen.findByText('Practice data · Simulation')
    expect(screen.getByText('This session belongs to the private sample workspace.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy()
  })

  it.each(['left', 'right', 'not_applicable'] as const)('logs the authored %s side', async side => {
    const projection = structuredClone(strengthProjection)
    if (projection.prescription?.schemaVersion !== 'training-session-prescription.v1') throw new Error('strength fixture required')
    projection.prescription.exercises[0].progression!.side = side
    mocks.read.mockResolvedValue(projection)
    mocks.saveSet.mockResolvedValue({ revision: 3, state: 'in_progress' })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledWith(expect.objectContaining({
      actual: expect.objectContaining({ side }),
    })))
  })

  it('does not invent a side when legacy metadata is missing', async () => {
    const projection = structuredClone(strengthProjection)
    if (projection.prescription?.schemaVersion !== 'training-session-prescription.v1') throw new Error('strength fixture required')
    delete projection.prescription.exercises[0].progression
    mocks.read.mockResolvedValue(projection)
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await screen.findByText('Exercise side is unavailable. Refresh the session before logging.')
    expect(mocks.saveSet).not.toHaveBeenCalled()
  })

  it('shows prescribed exact semantics and saves entered load, reps and RIR explicitly', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-1', sessionId: 'session-1',
      revision: 3, state: 'in_progress', event: {
        setId: 'set-1', quantity: { entered: { value: '8.75', unit: 'kg' }, canonicalKg: '8.75' },
        reps: 9, rir: 2, symptomState: 'adverse_reported',
      },
    })
    render(<TrainingSessionPlayer sessionId="session-1" />)

    await screen.findByText('Goblet squat')
    expect(screen.getByText('Hold one dumbbell at the chest.')).toBeTruthy()
    expect(screen.getByText(/7.5 kg · one dumbbell total · 8–10 reps · RIR 2–3/)).toBeTruthy()
    expect((screen.getAllByLabelText('RIR')[0] as HTMLSelectElement).value).toBe('unknown')
    expect(screen.getByRole('button', { name: 'Finish with 2 omissions' })).toBeTruthy()
    const loads = screen.getAllByLabelText('Load')
    fireEvent.change(loads[0], { target: { value: '8.75' } })
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '9' } })
    fireEvent.change(screen.getAllByLabelText('RIR')[0], { target: { value: '2' } })
    fireEvent.change(screen.getAllByLabelText('During this set')[0], { target: { value: 'adverse_reported' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])

    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledTimes(1))
    expect(mocks.saveSet).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', setId: 'set-1', expectedRevision: 2,
      actual: expect.objectContaining({
        quantity: { entered: { value: '8.75', unit: 'kg' }, canonicalKg: '8.75' }, reps: 9, rir: 2,
        symptomState: 'adverse_reported',
      }),
    }))
    expect(await screen.findByText('Progress saved.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/Do not continue this session/)
    expect(screen.getByRole('button', { name: 'Stop session' })).toBeTruthy()
  })

  it('saves conditioning actuals separately before explicit completion', async () => {
    mocks.read.mockResolvedValue(conditioningProjection)
    mocks.saveConditioning.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-1', sessionId: 'session-1',
      revision: 3, state: 'in_progress', conditioningEvent: { durationSeconds: 720 },
    })
    mocks.complete.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-2', sessionId: 'session-1',
      revision: 4, state: 'completed', missingSetCount: 0,
    })
    render(<TrainingSessionPlayer sessionId="session-1" />)

    await screen.findByText(/Continuous walking · 10 minute starting target/)
    expect(screen.getByText('Keep a conversational pace.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Actual duration in minutes'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Perceived effort'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save conditioning' }))

    await waitFor(() => expect(mocks.saveConditioning).toHaveBeenCalledWith(expect.objectContaining({
      actual: expect.objectContaining({ durationSeconds: 720, perceivedEffort: 4 }),
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Finish session' }))
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      sessionId: 'session-1', expectedRevision: 3, finishMode: 'complete',
    }))
    expect(await screen.findByText('Session complete.')).toBeTruthy()
  })

  it('reloads a newer saved set after a revision conflict', async () => {
    const current = {
      ...strengthProjection,
      session: { ...strengthProjection.session, revision: 4 },
      currentActuals: [{
        eventRevision: 2, setId: 'set-1', quantity: { entered: { value: '9.5', unit: 'kg' }, canonicalKg: '9.5' },
        reps: 10, rir: 1, symptomState: 'none',
      }],
    } as unknown as TrainingSessionProjection
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet.mockRejectedValue(new TrainingRevisionConflict(current))
    render(<TrainingSessionPlayer sessionId="session-1" />)

    await screen.findByText('Goblet squat')
    const load = screen.getAllByLabelText('Load')[0] as HTMLInputElement
    fireEvent.change(load, { target: { value: '10' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])

    await waitFor(() => {
      const reloadedLoad = screen.getAllByLabelText('Load')[0] as HTMLInputElement
      expect(reloadedLoad.value).toBe('9.5')
    })
    expect(screen.getByText(/Latest saved values are loaded/)).toBeTruthy()
  })

  it('does not let a late lower-revision acknowledgement roll the session backward', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-1', sessionId: 'session-1',
      revision: 1, state: 'in_progress', event: {
        setId: 'set-1', quantity: acceptedLoad.quantity, reps: 8, rir: 'unknown', symptomState: 'none',
      },
    })
    mocks.complete.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-2', sessionId: 'session-1',
      revision: 3, state: 'completed_with_omissions', missingSetCount: 2,
    })
    render(<TrainingSessionPlayer sessionId="session-1" />)

    await screen.findByText('Goblet squat')
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await screen.findByText('Progress saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Finish with 2 omissions' }))

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      sessionId: 'session-1', expectedRevision: 2, finishMode: 'finish_with_omissions',
    }))
  })

  it('labels edits to persisted actuals as explicit corrections', async () => {
    mocks.read.mockResolvedValue({
      ...strengthProjection,
      session: { ...strengthProjection.session, state: 'completed' },
      currentActuals: [{
        eventRevision: 1, setId: 'set-1', quantity: acceptedLoad.quantity,
        reps: 8, rir: 2, symptomState: 'none',
      }],
    })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '9' } })

    expect(screen.getByRole('button', { name: 'Correct saved set' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Set 2' }).textContent).toMatch(/Not recorded.*Omitted when finished/)
    expect(screen.getAllByRole('button', { name: /saved set|Save set/i })).toHaveLength(1)
  })

  it('renders an omitted terminal conditioning actual as read-only', async () => {
    mocks.read.mockResolvedValue({
      ...conditioningProjection,
      session: { ...conditioningProjection.session, state: 'completed_with_omissions' },
      currentConditioningActual: null,
    })
    render(<TrainingSessionPlayer sessionId="session-1" />)

    await screen.findByText('Omitted when finished.')
    expect(screen.getByText('Not recorded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Save conditioning|Correct saved conditioning/ })).toBeNull()
  })

  it('labels a terminal conditioning edit as an explicit correction', async () => {
    mocks.read.mockResolvedValue({
      ...conditioningProjection,
      session: { ...conditioningProjection.session, state: 'completed' },
      currentConditioningActual: {
        eventRevision: 1, durationSeconds: 600, perceivedEffort: 3, symptomState: 'none',
      },
    })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText(/Continuous walking · 10 minute starting target/)

    fireEvent.change(screen.getByLabelText('Perceived effort'), { target: { value: '4' } })

    expect(screen.getByRole('button', { name: 'Correct saved conditioning' })).toBeTruthy()
  })
})
