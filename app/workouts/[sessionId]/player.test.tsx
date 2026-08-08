// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import AuthedPlayer, { saveWorkoutRun } from './player'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// Queue behavior is independent of visual transition timing. Rendering motion
// wrappers synchronously keeps these state-machine tests deterministic under
// the full parallel suite as well as in isolation.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
  motion: {
    div: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
  useReducedMotion: () => true,
}))

const snapshot: SessionSnapshot = {
  version: 1,
  week: 1,
  capability: 'standard',
  priorities: [],
  items: [{
    index: 0,
    slug: 'wall-slide',
    baseSlug: 'wall-slide',
    name: 'Wall slide',
    category: 'mobility',
    stepLabel: 'Loosen',
    priorityKey: 'shoulders',
    priorityLabel: 'Shoulder mobility',
    isIntegrative: false,
    instructions: 'Move slowly.',
    timing: { kind: 'reps', sets: 1, repsPerSet: 5, restSeconds: 0 },
  }],
  estimatedDurationSec: 30,
  disclaimer: 'Screening notice.',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function runRequestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  return JSON.parse(fetchMock.mock.calls[callIndex]?.[1]?.body as string)
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('authenticated workout run adapter', () => {
  test('reports a non-2xx response as an unacknowledged save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Failed to save progress.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )))

    await expect(saveWorkoutRun('session-1', { revision: 4 })).resolves.toEqual({
      ok: false,
      error: 'Failed to save progress.',
    })
  })

  test('reports a fetch rejection as an unacknowledged save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    await expect(saveWorkoutRun('session-1', { revision: 4 })).resolves.toEqual({
      ok: false,
      error: 'Network error while saving progress.',
    })
  })

  test('reports a revision conflict without treating it as an acknowledged save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Revision conflict.', current_revision: 9 }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )))

    await expect(saveWorkoutRun('session-1', { revision: 4 })).resolves.toEqual({
      ok: false,
      error: 'Revision conflict.',
      conflict: true,
      conflictRevision: 9,
    })
  })
})

describe('authenticated workout run queue', () => {
  test('serializes transitions and transmits the next revision only after acknowledgement', async () => {
    const firstSave = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, revision: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthedPlayer
        sessionId="session-1"
        snapshot={snapshot}
        backHref="/assessments/assessment-1"
      />,
    )

    fireEvent.click(screen.getByTestId('red-flag-no'))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin session' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(runRequestBody(fetchMock, 0)).toMatchObject({ red_flag_acknowledged: true, revision: 1 })

    await act(async () => firstSave.resolve(new Response(JSON.stringify({ ok: true, revision: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(runRequestBody(fetchMock, 1)).toMatchObject({ status: 'in_progress', revision: 2 })
  })

  test('retries a rejected save without consuming a revision and shows unsaved progress', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ error: 'Failed to save progress.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthedPlayer
        sessionId="session-1"
        snapshot={snapshot}
        backHref="/assessments/assessment-1"
      />,
    )

    fireEvent.click(screen.getByTestId('red-flag-no'))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map((_, index) => runRequestBody(fetchMock, index).revision)).toEqual([1, 1, 1])
    expect(screen.getByRole('alert').textContent).toContain('Progress is not saved')
    expect(screen.getByRole('button', { name: 'Retry saving' })).toBeTruthy()
  })

  test('stops on a full-state conflict instead of rebasing stale progress above the server revision', async () => {
    const conflictSave = deferred<Response>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, revision: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockReturnValueOnce(conflictSave.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, revision: 6 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthedPlayer
        sessionId="session-1"
        snapshot={snapshot}
        backHref="/assessments/assessment-1"
      />,
    )

    fireEvent.click(screen.getByTestId('red-flag-no'))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin session' }))
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.useFakeTimers()
    await act(async () => {
      conflictSave.resolve(new Response(JSON.stringify({
        error: 'Revision conflict.',
        current_revision: 5,
      }), { status: 409, headers: { 'content-type': 'application/json' } }))
      await vi.runAllTimersAsync()
    })

    expect(fetchMock.mock.calls.map((_, index) => runRequestBody(fetchMock, index).revision)).toEqual([1, 2])
    expect(runRequestBody(fetchMock, 1)).toMatchObject({
      status: 'in_progress',
      current_item_index: 0,
      items: [{ slug: 'wall-slide', completed: false, skipped: false }],
    })
    expect(screen.getByRole('alert').textContent).toContain('Progress changed in another tab or device')
    expect(screen.getByRole('button', { name: 'Reload latest progress' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry saving' })).toBeNull()
  })
})
