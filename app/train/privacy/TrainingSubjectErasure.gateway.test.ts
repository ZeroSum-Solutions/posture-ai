import { afterEach, describe, expect, test, vi } from 'vitest'
import { eraseTrainingSubject, TrainingSubjectErasureError } from './TrainingSubjectErasure.gateway'

const requestId = '77000000-0000-4000-8000-000000000001'
const subjectId = '72000000-0000-4000-8000-000000000001'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('training subject erasure gateway', () => {
  test('sends only the stable request ID and validates its owner-bound receipt', async () => {
    const fetch = vi.fn(async () => response({
      schemaVersion: 'training-subject-erasure.v1', status: 'erased', subjectId, requestId,
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(eraseTrainingSubject({ requestId, expectedSubjectId: subjectId })).resolves.toMatchObject({ status: 'erased' })
    expect(fetch).toHaveBeenCalledWith('/api/training/privacy/erase', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ requestId }),
    }))
  })

  test('rejects a receipt for another request or subject', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      schemaVersion: 'training-subject-erasure.v1', status: 'erased', subjectId: '72000000-0000-4000-8000-000000000099', requestId,
    })))
    await expect(eraseTrainingSubject({ requestId, expectedSubjectId: subjectId })).rejects.toMatchObject({ canRetryExact: true })
  })

  test('marks ambiguous transport and server failures for exact retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('connection lost')))
    await expect(eraseTrainingSubject({ requestId, expectedSubjectId: subjectId })).rejects.toEqual(expect.objectContaining({ canRetryExact: true }))

    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unavailable' }, 503)))
    await expect(eraseTrainingSubject({ requestId, expectedSubjectId: subjectId })).rejects.toEqual(expect.objectContaining({ canRetryExact: true }))
  })

  test('does not invite retries after a definitive denial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'forbidden' }, 403)))
    const promise = eraseTrainingSubject({ requestId, expectedSubjectId: subjectId })
    await expect(promise).rejects.toBeInstanceOf(TrainingSubjectErasureError)
    await expect(promise).rejects.toMatchObject({ canRetryExact: false })
  })
})
