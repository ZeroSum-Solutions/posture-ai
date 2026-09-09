// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachAthleteInvitation from './CoachAthleteInvitation'

const client = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Alexandra Athlete',
}

afterEach(cleanup)
beforeEach(() => vi.unstubAllGlobals())

function choosePermission(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name }))
}

describe('CoachAthleteInvitation', () => {
  it('requires a valid email and at least one explicit permission', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/valid athlete email/i)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'athlete@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least one permission/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts only the owned client, email, explicit permissions, and a request ID', async () => {
    const invitationUrl = 'https://auth.example.test/invite?token=secret-value'
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      status: 'prepared',
      invitationId: '55555555-5555-4555-8555-555555555555',
      invitationUrl,
      expiresAt: '2030-01-14T12:00:00.000Z',
    }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: ' Athlete@Example.com ' } })
    choosePermission('Read training profile')
    choosePermission('Publish assigned programs')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))

    await screen.findByText('Invitation ready')
    const [, init] = fetchMock.mock.calls[0]
    expect(fetchMock.mock.calls[0][0]).toBe('/api/training/coaching/invitations')
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } })
    expect(JSON.parse(init.body)).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      clientId: client.id,
      email: 'Athlete@Example.com',
      permissions: ['profile:read', 'program:coach_publish'],
    })
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Invitation link') as HTMLInputElement).value).toBe(invitationUrl)
    expect(screen.getByText(/Expires/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy invitation link' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(invitationUrl))
    expect((await screen.findByRole('status')).textContent).toBe('Invitation link copied.')
  })

  it('retries an ambiguous failure with the exact frozen request', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(Response.json({
        status: 'prepared',
        invitationId: '55555555-5555-4555-8555-555555555555',
        invitationUrl: 'https://auth.example.test/invite?token=fresh-short-lived-value',
        expiresAt: '2030-01-14T12:00:00.000Z',
      }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'athlete@example.com' } })
    choosePermission('Read training profile')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/may have been prepared/i)
    expect((screen.getByLabelText('Athlete email') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Read training profile' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    const firstBody = fetchMock.mock.calls[0][1].body

    fireEvent.click(screen.getByRole('button', { name: 'Retry same invitation request' }))
    await screen.findByText('Invitation ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].body).toBe(firstBody)
  })

  it('reuses the frozen request when an uncertain form is submitted implicitly', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(Response.json({
        status: 'prepared',
        invitationId: '55555555-5555-4555-8555-555555555555',
        invitationUrl: 'https://auth.example.test/invite?token=recovered',
        expiresAt: '2030-01-14T12:00:00.000Z',
      }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'athlete@example.com' } })
    choosePermission('Read training profile')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    await screen.findByRole('button', { name: 'Retry same invitation request' })
    const firstBody = fetchMock.mock.calls[0][1].body

    fireEvent.submit(container.querySelector('form')!)
    await screen.findByText('Invitation ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].body).toBe(firstBody)
  })

  it('keeps the athlete name bound to the prepared request when the selected client changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      status: 'prepared',
      invitationId: '55555555-5555-4555-8555-555555555555',
      invitationUrl: 'https://auth.example.test/invite?token=bound-athlete',
      expiresAt: '2030-01-14T12:00:00.000Z',
    }, { status: 201 })))
    const rendered = render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'athlete@example.com' } })
    choosePermission('Read training profile')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    await screen.findByText('Invitation ready')

    rendered.rerender(<CoachAthleteInvitation client={{ ...client, name: 'Different Athlete' }} />)
    expect(screen.getByText(/Share this link directly with Alexandra Athlete/)).toBeTruthy()
    expect(screen.queryByText(/Different Athlete/)).toBeNull()
  })

  it('surfaces the server error envelope and unlocks deterministic failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      error: 'mfa_required',
    }, { status: 403 })))
    render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'athlete@example.com' } })
    choosePermission('Read training profile')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/multi-factor authentication/i)
    expect((screen.getByLabelText('Athlete email') as HTMLInputElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Retry same invitation request' })).toBeNull()
  })

  it('requires the exact success status and permits plain HTTP only for a local provider', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: 'prepared',
        invitationId: '55555555-5555-4555-8555-555555555555',
        invitationUrl: 'https://auth.example.test/invite?token=unexpected-status',
        expiresAt: '2030-01-14T12:00:00.000Z',
      }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        status: 'prepared',
        invitationId: '55555555-5555-4555-8555-555555555555',
        invitationUrl: 'http://auth.example.test/invite?token=insecure',
        expiresAt: '2030-01-14T12:00:00.000Z',
      }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        status: 'prepared',
        invitationId: '55555555-5555-4555-8555-555555555555',
        invitationUrl: 'http://localhost:55421/auth/v1/verify?token=recovered',
        expiresAt: '2030-01-14T12:00:00.000+00:00',
      }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CoachAthleteInvitation client={client} />)

    fireEvent.change(screen.getByLabelText('Athlete email'), { target: { value: 'athlete@example.com' } })
    choosePermission('Read session history')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/response could not be verified/i)
    expect(screen.queryByText('Invitation ready')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry same invitation request' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/response could not be verified/i)
    expect(screen.queryByText('Invitation ready')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry same invitation request' }))
    await screen.findByText('Invitation ready')
    expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[0][1].body)
  })
})
