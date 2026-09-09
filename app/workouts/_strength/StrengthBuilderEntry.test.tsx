// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StrengthBuilderEntry from './StrengthBuilderEntry'
import { createInitialStrengthProfile } from './StrengthBuilder.model'
import type { TrainingCoachingRelationshipsPanelProps } from './TrainingCoachingRelationshipsPanel'

const gatewayMocks = vi.hoisted(() => ({
  requestProgramOptions: vi.fn(),
  requestTrainingBuild: vi.fn(),
  acceptTrainingBuild: vi.fn(),
  publishTrainingDraft: vi.fn(),
  clearRelationshipSessions: vi.fn(),
}))

vi.mock('./TrainingProgramResumeList', () => ({ default: () => null }))
vi.mock('@/lib/training/offline/relationship', () => ({
  clearOfflineSessionsAfterRelationshipRevocation: gatewayMocks.clearRelationshipSessions,
}))
vi.mock('./TrainingCoachingRelationshipsPanel', () => ({
  default: ({ scope, onRelationshipRevoked }: TrainingCoachingRelationshipsPanelProps) => <button
    type="button"
    onClick={() => void Promise.resolve(onRelationshipRevoked({
      schemaVersion: 'training-coaching-relationship-revocation.v1',
      requestId: '88888888-8888-4888-8888-888888888888',
      relationshipId: '99999999-9999-4999-8999-999999999999',
      subjectId: scope.kind === 'coach' ? scope.subjectId : subjectId,
      status: 'revoked', revision: 2, affectedSessionIds: ['coach-session-1'],
    })).catch(() => undefined)}
  >End test coaching connection</button>,
}))

vi.mock('./ProgramOptions.gateway', () => ({ requestProgramOptions: gatewayMocks.requestProgramOptions }))
vi.mock('./StrengthBuilder.gateway', () => ({
  requestTrainingBuild: gatewayMocks.requestTrainingBuild,
  acceptTrainingBuild: gatewayMocks.acceptTrainingBuild,
  publishTrainingDraft: gatewayMocks.publishTrainingDraft,
}))

afterEach(cleanup)
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  gatewayMocks.clearRelationshipSessions.mockResolvedValue({ kind: 'cleared', clearedCount: 1 })
  gatewayMocks.requestProgramOptions.mockRejectedValue(new Error('Reviewed program catalog is not available yet.'))
})

const client = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Alexandra With An Intentionally Long Athlete Display Name',
}
const subjectId = '44444444-4444-4444-8444-444444444444'

