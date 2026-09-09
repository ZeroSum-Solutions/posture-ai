// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StrengthBuilderLauncher from './StrengthBuilderLauncher'

vi.mock('./StrengthBuilderEntry', () => ({
  default: ({ source }: { source: { kind: string; client?: { id: string; name: string }; subject?: { id: string; name: string } } }) => {
    const identity = source.kind === 'client' ? source.client : source.subject
    return <div data-testid="profile-entry">{source.kind}:{identity?.id}:{identity?.name}</div>
  },
}))

afterEach(cleanup)
beforeEach(() => vi.unstubAllGlobals())

const clients = [
  { id: 'client-1', name: 'Alex Rivera' },
  { id: 'client-2', name: 'Morgan Chen With A Long Display Name' },
]

describe('StrengthBuilderLauncher', () => {
  it('starts a strength profile from an owned client without assessment context', () => {
    render(<StrengthBuilderLauncher clients={clients} />)

    expect((screen.getByLabelText('Build strength program for') as HTMLSelectElement).value).toBe('client-1')
    expect(screen.getByTestId('profile-entry').textContent).toBe('client:client-1:Alex Rivera')
  })

  it('switches the canonical profile lookup when the practitioner selects another client', () => {
    render(<StrengthBuilderLauncher clients={clients} initialClientId="client-1" />)

    fireEvent.change(screen.getByLabelText('Build strength program for'), { target: { value: 'client-2' } })
    expect(screen.getByTestId('profile-entry').textContent).toBe('client:client-2:Morgan Chen With A Long Display Name')
  })

  it('opens a private sample subject without using a real client id as its identity', async () => {
    const subjectId = '44444444-4444-4444-8444-444444444444'
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ subjectId, profileRevision: 1 }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<StrengthBuilderLauncher clients={clients} />)

    fireEvent.click(screen.getByRole('button', { name: 'Try a sample program' }))

    await waitFor(() => expect(screen.getByTestId('profile-entry').textContent).toBe(`subject:${subjectId}:Practice Athlete`))
    expect(fetchMock).toHaveBeenCalledWith('/api/training/simulation/setup', { method: 'POST' })
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body')
    expect(screen.getByText(/separate private practice athlete/i)).toBeTruthy()
  })

  it('offers the sample path even when there are no real clients', () => {
    render(<StrengthBuilderLauncher clients={[]} />)

    expect(screen.getByRole('button', { name: 'Try a sample program' })).toBeTruthy()
    expect(screen.getByText(/Add a client to build a real athlete program/)).toBeTruthy()
  })
})

it('describes the sample builder without hard-coding a cycle length', () => {
  render(<StrengthBuilderLauncher clients={clients} />)
  expect(screen.getByText(/explore the strength program builder/i)).toBeTruthy()
  expect(screen.queryByText(/eight-week/i)).toBeNull()
})

it('opens the fixed alternatives sample and keeps its choice stable until closed', async () => {
  let resolveResponse!: (response: Response) => void
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve }))
  vi.stubGlobal('fetch', fetchMock)
  render(<StrengthBuilderLauncher clients={clients} />)
  const picker = screen.getByRole('combobox', { name: 'Sample program' }) as HTMLSelectElement
  fireEvent.change(picker, { target: { value: 'exercise-swap' } })
  fireEvent.click(screen.getByRole('button', { name: 'Try a sample program' }))
  expect(fetchMock).toHaveBeenCalledWith('/api/training/simulation/setup?catalog=exercise-swap', { method: 'POST' })
  expect(picker.disabled).toBe(true)
  resolveResponse(Response.json({ subjectId: 'sample-alternatives', profileRevision: 1 }, { status: 201 }))
  await waitFor(() => expect(screen.getByTestId('profile-entry').textContent).toBe('subject:sample-alternatives:Practice Athlete'))
  expect(picker.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Return to selected client' }))
  expect(picker.disabled).toBe(false)
  expect(screen.getByTestId('profile-entry').textContent).toBe('client:client-1:Alex Rivera')
})

it('opens the fixed conditioning sample without supplying fixture identifiers', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ subjectId: 'sample-conditioning', profileRevision: 1 }, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<StrengthBuilderLauncher clients={clients} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Sample program' }), { target: { value: 'conditioning' } })
  fireEvent.click(screen.getByRole('button', { name: 'Try a sample program' }))
  await waitFor(() => expect(screen.getByTestId('profile-entry').textContent).toBe('subject:sample-conditioning:Practice Athlete'))
  expect(fetchMock).toHaveBeenCalledWith('/api/training/simulation/setup?catalog=conditioning', { method: 'POST' })
})

it('opens the fixed bodyweight and assistance sample without client-authored provenance', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ subjectId: 'sample-bodyweight', profileRevision: 1 }, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<StrengthBuilderLauncher clients={clients} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Sample program' }), { target: { value: 'bodyweight-assistance' } })
  fireEvent.click(screen.getByRole('button', { name: 'Try a sample program' }))
  await waitFor(() => expect(screen.getByTestId('profile-entry').textContent).toBe('subject:sample-bodyweight:Practice Athlete'))
  expect(fetchMock).toHaveBeenCalledWith('/api/training/simulation/setup?catalog=bodyweight-assistance', { method: 'POST' })
  expect(screen.getByRole('option', { name: 'Bodyweight and assisted strength' })).toBeTruthy()
})

it('creates and selects a client inside Workouts without losing the builder', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ client: { id: 'new-client', first_name: 'Taylor', last_name: 'Jones' } }, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<StrengthBuilderLauncher clients={clients} operationMode="prototype" />)
  fireEvent.click(screen.getByRole('button', { name: 'New client' }))
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Taylor' } })
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Jones' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Client' }))
  await waitFor(() => expect(screen.getByTestId('profile-entry').textContent).toBe('client:new-client:Taylor Jones'))
  expect(screen.queryByRole('form', { name: 'New client form' })).toBeNull()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/clients')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ first_name: 'Taylor', last_name: 'Jones' })
})
