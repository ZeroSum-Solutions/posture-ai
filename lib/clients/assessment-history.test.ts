import { describe, expect, it } from 'vitest'
import {
  CLIENT_ASSESSMENT_LIST_SCOPE,
  clientAssessmentHistoryFilterKey,
} from './assessment-history'
import { encodeKeysetCursor, parseKeysetPageRequest } from '@/lib/pagination/keyset'

describe('client assessment history cursor contract', () => {
  it('round-trips a server-seeded cursor through the follow-up API request', () => {
    const clientId = '8c5c240c-ff8c-58a4-a1bf-f6fa058c29c5'
    const filterKey = clientAssessmentHistoryFilterKey({
      clientId,
      includeFindings: true,
      approvedOnly: false,
    })
    const cursor = encodeKeysetCursor({
      scope: CLIENT_ASSESSMENT_LIST_SCOPE,
      filterKey,
      snapshotAt: '2026-07-23T12:00:00.000Z',
      after: {
        at: '2026-07-20T12:00:00.000Z',
        id: '12345678-1234-4123-8123-123456789abc',
      },
    })
    const request = new URLSearchParams({
      include_findings: 'true',
      limit: '50',
      cursor,
    })

    expect(parseKeysetPageRequest(request, {
      scope: CLIENT_ASSESSMENT_LIST_SCOPE,
      filterKey: clientAssessmentHistoryFilterKey({
        clientId,
        includeFindings: request.get('include_findings') === 'true',
        approvedOnly: false,
      }),
    })).toEqual({
      ok: true,
      value: {
        limit: 50,
        snapshotAt: '2026-07-23T12:00:00.000Z',
        after: {
          at: '2026-07-20T12:00:00.000Z',
          id: '12345678-1234-4123-8123-123456789abc',
        },
      },
    })
  })
})