describe('StrengthBuilderEntry', () => {
  it('loads the current server projection for the selected subject', async () => {
    const profile = { ...createInitialStrengthProfile('America/New_York'), goal: 'strength' as const }
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-profile-projection.v1',
      subjectId,
      clientId: client.id,
      actor: { kind: 'coach' },
      permissions: {},
      current: { revision: 6, profileHash: 'hash', hashEncoding: 'hex', profile },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StrengthBuilderEntry source={{ kind: 'client', client }} />)

    expect(screen.getByRole('status').textContent).toMatch(/Loading training profile/)
    await waitFor(() => expect(screen.getByText('Profile revision 6')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/training/profile?clientId=33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect((screen.getByLabelText('Training goal') as HTMLSelectElement).value).toBe('strength')
    expect((await screen.findAllByText('Reviewed program catalog is not available yet.')).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: 'Build program draft' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('persists only the expected revision and shared profile through the profile route', async () => {
    const profile = createInitialStrengthProfile('America/Los_Angeles')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'training-profile-projection.v1',
        subjectId,
        clientId: client.id,
        actor: { kind: 'coach' },
        permissions: {},
        current: { revision: 2, profileHash: 'hash', hashEncoding: 'hex', profile },
      }))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'training-profile-projection.v1',
        subjectId,
        clientId: client.id,
        actor: { kind: 'coach' },
        permissions: {},
        current: { revision: 3, profileHash: 'next-hash', hashEncoding: 'hex', profile: { ...profile, goal: 'strength' } },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StrengthBuilderEntry source={{ kind: 'client', client }} />)
    await screen.findByText('Profile revision 2')
    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(screen.getByText('Saved · revision 3')).toBeTruthy())
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/training/profile?subjectId=44444444-4444-4444-8444-444444444444',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
      }),
    )
    const request = fetchMock.mock.calls[1][1]
    expect(JSON.parse(request.body)).toEqual({
      expectedRevision: 2,
      profile: expect.objectContaining({ goal: 'strength' }),
    })
    expect(JSON.parse(request.body)).not.toHaveProperty('subjectId')
    expect(JSON.parse(request.body)).not.toHaveProperty('practitionerId')
  })

  it('surfaces a failed profile read and offers a retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'subject_forbidden' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'training-profile-projection.v1',
        subjectId,
        clientId: client.id,
        actor: { kind: 'coach' },
        permissions: {},
        current: null,
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StrengthBuilderEntry source={{ kind: 'client', client }} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i)
    fireEvent.click(screen.getByRole('button', { name: 'Retry profile' }))
    await waitFor(() => expect(screen.getByText('Profile revision 0')).toBeTruthy())
    expect(gatewayMocks.requestProgramOptions).not.toHaveBeenCalled()
  })

  it('requires explicit athlete setup when no client-to-subject bridge exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      code: 'athlete_setup_required',
      clientId: client.id,
    }, { status: 409 })))

    render(<StrengthBuilderEntry source={{ kind: 'client', client }} />)

    await screen.findByText('Athlete setup required')
    expect(screen.getByText(/No account or relationship was created automatically/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Prepare invitation' })).toBeTruthy()
    expect(screen.getByLabelText('Athlete email')).toBeTruthy()
  })

  it('parses the full current projection returned by a revision conflict', async () => {
    const profile = createInitialStrengthProfile('America/Los_Angeles')
    const projection = {
      status: 'ok',
      schemaVersion: 'training-profile-projection.v1',
      subjectId,
      clientId: client.id,
      permissions: ['profile:read', 'profile:write'],
      current: { revision: 4, profileHash: 'hash', hashEncoding: 'hex', profile },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...projection, current: { ...projection.current, revision: 3 } }))
      .mockResolvedValueOnce(Response.json({ code: 'profile_revision_conflict', current: projection }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StrengthBuilderEntry source={{ kind: 'client', client }} />)
    await screen.findByText('Profile revision 3')
    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await screen.findByRole('button', { name: 'Load revision 4' })
    expect(screen.getByRole('alert').textContent).toMatch(/changed elsewhere/i)
  })

  it('loads a sample profile by canonical subject id without inventing a client id', async () => {
    const profile = createInitialStrengthProfile('America/Los_Angeles')
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-profile-projection.v1',
      subjectId,
      clientId: '55555555-5555-4555-8555-555555555555',
      actor: { kind: 'coach' },
      permissions: {},
      current: { revision: 1, profileHash: 'hash', hashEncoding: 'hex', profile },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StrengthBuilderEntry source={{ kind: 'subject', subject: { id: subjectId, name: 'Practice Athlete' } }} />)

    await screen.findByText('Profile revision 1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/training/profile?subjectId=44444444-4444-4444-8444-444444444444',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(screen.getByRole('button', { name: 'Build practice draft' })).toBeTruthy()
    expect(screen.getByText(/synthetic practice exercise variants available/)).toBeTruthy()
  })

  it.each(['live_subject', 'simulation_subject'] as const)('rejects a mismatched subject in %s profile responses', async kind => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-profile-projection.v1', subjectId: 'another-subject', current: null,
    })))
    render(<StrengthBuilderEntry source={{ kind, subject: { id: subjectId, name: 'Your training' } }} />)
    await screen.findByText('Training profile response was invalid.')
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull()
  })

  it('loads a live athlete profile and exposes the server-backed build action as unavailable while the reviewed registry is empty', async () => {
    const profile = createInitialStrengthProfile('America/Los_Angeles')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
      schemaVersion: 'training-profile-projection.v1',
      subjectId,
      clientId: null,
      actor: { kind: 'athlete' },
      permissions: {},
      current: { revision: 2, profileHash: 'hash', hashEncoding: 'hex', profile },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StrengthBuilderEntry source={{ kind: 'live_subject', subject: { id: subjectId, name: 'Your training' } }} />)

    await screen.findByText('Profile revision 2')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/training/profile?subjectId=44444444-4444-4444-8444-444444444444',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect((await screen.findAllByText('Reviewed program catalog is not available yet.')).length).toBeGreaterThan(0)
    expect(gatewayMocks.requestProgramOptions).toHaveBeenCalledWith(subjectId, 2)
    const build = screen.getByRole('button', { name: 'Build program draft' }) as HTMLButtonElement
    expect(build.disabled).toBe(true)
  })

  it('supports the explicit simulation subject source without breaking the legacy sample source', async () => {
    const profile = createInitialStrengthProfile('America/Los_Angeles')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-profile-projection.v1',
      subjectId,
      clientId: '55555555-5555-4555-8555-555555555555',
      actor: { kind: 'coach' },
      permissions: {},
      current: { revision: 1, profileHash: 'hash', hashEncoding: 'hex', profile },
    })))

    render(<StrengthBuilderEntry source={{ kind: 'simulation_subject', subject: { id: subjectId, name: 'Practice Athlete' } }} />)

    await screen.findByText('Profile revision 1')
    expect(screen.getByRole('button', { name: 'Build practice draft' })).toBeTruthy()
    expect(screen.getByText(/synthetic practice exercise variants available/)).toBeTruthy()
  })
})


