import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  rpc: vi.fn(),
  drain: vi.fn(),
  logEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  createSupabaseServiceClient: () => ({ rpc: state.rpc }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: async () => true,
  enforceRateLimitStrict: async () => true,
}))
vi.mock('@/lib/privacy/storageDeletion', () => ({ drainStorageDeletionOutbox: state.drain }))
vi.mock('@/lib/log', () => ({
  hashUser: () => 'user-hash',
  hashResource: () => 'client-hash',
  logEvent: state.logEvent,
}))

import { DELETE } from './route'

const clientId = '20000000-0000-4000-8000-000000000001'

function request(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/clients/${clientId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function invoke(body: Record<string, unknown>) {
  return DELETE(request(body), { params: Promise.resolve({ id: clientId }) })
}

describe('DELETE /api/clients/[id]', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.rpc.mockReset().mockResolvedValue({
      data: {
        status: 'database_erased',
        receipt_id: '30000000-0000-4000-8000-000000000001',
        assessments_purged: 2,
        captures_purged: 8,
        storage_objects_enqueued: 0,
        external_deletion_status: 'complete',
      },
      error: null,
    })
    state.drain.mockReset().mockResolvedValue({ claimed: 0, completed: 0, pending: 0 })
    state.logEvent.mockReset()
  })

  test('rejects free-text erasure reasons before mutation', async () => {
    const response = await invoke({ reason: 'contains client details' })

    expect(response.status).toBe(422)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  test('returns success only after the transactional database phase commits', async () => {
    const response = await invoke({ reason_code: 'subject_request' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'erased',
      external_deletion_status: 'complete',
      assessments_purged: 2,
      captures_purged: 8,
    })
    expect(state.rpc).toHaveBeenCalledWith('erase_client_transactional', expect.objectContaining({
      p_client_id: clientId,
      p_reason_code: 'subject_request',
    }))
  })

  test('reports committed database erasure with visible pending external cleanup', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        status: 'database_erased',
        receipt_id: '30000000-0000-4000-8000-000000000001',
        assessments_purged: 1,
        captures_purged: 4,
        storage_objects_enqueued: 1,
        external_deletion_status: 'pending',
      },
      error: null,
    })
    state.drain.mockResolvedValueOnce({ claimed: 1, completed: 0, pending: 1, receiptStatus: 'pending' })

    const response = await invoke({ reason_code: 'subject_request' })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'erased',
      external_deletion_status: 'pending',
    })
    expect(state.drain).toHaveBeenCalledWith(expect.anything(), {
      receiptId: '30000000-0000-4000-8000-000000000001',
    })
  })

  test('reports complete when a replay drains only the final job from a larger receipt', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        status: 'already_erased',
        receipt_id: '30000000-0000-4000-8000-000000000001',
        assessments_purged: 2,
        captures_purged: 8,
        storage_objects_enqueued: 3,
        external_deletion_status: 'pending',
      },
      error: null,
    })
    state.drain.mockResolvedValueOnce({ claimed: 1, completed: 1, pending: 0, receiptStatus: 'complete' })

    const response = await invoke({ reason_code: 'subject_request' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'already_erased',
      external_deletion_status: 'complete',
      storage_objects_enqueued: 3,
    })
  })

  test('returns the stable receipt on a repeated erasure request', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        status: 'already_erased',
        receipt_id: '30000000-0000-4000-8000-000000000001',
        assessments_purged: 2,
        captures_purged: 8,
        storage_objects_enqueued: 0,
        external_deletion_status: 'complete',
      },
      error: null,
    })

    const response = await invoke({ reason_code: 'subject_request' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'already_erased' })
  })

  test('does not imply partial success when the transaction fails', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'injected failure after step' } })

    const response = await invoke({ reason_code: 'subject_request' })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Could not complete database erasure. No erasure was committed.',
    })
    expect(state.drain).not.toHaveBeenCalled()
    expect(JSON.stringify(state.logEvent.mock.calls)).not.toContain('injected failure')
  })

  test('denies unauthenticated erasure before mutation', async () => {
    state.user = null

    const response = await invoke({ reason_code: 'subject_request' })

    expect(response.status).toBe(401)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
