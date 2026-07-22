import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  drain: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: state.rpc }),
}))
vi.mock('@/lib/privacy/storageDeletion', () => ({ drainStorageDeletionOutbox: state.drain }))

import { GET } from './route'

describe('GET /api/internal/privacy-maintenance', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'fixture-cron-secret'
    state.rpc.mockReset().mockImplementation(async (name: string) => name === 'reconcile_legacy_client_erasures'
      ? { data: { clients_reconciled: 0 }, error: null }
      : { data: { policies_run: 0, rows_deleted: 0 }, error: null })
    state.drain.mockReset().mockResolvedValue({ claimed: 0, completed: 0, pending: 0 })
  })

  test('fails closed when the scheduler secret is absent', async () => {
    delete process.env.CRON_SECRET

    const response = await GET(new NextRequest('http://localhost/api/internal/privacy-maintenance'))

    expect(response.status).toBe(503)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  test('denies a caller without the exact bearer secret', async () => {
    const response = await GET(new NextRequest('http://localhost/api/internal/privacy-maintenance', {
      headers: { authorization: 'Bearer wrong' },
    }))

    expect(response.status).toBe(401)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  test('drains retryable storage jobs and runs only approved retention policies', async () => {
    state.drain.mockResolvedValueOnce({ claimed: 2, completed: 1, pending: 1 })
    state.rpc.mockImplementation(async (name: string) => name === 'reconcile_legacy_client_erasures'
      ? { data: { clients_reconciled: 2 }, error: null }
      : { data: { policies_run: 1, rows_deleted: 3 }, error: null })
    const response = await GET(new NextRequest('http://localhost/api/internal/privacy-maintenance', {
      headers: { authorization: 'Bearer fixture-cron-secret' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      reconciliation: { clients_reconciled: 2 },
      storage: { claimed: 2, completed: 1, pending: 1 },
      retention: { policies_run: 1, rows_deleted: 3 },
    })
    expect(state.rpc).toHaveBeenCalledWith('reconcile_legacy_client_erasures', { p_limit: 100 })
    expect(state.rpc).toHaveBeenCalledWith('run_approved_privacy_retention', expect.objectContaining({ p_now: expect.any(String) }))
  })

  test('reports a failed outbox claim as unhealthy even when retention succeeds', async () => {
    state.drain.mockResolvedValueOnce({ claimed: 0, completed: 0, pending: 1, claimFailed: true })
    const response = await GET(new NextRequest('http://localhost/api/internal/privacy-maintenance', {
      headers: { authorization: 'Bearer fixture-cron-secret' },
    }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Privacy maintenance did not complete.' })
  })

  test('reports legacy reconciliation failure before claiming storage work', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })
    const response = await GET(new NextRequest('http://localhost/api/internal/privacy-maintenance', {
      headers: { authorization: 'Bearer fixture-cron-secret' },
    }))

    expect(response.status).toBe(500)
    expect(state.drain).not.toHaveBeenCalled()
  })
})
