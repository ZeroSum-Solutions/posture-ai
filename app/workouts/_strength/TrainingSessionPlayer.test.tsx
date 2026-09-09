// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTrainingOfflineOutbox,
  type TrainingOfflineStorage,
  type TrainingOfflineStoredEntry,
} from '@/lib/training/offline'
import TrainingSessionPlayer from './TrainingSessionPlayer'
import { TrainingMutationFailure, TrainingRevisionConflict, type TrainingSessionProjection } from './TrainingSessionPlayer.gateway'

type OfflineTestEntry = {
  sequence: number
  fingerprint: string
  status: 'pending' | 'conflict'
  envelope: { requestId: string; [key: string]: unknown }
}

const mocks = vi.hoisted(() => ({
  read: vi.fn(), start: vi.fn(), saveSet: vi.fn(), saveConditioning: vi.fn(), complete: vi.fn(),
}))
const offline = vi.hoisted(() => ({
  entries: [] as OfflineTestEntry[],
  nextSequence: 1,
  enqueue: vi.fn(), list: vi.fn(), drain: vi.fn(), discardConflict: vi.fn(), activateUser: vi.fn(),
  current: null as unknown,
}))
const getUser = vi.hoisted(() => vi.fn())
const authEvents = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  unsubscribe: vi.fn(),
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

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: {
    getUser,
    onAuthStateChange: (callback: typeof authEvents.callback) => {
      authEvents.callback = callback
      return { data: { subscription: { unsubscribe: authEvents.unsubscribe } } }
    },
  } }),
}))

