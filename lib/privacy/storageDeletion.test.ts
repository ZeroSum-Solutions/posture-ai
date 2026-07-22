import { describe, expect, test, vi } from 'vitest'
import { drainStorageDeletionOutbox } from './storageDeletion'

function service({ removeError = null }: { removeError?: { message: string } | null } = {}) {
  const rpc = vi.fn()
    .mockResolvedValueOnce({
      data: [{ id: 'job-1', bucket: 'posture-reports', object_path: 'reports/a.pdf' }],
      error: null,
    })
    .mockResolvedValue({ data: true, error: null })
  const remove = vi.fn().mockResolvedValue({ error: removeError })
  return {
    client: {
      rpc,
      storage: { from: vi.fn(() => ({ remove })) },
      from: vi.fn(() => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { external_deletion_status: 'complete' }, error: null }),
        }
        return query
      }),
    },
    rpc,
    remove,
  }
}

describe('drainStorageDeletionOutbox', () => {
  test('makes a failed claim visible to the scheduler', async () => {
    const fixture = service()
    fixture.rpc.mockReset().mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })

    const result = await drainStorageDeletionOutbox(fixture.client as never)

    expect(result).toEqual({ claimed: 0, completed: 0, pending: 1, claimFailed: true })
    expect(fixture.remove).not.toHaveBeenCalled()
  })

  test('claims jobs, deletes the external object, and marks completion', async () => {
    const fixture = service()

    const result = await drainStorageDeletionOutbox(fixture.client as never)

    expect(result).toEqual({ claimed: 1, completed: 1, pending: 0 })
    expect(fixture.remove).toHaveBeenCalledWith(['reports/a.pdf'])
    expect(fixture.rpc).toHaveBeenNthCalledWith(2, 'complete_privacy_storage_deletion', {
      p_job_id: 'job-1', p_succeeded: true, p_error_code: null,
    })
  })

  test('records only a controlled error code so a later run can retry', async () => {
    const fixture = service({ removeError: { message: 'provider leaked a client name here' } })

    const result = await drainStorageDeletionOutbox(fixture.client as never)

    expect(result).toEqual({ claimed: 1, completed: 0, pending: 1 })
    expect(fixture.rpc).toHaveBeenNthCalledWith(2, 'complete_privacy_storage_deletion', {
      p_job_id: 'job-1', p_succeeded: false, p_error_code: 'storage_delete_failed',
    })
    expect(JSON.stringify(fixture.rpc.mock.calls)).not.toContain('client name')
  })

  test('reads the durable receipt after a targeted drain instead of inferring lifetime status from this batch', async () => {
    const fixture = service()

    const result = await drainStorageDeletionOutbox(fixture.client as never, { receiptId: 'receipt-1' })

    expect(result).toEqual({ claimed: 1, completed: 1, pending: 0, receiptStatus: 'complete' })
    expect(fixture.client.from).toHaveBeenCalledWith('client_deletion_log')
  })
})