describe('relationship revocation in the original workout entry', () => {
  function serveProfile() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-profile-projection.v1', subjectId, clientId: client.id,
      current: { revision: 2, profile: createInitialStrengthProfile('America/Los_Angeles') },
    })))
  }

  it('removes stale coach controls and clears only receipt-bound session scopes', async () => {
    serveProfile()
    render(<StrengthBuilderEntry source={{ kind: 'client', client }} />)
    await screen.findByText('Profile revision 2')
    fireEvent.click(screen.getByRole('button', { name: 'End test coaching connection' }))
    await screen.findByText(/Coaching access has ended/)
    expect(screen.queryByLabelText('Training goal')).toBeNull()
    expect(gatewayMocks.clearRelationshipSessions).toHaveBeenCalledWith({
      subjectId, relationshipId: '99999999-9999-4999-8999-999999999999',
      affectedSessionIds: ['coach-session-1'],
    })
    expect(screen.getByRole('button', { name: 'End test coaching connection' })).toBeTruthy()
  })

  it('pauses athlete controls until cleanup finishes, then remounts the current program controls', async () => {
    serveProfile()
    let finishCleanup!: (value: { kind: 'cleared'; clearedCount: number }) => void
    gatewayMocks.clearRelationshipSessions.mockReturnValueOnce(new Promise(resolve => { finishCleanup = resolve }))
    render(<StrengthBuilderEntry source={{ kind: 'live_subject', subject: { id: subjectId, name: 'Your training' } }} />)
    await screen.findByText('Profile revision 2')
    const initialGoal = (screen.getByLabelText('Training goal') as HTMLSelectElement).value
    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    fireEvent.click(screen.getByRole('button', { name: 'End test coaching connection' }))
    await screen.findByText(/Training controls are paused/)
    expect(screen.queryByLabelText('Training goal')).toBeNull()
    finishCleanup({ kind: 'cleared', clearedCount: 1 })
    await waitFor(() => expect((screen.getByLabelText('Training goal') as HTMLSelectElement).value).toBe(initialGoal))
    expect(screen.queryByText(/Training controls are paused/)).toBeNull()
    expect(screen.getByRole('button', { name: 'End test coaching connection' })).toBeTruthy()
  })

  it('keeps athlete controls paused after an account change instead of restoring stale state', async () => {
    serveProfile()
    gatewayMocks.clearRelationshipSessions.mockResolvedValueOnce({ kind: 'account_changed', clearedCount: 0 })
    render(<StrengthBuilderEntry source={{ kind: 'live_subject', subject: { id: subjectId, name: 'Your training' } }} />)
    await screen.findByText('Profile revision 2')
    fireEvent.click(screen.getByRole('button', { name: 'End test coaching connection' }))
    await screen.findByText(/Training controls are paused/)
    await waitFor(() => expect(gatewayMocks.clearRelationshipSessions).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('Training goal')).toBeNull()
  })
})