vi.mock('@/lib/training/offline', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/training/offline')>()
  return {
    ...original,
    getTrainingOfflineBrowserOutbox: () => offline.current ?? offline,
    synchronizeTrainingOfflineAuth: vi.fn(async () => {}),
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
const strengthExercise = (() => {
  const prescription = strengthProjection.prescription
  if (!prescription || prescription.schemaVersion !== 'training-session-prescription.v1') {
    throw new Error('Strength fixture requires a strength prescription')
  }
  return prescription.exercises[0]
})()

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
  offline.entries.length = 0
  offline.current = null
  offline.nextSequence = 1
  offline.activateUser.mockReset().mockResolvedValue({ previousUserId: null, clearedCount: 0 })
  offline.enqueue.mockReset().mockImplementation(async input => {
    const existing = offline.entries.find(entry => entry.envelope.requestId === input.requestId)
    if (existing) return existing
    const entry = {
      sequence: offline.nextSequence++, fingerprint: 'a'.repeat(64), status: 'pending' as const,
      envelope: { ...input, schemaVersion: 'training-offline-envelope.v1', queuedAt: '2026-09-14T12:00:00Z' },
    }
    offline.entries.push(entry)
    return entry
  })
  offline.list.mockReset().mockImplementation(async () => structuredClone(offline.entries))
  offline.discardConflict.mockReset().mockImplementation(async requestId => {
    const index = offline.entries.findIndex(entry => entry.envelope.requestId === requestId && entry.status === 'conflict')
    if (index < 0) return false
    offline.entries.splice(index, 1)
    return true
  })
  offline.drain.mockReset().mockImplementation(async replay => {
    let acknowledgedCount = 0
    while (offline.entries[0]) {
      const entry = offline.entries[0]
      const outcome = await replay(entry, new AbortController().signal)
      if (outcome.kind === 'acknowledged') {
        offline.entries.shift()
        acknowledgedCount += 1
        continue
      }
      if (outcome.kind === 'conflict') {
        entry.status = 'conflict'
        return { kind: 'conflict', acknowledgedCount, requestId: entry.envelope.requestId }
      }
      if (outcome.kind === 'rejected') {
        offline.entries.shift()
        return { kind: 'rejected', acknowledgedCount, requestId: entry.envelope.requestId, reason: outcome.reason }
      }
      if (outcome.kind === 'denied') {
        offline.entries.length = 0
        return { kind: 'denied', acknowledgedCount, requestId: entry.envelope.requestId, reason: outcome.reason, clearedCount: 1 }
      }
      return { kind: 'retry_later', acknowledgedCount, requestId: entry.envelope.requestId }
    }
    return { kind: 'drained', acknowledgedCount }
  })
  getUser.mockReset().mockResolvedValue({
    data: { user: { id: '10000000-0000-4000-8000-000000000099' } }, error: null,
  })
  authEvents.callback = null
  authEvents.unsubscribe.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TrainingSessionPlayer', () => {
  it.each([['', '0'], ['1.5', '0'], ['10', ''], ['10', '60'], ['1440', '1']])('rejects ambiguous conditioning duration %j minutes and %j seconds', async (minutes, seconds) => {
    mocks.read.mockResolvedValue(conditioningProjection)
    render(<TrainingSessionPlayer sessionId={session.id} />)
    const input = await screen.findByLabelText('Actual duration in minutes')
    fireEvent.change(input, { target: { value: minutes } })
    fireEvent.change(screen.getByLabelText('Additional seconds'), { target: { value: seconds } })
    fireEvent.click(screen.getByRole('button', { name: 'Save conditioning' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter whole minutes and seconds, up to 24 hours. Seconds must be between 0 and 59.')
    expect(mocks.saveConditioning).not.toHaveBeenCalled()
    expect(offline.enqueue).not.toHaveBeenCalled()
  })

  it('saves exact conditioning seconds without rounding or losing an existing remainder', async () => {
    mocks.read.mockResolvedValue({ ...conditioningProjection, currentConditioningActual: {
      eventRevision: 1, durationSeconds: 725, perceivedEffort: 4, symptomState: 'none',
    } })
    mocks.saveConditioning.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-1', sessionId: session.id,
      revision: 3, state: 'in_progress', conditioningEvent: { durationSeconds: 727 },
    })
    render(<TrainingSessionPlayer sessionId={session.id} />)
    const minutes = await screen.findByLabelText('Actual duration in minutes') as HTMLInputElement
    const seconds = screen.getByLabelText('Additional seconds') as HTMLInputElement
    expect(minutes.value).toBe('12')
    expect(seconds.value).toBe('5')
    fireEvent.change(seconds, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Correct saved conditioning' }))
    await waitFor(() => expect(mocks.saveConditioning).toHaveBeenCalledWith(
      expect.objectContaining({ actual: expect.objectContaining({ durationSeconds: 727 }) }), expect.any(AbortSignal),
    ))
  })

  it.each(['', '1.5', '101', '-1'])('does not save invalid reps %j as a completed set', async value => {
    mocks.read.mockResolvedValue(strengthProjection)
    render(<TrainingSessionPlayer sessionId={session.id} />)
    const set = await screen.findByRole('group', { name: 'Set 1' })
    const input = within(set).getByLabelText('Reps') as HTMLInputElement
    fireEvent.change(input, { target: { value } })
    expect(input.value).toBe(value)
    fireEvent.click(within(set).getByRole('button', { name: 'Save set' }))
    expect((await within(set).findByRole('alert')).textContent).toBe('Enter reps as a whole number from 0 to 100.')
    expect(mocks.saveSet).not.toHaveBeenCalled()
    expect(offline.enqueue).not.toHaveBeenCalled()
  })

  it('keeps an explicitly entered zero distinct from an empty rep field', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-1',
      sessionId: session.id, revision: 3, state: 'in_progress',
    })
    render(<TrainingSessionPlayer sessionId={session.id} />)
    const set = await screen.findByRole('group', { name: 'Set 1' })
    fireEvent.change(within(set).getByLabelText('Reps'), { target: { value: '0' } })
    fireEvent.click(within(set).getByRole('button', { name: 'Save set' }))
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledWith(
      expect.objectContaining({ actual: expect.objectContaining({ reps: 0 }) }), expect.any(AbortSignal),
    ))
  })

  it('keeps legacy strength prescriptions on the working-set path without inventing warm-ups', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    render(<TrainingSessionPlayer sessionId={session.id} />)
    await screen.findByText('Goblet squat')

    expect(screen.queryByRole('heading', { name: 'Warm-up sets' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Working sets' })).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /^Set \d+$/ })).toHaveLength(2)
  })

  it.each([
    ['bodyweight_external', '0', /0 kg added externally · bodyweight only/],
    ['bodyweight_external', '7.5', /7.5 kg added externally/],
    ['machine_assistance', '35', /35 kg assistance from the machine/],
  ] as const)('labels prescribed %s values without body-mass addition or negative encoding', async (loadBasis, value, label) => {
    mocks.read.mockResolvedValue({
      ...strengthProjection,
      prescription: {
        ...strengthProjection.prescription,
        exercises: [{
          ...strengthExercise,
          acceptedInitialLoad: {
            ...strengthExercise.acceptedInitialLoad,
            loadBasis,
            quantity: { entered: { value, unit: 'kg' }, canonicalKg: value },
          },
        }],
      },
    })
    render(<TrainingSessionPlayer sessionId={session.id} />)
    expect(await screen.findByText(label)).toBeTruthy()
  })

  it('renders and logs an authored warm-up with its exact prescribed load, reps, and stable set ID', async () => {
    const withWarmup = {
      ...strengthProjection,
      prescription: {
        ...strengthProjection.prescription,
        exercises: [{
          ...strengthExercise,
          warmupSets: [{
            setId: 'warmup-1',
            targetReps: 6,
            prescribedLoad: {
              entered: { value: '5.0', unit: 'kg' as const },
              canonicalKg: '5',
            },
          }],
        }],
      },
    } as unknown as TrainingSessionProjection
    mocks.read.mockResolvedValue(withWarmup)
    mocks.saveSet.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId: 'request-1', sessionId: session.id,
      revision: 3, state: 'in_progress', missingSetCount: 2,
      setEvent: {
        eventRevision: 1, sessionId: session.id, exerciseInstanceId: 'exercise-1', setId: 'warmup-1',
        setKind: 'warmup', workingSetOrdinal: null,
        quantity: { entered: { value: '5.0', unit: 'kg' }, canonicalKg: '5' },
        reps: 6, rir: 'unknown', symptomState: 'none', side: 'bilateral',
      },
    })
    render(<TrainingSessionPlayer sessionId={session.id} />)
    const warmup = await screen.findByRole('group', { name: 'Warm-up 1' })
    const warmupHeading = screen.getByRole('heading', { name: 'Warm-up sets' })
    const workingHeading = screen.getByRole('heading', { name: 'Working sets' })

    expect(warmupHeading.compareDocumentPosition(workingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(warmup).getByText('Prescribed: 5.0 kg · one dumbbell total · 6 reps')).toBeTruthy()
    expect((within(warmup).getByLabelText('Load') as HTMLInputElement).value).toBe('5.0')
    expect((within(warmup).getByLabelText('Reps') as HTMLInputElement).value).toBe('6')
    expect(within(warmup).queryByRole('button', { name: 'Same as last set' })).toBeNull()

    fireEvent.click(within(warmup).getByRole('button', { name: 'Save warm-up' }))
    await waitFor(() => expect(mocks.saveSet.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sessionId: session.id,
      setId: 'warmup-1',
      expectedRevision: 2,
      actual: expect.objectContaining({
        quantity: { entered: { value: '5.0', unit: 'kg' }, canonicalKg: '5' },
        reps: 6,
        rir: 'unknown',
        side: 'bilateral',
      }),
    })))
  })

  it('counts only working actuals for completion and copies only prior working sets', async () => {
    const withWarmupActual = {
      ...strengthProjection,
      prescription: {
        ...strengthProjection.prescription,
        exercises: [{
          ...strengthExercise,
          warmupSets: [{
            setId: 'warmup-1', targetReps: 6,
            prescribedLoad: { entered: { value: '5', unit: 'kg' as const }, canonicalKg: '5' },
          }],
        }],
      },
      currentActuals: [{
        eventRevision: 1, sessionId: session.id, exerciseInstanceId: 'exercise-1', setId: 'warmup-1',
        setKind: 'warmup' as const, workingSetOrdinal: null,
        quantity: { entered: { value: '5', unit: 'kg' as const }, canonicalKg: '5' },
        reps: 6, rir: 'unknown' as const, symptomState: 'none' as const, side: 'bilateral' as const,
      }],
    } as unknown as TrainingSessionProjection
    mocks.read.mockResolvedValue(withWarmupActual)
    render(<TrainingSessionPlayer sessionId={session.id} />)
    await screen.findByText('Goblet squat')

    expect(screen.getByRole('button', { name: 'Finish with 2 omissions' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Same as last set' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('region', { name: 'Goblet squat rest timer' })).toHaveLength(1)
  })

  it('copies exact entered load, unit, reps and RIR from the prior saved working set without copying symptoms or saving', async () => {
    mocks.read.mockResolvedValue({
      ...strengthProjection,
      currentActuals: [{
        eventRevision: 1, sessionId: session.id, exerciseInstanceId: 'exercise-1', setId: 'set-1', setKind: 'working', workingSetOrdinal: 1,
        quantity: { entered: { value: '22.5', unit: 'lb' }, canonicalKg: '10.206' },
        reps: 9, rir: 1, symptomState: 'adverse_reported',
      }],
    })
    render(<TrainingSessionPlayer sessionId={session.id} />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getByRole('button', { name: 'Same as last set' }))

    expect((screen.getAllByLabelText('Load')[1] as HTMLInputElement).value).toBe('22.5')
    expect((screen.getAllByLabelText('Unit')[1] as HTMLSelectElement).value).toBe('lb')
    expect((screen.getAllByLabelText('Reps')[1] as HTMLInputElement).value).toBe('9')
    expect((screen.getAllByLabelText('RIR')[1] as HTMLSelectElement).value).toBe('1')
    expect((screen.getAllByLabelText('During this set')[1] as HTMLSelectElement).value).toBe('none')
    expect(mocks.saveSet).not.toHaveBeenCalled()
    expect((screen.getAllByLabelText('Load')[0] as HTMLInputElement).value).toBe('22.5')
  })

  it('leaves same-as-last unavailable until a prior working set is saved', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    render(<TrainingSessionPlayer sessionId={session.id} />)
    await screen.findByText('Goblet squat')

    expect((screen.getByRole('button', { name: 'Same as last set' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('locks same-as-last while the destination has a pending save or a session conflict', async () => {
    let resolveSave: ((value: unknown) => void) | undefined
    const withPrior = {
      ...strengthProjection,
      currentActuals: [{
        eventRevision: 1, sessionId: session.id, exerciseInstanceId: 'exercise-1', setId: 'set-1', setKind: 'working', workingSetOrdinal: 1,
        quantity: acceptedLoad.quantity, reps: 8, rir: 2, symptomState: 'none',
      }],
    }
    mocks.read.mockResolvedValue(withPrior)
    mocks.saveSet.mockReturnValue(new Promise(resolve => { resolveSave = resolve }))
    const first = render(<TrainingSessionPlayer sessionId={session.id} />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledOnce())
    expect((screen.getByRole('button', { name: 'Same as last set' }) as HTMLButtonElement).disabled).toBe(true)
    first.unmount()
    resolveSave?.(undefined)

    offline.entries.push({
      sequence: 1, fingerprint: 'a'.repeat(64), status: 'conflict',
      envelope: { requestId: '46000000-0000-4000-8000-000000000023' },
    })
    offline.drain.mockResolvedValue({
      kind: 'conflict', acknowledgedCount: 0, requestId: '46000000-0000-4000-8000-000000000023',
    })
    render(<TrainingSessionPlayer sessionId={session.id} />)
    await screen.findByText(/pending change conflicts with the server/i)

    expect((screen.getByRole('button', { name: 'Same as last set' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('retries automatically after a reloaded document encounters the prior drain lease and applies a same-revision ack', async () => {
    const userId = '10000000-0000-4000-8000-000000000099'
    const requestId = '46000000-0000-4000-8000-000000000021'
    const startedAt = Date.now()
    let activeUserId: string | null = userId
    let entry: TrainingOfflineStoredEntry | undefined = {
      sequence: 1,
      fingerprint: 'a'.repeat(64),
      status: 'pending',
      envelope: {
        schemaVersion: 'training-offline-envelope.v1',
        userId,
        subjectId: session.subject_id,
        sessionId: session.id,
        requestId,
        queuedAt: new Date(startedAt).toISOString(),
        mutation: {
          kind: 'set_actual', setId: 'set-1', expectedRevision: 2,
          actual: {
            quantity: acceptedLoad.quantity, reps: 8, rir: 2, side: 'bilateral',
            symptomState: 'none', occurredAt: new Date(startedAt).toISOString(),
          },
        },
      },
    }
    let lease = { ownerId: 'closed-document', expiresAt: startedAt + 1_000 }
    const storage: TrainingOfflineStorage = {
      readActiveUser: async () => activeUserId,
      switchActiveUser: async user => {
        const previousUserId = activeUserId
        activeUserId = user
        return { previousUserId, clearedCount: 0 }
      },
      enqueue: async () => { throw new Error('not used') },
      list: async () => entry ? [structuredClone(entry)] : [],
      markConflict: async () => false,
      remove: async (_user, queuedRequestId) => {
        if (entry?.envelope.requestId !== queuedRequestId) return false
        entry = undefined
        return true
      },
      clear: async () => { entry = undefined; return 1 },
      acquireDrainLease: async (_user, ownerId, now, expiresAt) => {
        if (lease.ownerId !== ownerId && lease.expiresAt > now) return false
        lease = { ownerId, expiresAt }
        return true
      },
      releaseDrainLease: async (_user, ownerId) => {
        if (lease.ownerId === ownerId) lease = { ownerId: '', expiresAt: 0 }
      },
    }
    offline.current = createTrainingOfflineOutbox({ storage, ownerId: 'reloaded-document', leaseMs: 1_000 })
    mocks.read.mockResolvedValue({
      ...strengthProjection,
      session: { ...strengthProjection.session, revision: 3 },
    })
    mocks.saveSet.mockResolvedValue({
      schemaVersion: 'training-mutation-ack.v1', requestId, sessionId: session.id,
      revision: 3, state: 'in_progress',
      event: {
        eventId: 'event-1', sessionId: session.id, exerciseInstanceId: 'exercise-1', setId: 'set-1',
        setKind: 'working', workingSetOrdinal: 1, eventRevision: 1, eventKind: 'set_actual_recorded',
        quantity: acceptedLoad.quantity, reps: 8, rir: 2, side: 'bilateral', symptomState: 'none',
        occurredAt: new Date(startedAt).toISOString(), actorKind: 'athlete', replacesEventId: null,
      },
    })

    render(<TrainingSessionPlayer sessionId={session.id} />)

    expect(await screen.findByText(/1 pending change on this device/i)).toBeTruthy()
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledOnce(), { timeout: 3_000 })
    await waitFor(() => expect(screen.queryByText(/pending change on this device/i)).toBeNull())
    expect(screen.getByRole('button', { name: 'Set saved' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Finish with 1 omission' })).toBeTruthy()
  })

  it('cancels a scheduled lease retry when the authenticated account changes', async () => {
    offline.drain.mockResolvedValue({ kind: 'already_draining', acknowledgedCount: 0, retryAfterMs: 25 })
    offline.entries.push({
      sequence: 1, fingerprint: 'a'.repeat(64), status: 'pending',
      envelope: { requestId: '46000000-0000-4000-8000-000000000022' },
    })
    mocks.read.mockResolvedValue(strengthProjection)

    render(<TrainingSessionPlayer sessionId={session.id} />)

    await waitFor(() => expect(offline.drain).toHaveBeenCalledOnce())
    expect(authEvents.callback).toBeTypeOf('function')
    act(() => authEvents.callback?.('SIGNED_IN', { user: { id: '10000000-0000-4000-8000-000000000088' } }))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(offline.drain).toHaveBeenCalledOnce()
  })

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
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledWith(
      expect.objectContaining({ actual: expect.objectContaining({ reps: 7 }) }),
      expect.any(AbortSignal),
    ))
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
    }), expect.any(AbortSignal)))
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
    }), expect.any(AbortSignal))
    expect(await screen.findByText('Progress saved.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/Do not continue this session/)
    expect(screen.getByRole('button', { name: 'Stop session' })).toBeTruthy()
  })

  it('retries a lost set acknowledgement with the exact request envelope', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '46000000-0000-4000-8000-000000000011') })
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet
      .mockRejectedValueOnce(new TrainingMutationFailure('Training session could not be saved.', true))
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000011',
        sessionId: 'session-1', revision: 3, state: 'in_progress',
      })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    expect((await screen.findByRole('alert')).textContent).toContain('Save not confirmed')
    expect(screen.getByText(/1 pending change on this device/i)).toBeTruthy()
    expect(screen.getByText(/not saved on the server yet/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))

    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledTimes(2))
    expect(mocks.saveSet.mock.calls[1][0]).toEqual(mocks.saveSet.mock.calls[0][0])
    await waitFor(() => expect(screen.queryByText(/pending change on this device/i)).toBeNull())
  })

  it('creates a new set request after an edit following a failed save', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('46000000-0000-4000-8000-000000000012')
      .mockReturnValueOnce('46000000-0000-4000-8000-000000000013') })
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet
      .mockRejectedValueOnce(new TrainingMutationFailure('Training session could not be saved.', true))
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000012',
        sessionId: 'session-1', revision: 3, state: 'in_progress',
      })
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000013',
        sessionId: 'session-1', revision: 4, state: 'in_progress',
      })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await screen.findByRole('alert')
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Reps' })[0], { target: { value: '9' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])

    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledTimes(3))
    expect(mocks.saveSet.mock.calls[0][0].requestId).toBe('46000000-0000-4000-8000-000000000012')
    expect(mocks.saveSet.mock.calls[1][0]).toEqual(mocks.saveSet.mock.calls[0][0])
    expect(mocks.saveSet.mock.calls[2][0]).toMatchObject({
      requestId: '46000000-0000-4000-8000-000000000013', actual: { reps: 9 },
    })
  })

  it('locks set inputs while a save is in flight so a late acknowledgement cannot overwrite a new edit', async () => {
    let resolveSave: ((value: unknown) => void) | undefined
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet.mockReturnValue(new Promise(resolve => { resolveSave = resolve }))
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')
    const reps = screen.getAllByRole('spinbutton', { name: 'Reps' })[0] as HTMLInputElement

    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledOnce())

    expect(reps.disabled).toBe(true)
    expect((screen.getAllByRole('button', { name: 'Saving set…' })[0] as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      resolveSave?.({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000099',
        sessionId: 'session-1', revision: 3, state: 'in_progress',
      })
    })
    await screen.findByText('Progress saved.')
  })

  it('stops on a conflict until the user explicitly discards it before a new save', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('46000000-0000-4000-8000-000000000014')
      .mockReturnValueOnce('46000000-0000-4000-8000-000000000015') })
    const current = { ...strengthProjection, session: { ...strengthProjection.session, revision: 4 } }
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet
      .mockRejectedValueOnce(new TrainingRevisionConflict(current))
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000015',
        sessionId: 'session-1', revision: 5, state: 'in_progress',
      })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])
    await screen.findByText(/Latest saved values are loaded/)
    expect(mocks.saveSet).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/not saved on the server yet/i)).toBeTruthy()
    mocks.read.mockResolvedValue(current)
    fireEvent.click(screen.getByRole('button', { name: 'Discard conflicting local change and reload' }))
    await screen.findByText(/local change was discarded/i)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])

    await waitFor(() => expect(mocks.saveSet).toHaveBeenCalledTimes(2))
    expect(mocks.saveSet.mock.calls[0][0].requestId).toBe('46000000-0000-4000-8000-000000000014')
    expect(mocks.saveSet.mock.calls[1][0].requestId).toBe('46000000-0000-4000-8000-000000000015')
  })

  it('retries a lost completion acknowledgement with the exact request envelope', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '46000000-0000-4000-8000-000000000016') })
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.complete
      .mockRejectedValueOnce(new TrainingMutationFailure('Training session could not be saved.', true))
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000016',
        sessionId: 'session-1', revision: 3, state: 'completed_with_omissions', missingSetCount: 2,
      })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getByRole('button', { name: 'Finish with 2 omissions' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Save not confirmed')
    fireEvent.click(screen.getByRole('button', { name: 'Retry finish with 2 omissions' }))

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2))
    expect(mocks.complete.mock.calls[1][0]).toEqual(mocks.complete.mock.calls[0][0])
  })

  it('stops explicitly and retries an ambiguous abort with the exact request envelope', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '46000000-0000-4000-8000-000000000017') })
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.complete
      .mockRejectedValueOnce(new TrainingMutationFailure('Training session could not be saved.', true))
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000017',
        sessionId: 'session-1', revision: 3, state: 'aborted', missingSetCount: 2,
      })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Save not confirmed')
    expect(screen.queryByRole('button', { name: 'Finish with 2 omissions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry stop session' }))

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2))
    expect(mocks.complete.mock.calls[0][0]).toMatchObject({
      requestId: '46000000-0000-4000-8000-000000000017',
      expectedRevision: 2,
      finishMode: 'abort',
    })
    expect(mocks.complete.mock.calls[1][0]).toEqual(mocks.complete.mock.calls[0][0])
    expect(await screen.findByText(/Session stopped\. Saved actuals remain in history/)).toBeTruthy()
    expect(screen.getByText(/This session was stopped/)).toBeTruthy()
  })

  it('rejects stale completion without retrying it and permits a new explicit stop request', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('46000000-0000-4000-8000-000000000018')
      .mockReturnValueOnce('46000000-0000-4000-8000-000000000019') })
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.complete
      .mockRejectedValueOnce(new TrainingMutationFailure(
        'This session is over 24 hours old.', false, 'training_session_stale', 409,
      ))
      .mockResolvedValueOnce({
        schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000019',
        sessionId: 'session-1', revision: 3, state: 'aborted', missingSetCount: 2,
      })
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getByRole('button', { name: 'Finish with 2 omissions' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/over 24 hours old.*stop the session/i)
    expect(screen.queryByRole('button', { name: /Retry finish/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }))

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2))
    expect(mocks.complete.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ requestId: '46000000-0000-4000-8000-000000000018', finishMode: 'finish_with_omissions' }),
      expect.objectContaining({ requestId: '46000000-0000-4000-8000-000000000019', finishMode: 'abort' }),
    ])
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
    }), expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: 'Finish session' }))
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', expectedRevision: 3, finishMode: 'complete',
    }), expect.any(AbortSignal)))
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

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', expectedRevision: 2, finishMode: 'finish_with_omissions',
    }), expect.any(AbortSignal)))
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
    expect(screen.getByRole('heading', { name: 'Next conditioning targets' })).toBeTruthy()
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

  it('preserves queued data when browser auth verification is transiently unknown', async () => {
    getUser.mockRejectedValueOnce(new Error('network unavailable'))
    offline.entries.push({
      sequence: 1, fingerprint: 'a'.repeat(64), status: 'pending',
      envelope: { requestId: '46000000-0000-4000-8000-000000000099' },
    })
    mocks.read.mockResolvedValue(strengthProjection)

    render(<TrainingSessionPlayer sessionId="session-1" />)

    expect(await screen.findByText(/offline saves are paused/i)).toBeTruthy()
    expect(offline.entries).toHaveLength(1)
    expect(offline.drain).not.toHaveBeenCalled()
  })

  it('clears the exact session queue after the server authoritatively denies that action', async () => {
    mocks.read.mockResolvedValue(strengthProjection)
    mocks.saveSet.mockRejectedValue(new TrainingMutationFailure(
      'Training session could not be saved.', false, 'training_action_unavailable', 403,
    ))
    render(<TrainingSessionPlayer sessionId="session-1" />)
    await screen.findByText('Goblet squat')

    fireEvent.click(screen.getAllByRole('button', { name: 'Save set' })[0])

    expect(await screen.findByText(/affected offline queue was cleared/i)).toBeTruthy()
    expect(offline.entries).toHaveLength(0)
    expect(screen.queryByText(/pending change on this device/i)).toBeNull()
  })
})
