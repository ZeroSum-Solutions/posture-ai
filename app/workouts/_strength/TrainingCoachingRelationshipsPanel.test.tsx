// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Panel from './TrainingCoachingRelationshipsPanel'

const subjectId = '42000000-0000-4000-8000-000000000001'
const relationshipId = '44000000-0000-4000-8000-000000000001'
const requestId = '45000000-0000-4000-8000-000000000001'
const relationship = {
  relationshipId, subjectId, status: 'active',
  permissions: ['profile:read', 'relationship:revoke'],
  startedAt: '2030-01-01T10:00:00.000Z', endedAt: null,
  revision: 3, canRevoke: true,
  counterpartyDisplayLabel: null, connectionReference: '00000001',
}
const athleteProjection = {
  schemaVersion: 'training-coaching-relationship-list.v1', subjectId, viewerRole: 'athlete',
  relationships: [relationship],
}
const receipt = {
  schemaVersion: 'training-coaching-relationship-revocation.v1', requestId, relationshipId, subjectId,
  status: 'revoked', revision: 4, affectedSessionIds: ['session-1', 'session-2'],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TrainingCoachingRelationshipsPanel', () => {
  it('requires explicit confirmation, binds the revision and hands exact cleanup scope to the owner', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const callback = vi.fn()
    const fetcher = vi.fn().mockResolvedValueOnce(json(athleteProjection)).mockResolvedValueOnce(json(receipt))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={callback} />)

    await screen.findByRole('heading', { name: 'Coach name unavailable · connection 00000001' })
    expect(fetcher.mock.calls[0][0]).toBe('/api/training/coaching/relationships')
    fireEvent.click(screen.getByRole('button', { name: 'End coaching connection' }))
    const dialog = screen.getByRole('alertdialog', { name: 'End this coaching connection?' })
    expect(dialog.textContent).toContain('Existing planned sessions and training history stay available')
    expect(dialog.textContent).toContain('does not create or convert a self-directed program')
    fireEvent.click(screen.getByRole('button', { name: 'End connection and coach access' }))

    await screen.findByText(/Coaching connection ended/)
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ requestId, expectedRevision: 3 })
    expect(fetcher.mock.calls[1][0]).toBe(`/api/training/coaching/relationships/${relationshipId}/revoke`)
    expect(callback).toHaveBeenCalledWith(receipt)
    expect(screen.getByText('No active coaching connection.')).toBeTruthy()
  })

  it('does not invoke cleanup when the receipt is not bound to the frozen request', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const callback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(athleteProjection))
      .mockResolvedValueOnce(json({ ...receipt, requestId: '45000000-0000-4000-8000-000000000002' }))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={callback} />)
    fireEvent.click(await screen.findByRole('button', { name: 'End coaching connection' }))
    fireEvent.click(screen.getByRole('button', { name: 'End connection and coach access' }))
    expect((await screen.findByRole('alert')).textContent).toContain('receipt could not be verified')
    expect(callback).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retry same revocation' })).toBeTruthy()
  })

  it('retries an uncertain outcome with the exact same request and recovers its receipt', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const callback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(athleteProjection))
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockResolvedValueOnce(json(receipt))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={callback} />)
    fireEvent.click(await screen.findByRole('button', { name: 'End coaching connection' }))
    fireEvent.click(screen.getByRole('button', { name: 'End connection and coach access' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same revocation' }))
    await screen.findByText(/Coaching connection ended/)
    expect(fetcher.mock.calls.slice(1).map(call => JSON.parse(call[1].body))).toEqual([
      { requestId, expectedRevision: 3 },
      { requestId, expectedRevision: 3 },
    ])
    expect(callback).toHaveBeenCalledWith(receipt)
  })

  it('reloads after a conflict without replaying the mutation', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const revokedProjection = {
      ...athleteProjection,
      relationships: [{ ...relationship, status: 'revoked', endedAt: '2030-02-01T10:00:00.000Z', revision: 4, canRevoke: false }],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(athleteProjection))
      .mockResolvedValueOnce(json({ error: 'relationship_revision_conflict', action: 'reload_relationships' }, 409))
      .mockResolvedValueOnce(json(revokedProjection))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'End coaching connection' }))
    fireEvent.click(screen.getByRole('button', { name: 'End connection and coach access' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reload connections' }))
    await screen.findByText('Ended connections (1)')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('uses the canonical coach subject selector and hides revocation without permission', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({
      ...athleteProjection,
      viewerRole: 'coach',
      relationships: [{ ...relationship, permissions: ['profile:read'], canRevoke: false }],
    }))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel scope={{ kind: 'coach', subjectId }} onRelationshipRevoked={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Athlete name unavailable · connection 00000001' })
    expect(fetcher.mock.calls[0][0]).toBe(`/api/training/coaching/relationships?subjectId=${subjectId}`)
    expect(screen.queryByRole('button', { name: 'End coaching connection' })).toBeNull()
    expect(screen.getByText(/Only the athlete or a coach with permission/)).toBeTruthy()
  })

  it('blocks denied access and prevents a duplicate revoke while the first request is pending', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 403)))
    const denied = render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('do not have permission')
    denied.unmount()

    let resolveRevoke!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { resolveRevoke = resolve })
    const fetcher = vi.fn().mockResolvedValueOnce(json(athleteProjection)).mockReturnValueOnce(pending)
    vi.stubGlobal('fetch', fetcher)
    render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'End coaching connection' }))
    const confirm = screen.getByRole('button', { name: 'End connection and coach access' })
    fireEvent.click(confirm)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Ending connection…' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Ending connection…' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    resolveRevoke(json(receipt))
    await screen.findByText(/Coaching connection ended/)
  })

  it('does not start offline cleanup when a late success reaches an unmounted panel', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    let resolveRevoke!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { resolveRevoke = resolve })
    const callback = vi.fn()
    const fetcher = vi.fn().mockResolvedValueOnce(json(athleteProjection)).mockReturnValueOnce(pending)
    vi.stubGlobal('fetch', fetcher)
    const rendered = render(<Panel scope={{ kind: 'athlete' }} onRelationshipRevoked={callback} />)
    fireEvent.click(await screen.findByRole('button', { name: 'End coaching connection' }))
    fireEvent.click(screen.getByRole('button', { name: 'End connection and coach access' }))
    rendered.unmount()
    resolveRevoke(json(receipt))
    await Promise.resolve()
    await Promise.resolve()
    expect(callback).not.toHaveBeenCalled()
  })
})
