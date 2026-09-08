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
