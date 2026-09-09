import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/previous-performance', () => ({
  readPreviousComparablePerformance: mocks.read,
}))

import { GET } from './route'

const request = new Request('http://localhost/api/training/sessions/session-1/exercises/press-1/previous-performance')
const params = { params: Promise.resolve({ sessionId: 'session-1', exerciseInstanceId: 'press-1' }) }

function projection(result: unknown) {
  return {
    schemaVersion: 'training-previous-performance.v1',
    request: { sessionId: 'session-1', exerciseInstanceId: 'press-1' },
    result,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, supabase: { authenticated: true } })
})

describe('previous comparable performance route', () => {
  it('uses the authenticated RLS client and returns available, none, and metadata-unavailable projections', async () => {
    for (const result of [
      { kind: 'available', source: {}, sets: [] },
      { kind: 'none', reason: 'no_comparable_completed_exposure' },
      { kind: 'unavailable', reason: 'historical_evidence_unavailable' },
    ]) {
      mocks.read.mockResolvedValueOnce(projection(result))
      const response = await GET(request, params)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(projection(result))
    }
    expect(mocks.read).toHaveBeenNthCalledWith(1, { authenticated: true }, 'session-1', 'press-1')
  })

  it('returns a typed unavailable projection with 503 when persistence fails', async () => {
    mocks.read.mockResolvedValue(projection({ kind: 'unavailable', reason: 'persistence_unavailable' }))
    const response = await GET(request, params)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(projection({ kind: 'unavailable', reason: 'persistence_unavailable' }))
  })

  it('keeps invisible rows and malformed route identifiers indistinguishable from other resource routes', async () => {
    mocks.read.mockResolvedValueOnce({ kind: 'not_found' })
    expect((await GET(request, params)).status).toBe(404)

    expect((await GET(request, {
      params: Promise.resolve({ sessionId: 'bad id', exerciseInstanceId: 'press-1' }),
    })).status).toBe(400)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })

  it('does not read evidence when the authenticated actor gate fails', async () => {
    mocks.context.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await GET(request, params)).status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
