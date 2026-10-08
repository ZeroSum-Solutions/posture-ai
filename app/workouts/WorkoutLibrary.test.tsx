// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import WorkoutLibrary from './WorkoutLibrary'
import { type WorkoutLibraryItem, workoutLibraryKey } from './WorkoutLibrary.model'
import { DEFAULT_WORKOUT_PREFERENCES } from '@/lib/workout/personalize'

const push = vi.fn()
// v3's shared `ActionBar`/`TopBar` read `usePathname` (tab-bar/chrome-bottom
// policy), so the navigation mock now needs it alongside `useRouter`.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/workouts' }))
vi.mock('./_strength/StrengthBuilderEntry', () => ({
  default: ({ source }: { source: { kind: 'client'; client: { id: string; name: string } } }) => <div data-testid="strength-builder-entry">{source.kind}:{source.client.id}:{source.client.name}</div>,
}))
vi.mock('./_strength/TrainingSessionPlayer', () => ({
  default: ({ sessionId }: { sessionId: string }) => <div data-testid="training-session-player">{sessionId}</div>,
}))

const snapshot = {
  version: 1 as const,
  week: 1 as const,
  capability: 'standard' as const,
  priorities: [],
  items: [{
    index: 0,
    slug: 'wall-slide',
    baseSlug: 'wall-slide',
    name: 'Wall slide',
    category: 'strengthen' as const,
    stepLabel: 'Strengthen',
    priorityKey: 'forward_head',
    priorityLabel: 'Forward head',
    isIntegrative: false,
    instructions: 'Move slowly.',
    timing: { kind: 'reps' as const, sets: 2, repsPerSet: 8, restSeconds: 20 },
  }],
  estimatedDurationSec: 92,
  disclaimer: 'Screening support only.',
}

const item: WorkoutLibraryItem = {
  id: '11111111-1111-4111-8111-111111111111',
  assessmentId: '22222222-2222-4222-8222-222222222222',
  clientId: '33333333-3333-4333-8333-333333333333',
  clientName: 'Alex Kim',
  name: 'Tuesday movement',
  source: 'scan',
  preferences: DEFAULT_WORKOUT_PREFERENCES,
  snapshot,
  createdAt: '2026-09-07T08:00:00Z',
  playable: true,
  run: null,
}

beforeEach(() => { push.mockReset(); vi.unstubAllGlobals() })
afterEach(cleanup)

describe('original workout library', () => {
  test('changes the server component key for refreshed rows or a new assessment seed', () => {
    const empty = workoutLibraryKey([], null)
    expect(workoutLibraryKey([item], null)).not.toBe(empty)
    expect(workoutLibraryKey([], {
      assessmentId: item.assessmentId,
      clientId: item.clientId,
      clientName: item.clientName,
      capability: 'standard',
      approved: true,
    })).not.toBe(empty)
  })

  test('opens the strength builder for the client selected by the assessment seed', () => {
    render(<WorkoutLibrary initialLibrary={[]} strengthClients={[{ id: item.clientId, name: item.clientName }]} seed={{
      assessmentId: item.assessmentId,
      clientId: item.clientId,
      clientName: item.clientName,
      capability: 'standard',
      approved: true,
    }} />)

    expect(screen.getByTestId('strength-builder-entry').textContent).toBe(`client:${item.clientId}:${item.clientName}`)
  })

  test('opens an owned training session in the original Workouts surface', () => {
    render(<WorkoutLibrary initialLibrary={[]} trainingSessionId="strength-session-1" />)

    expect(screen.getByTestId('training-session-player').textContent).toBe('strength-session-1')
    expect(screen.getByRole('link', { name: 'Back to workouts' }).getAttribute('href')).toBe('/workouts')
    expect(screen.queryByText('Build strength program for')).toBeNull()
  })

  test('plays again by minting a new owned session instead of resetting the saved run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ session_id: 'new-session' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkoutLibrary initialLibrary={[{ ...item, run: { status: 'completed', completedItems: 1 } }]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workouts/new-session'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      assessment_id: item.assessmentId,
      name: 'Tuesday movement',
      selected_slugs: ['wall-slide'],
    })
  })

  test('keeps an incompatible saved workout visible and offers a current-catalog copy', () => {
    render(<WorkoutLibrary initialLibrary={[{ ...item, playable: false }]} />)

    expect(screen.getByText(/saved plan uses an older catalog/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update plan' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Start workout' })).toBeNull()
  })

  test('archives through the owned session route and removes the card', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkoutLibrary initialLibrary={[item]} />)

    // v3 moves the per-row Edit/Archive pair into a "…" overflow Sheet
    // (DESIGN.md / spec §5 "Workouts hub") — open it before reaching Archive.
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Tuesday movement' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(screen.queryByText('Tuesday movement')).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith(`/api/workouts/${item.id}`, expect.objectContaining({ method: 'PATCH' }))
  })

  test('contains an archive network failure and re-enables the action', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkoutLibrary initialLibrary={[item]} />)

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Tuesday movement' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/offline/i))
    expect(screen.getByRole('button', { name: 'Archive' })).not.toHaveProperty('disabled', true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
