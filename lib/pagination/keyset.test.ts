import { describe, expect, it } from 'vitest'
import {
  encodeKeysetCursor,
  finalizeKeysetPage,
  parseKeysetPageRequest,
  type KeysetRow,
} from './keyset'

const NOW = '2026-07-22T16:40:00.000Z'

function params(value = '') {
  return new URLSearchParams(value)
}

describe('keyset pagination contract', () => {
  it('defaults to the frozen 50-record maximum and binds a new snapshot', () => {
    expect(parseKeysetPageRequest(params(), {
      scope: 'clients',
      filterKey: 'search=',
      now: () => new Date(NOW),
    })).toEqual({
      ok: true,
      value: {
        limit: 50,
        snapshotAt: NOW,
        after: null,
      },
    })
  })

  it.each(['0', '-1', '1.5', '51', 'not-a-number'])('rejects invalid limit %s', (limit) => {
    expect(parseKeysetPageRequest(params(`limit=${encodeURIComponent(limit)}`), {
      scope: 'clients',
      filterKey: 'search=',
      now: () => new Date(NOW),
    })).toMatchObject({ ok: false, error: 'Invalid limit' })
  })

  it('accepts a smaller positive page size', () => {
    expect(parseKeysetPageRequest(params('limit=17'), {
      scope: 'clients',
      filterKey: 'search=',
      now: () => new Date(NOW),
    })).toMatchObject({ ok: true, value: { limit: 17 } })
  })

  it('round-trips a cursor only within the same endpoint and filter set', () => {
    const cursor = encodeKeysetCursor({
      scope: 'client-assessments',
      filterKey: 'client=c1&approved=false&exclude=',
      snapshotAt: NOW,
      after: { at: '2026-07-20T12:00:00.000Z', id: 'a-50' },
    })

    expect(parseKeysetPageRequest(params(`cursor=${cursor}&limit=25`), {
      scope: 'client-assessments',
      filterKey: 'client=c1&approved=false&exclude=',
      now: () => new Date('2099-01-01T00:00:00.000Z'),
    })).toEqual({
      ok: true,
      value: {
        limit: 25,
        snapshotAt: NOW,
        after: { at: '2026-07-20T12:00:00.000Z', id: 'a-50' },
      },
    })

    expect(parseKeysetPageRequest(params(`cursor=${cursor}`), {
      scope: 'client-assessments',
      filterKey: 'client=c2&approved=false&exclude=',
    })).toMatchObject({ ok: false, error: 'Cursor does not match this request' })

    expect(parseKeysetPageRequest(params(`cursor=${cursor}`), {
      scope: 'clients',
      filterKey: 'client=c1&approved=false&exclude=',
    })).toMatchObject({ ok: false, error: 'Cursor does not match this request' })
  })

  it.each([
    'garbage',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({
      version: 1,
      scope: 'clients',
      filterKey: 'search=',
      snapshotAt: NOW,
      after: { at: 'not-a-date', id: 'c1' },
    })).toString('base64url'),
    Buffer.from(JSON.stringify({
      version: 1,
      scope: 'clients',
      filterKey: 'search=',
      snapshotAt: NOW,
      after: { at: '2026-07-23T00:00:00.000Z', id: 'c1' },
    })).toString('base64url'),
  ])('rejects malformed or impossible cursor %s', (cursor) => {
    expect(parseKeysetPageRequest(params(`cursor=${cursor}`), {
      scope: 'clients',
      filterKey: 'search=',
    })).toMatchObject({ ok: false, error: 'Invalid cursor' })
  })

  it('uses one look-ahead row without returning more than the frozen page maximum', () => {
    const rows: KeysetRow[] = Array.from({ length: 51 }, (_, index) => ({
      id: `c-${String(index + 1).padStart(3, '0')}`,
      created_at: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
    }))

    const page = finalizeKeysetPage(rows, {
      scope: 'clients',
      filterKey: 'search=',
      snapshotAt: NOW,
      limit: 50,
      key: (row) => ({ at: row.created_at, id: row.id }),
    })

    expect(page.records).toHaveLength(50)
    expect(page.pagination).toMatchObject({
      limit: 50,
      returned: 50,
      has_more: true,
      snapshot_at: NOW,
    })
    expect(page.pagination.next_cursor).toEqual(expect.any(String))
  })

  it('ends traversal without a cursor when no look-ahead row exists', () => {
    const page = finalizeKeysetPage([
      { id: 'c-1', created_at: '2026-07-21T00:00:00.000Z' },
    ], {
      scope: 'clients',
      filterKey: 'search=',
      snapshotAt: NOW,
      limit: 50,
      key: (row) => ({ at: row.created_at, id: row.id }),
    })

    expect(page.pagination).toMatchObject({
      returned: 1,
      has_more: false,
      next_cursor: null,
    })
  })

  it.each([150, 300, 1000])(
    'traverses %i tied-order records with zero duplicates/omissions while a newer record is inserted',
    (recordCount) => {
      const initialRows: KeysetRow[] = Array.from({ length: recordCount }, (_, index) => ({
        id: `c-${String(index + 1).padStart(4, '0')}`,
        // Deliberate timestamp ties prove id is a required second sort key.
        created_at: new Date(Date.parse(NOW) - Math.floor(index / 3) * 1_000).toISOString(),
      }))
      const expected = [...initialRows]
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .map((row) => row.id)
      const source = [...initialRows]
      const visited: string[] = []
      let cursor: string | null = null
      let snapshotAt: string | null = null
      let pages = 0

      do {
        const requestParams = params(cursor ? `limit=50&cursor=${encodeURIComponent(cursor)}` : 'limit=50')
        const parsed = parseKeysetPageRequest(requestParams, {
          scope: 'clients',
          filterKey: 'search=',
          now: () => new Date(NOW),
        })
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) throw new Error(parsed.error)
        snapshotAt ??= parsed.value.snapshotAt

        const candidates = source
          .filter((row) => row.created_at <= parsed.value.snapshotAt)
          .filter((row) => !parsed.value.after
            || row.created_at < parsed.value.after.at
            || (row.created_at === parsed.value.after.at && row.id < parsed.value.after.id))
          .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
          .slice(0, parsed.value.limit + 1)
        const page = finalizeKeysetPage(candidates, {
          scope: 'clients',
          filterKey: 'search=',
          snapshotAt: parsed.value.snapshotAt,
          limit: parsed.value.limit,
          key: (row) => ({ at: row.created_at, id: row.id }),
        })
        visited.push(...page.records.map((row) => row.id))
        cursor = page.pagination.next_cursor
        pages += 1

        if (pages === 1) {
          source.push({
            id: 'c-concurrent-newer',
            created_at: new Date(Date.parse(NOW) + 1_000).toISOString(),
          })
        }
      } while (cursor)

      expect(snapshotAt).toBe(NOW)
      expect(visited).toEqual(expected)
      expect(new Set(visited).size).toBe(recordCount)
      expect(visited).not.toContain('c-concurrent-newer')
    },
  )
})
