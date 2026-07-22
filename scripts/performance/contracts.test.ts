import { describe, expect, it } from 'vitest'
import {
  assertExactFixtureCounts,
  assertFixtureRestored,
  assertPerformanceUrls,
  deterministicUuid,
  isCliEntry,
  summarizeTraversal,
  traverseCursorPages,
  withExactFixtureRestoration,
  type TimedCursorPage,
} from './contracts'

describe('performance harness safety', () => {
  it('recognizes direct Node and vite-node entrypoint argv shapes', () => {
    const url = 'file:///repo/scripts/performance/seed.ts'
    expect(isCliEntry(url, ['node', '/repo/scripts/performance/seed.ts'])).toBe(true)
    expect(isCliEntry(url, ['node', '/repo/node_modules/.bin/vite-node'])).toBe(true)
    expect(isCliEntry(url, ['node', '/repo/node_modules/.bin/vitest'])).toBe(false)
  })

  it('accepts only loopback application, Supabase, and database URLs', () => {
    expect(assertPerformanceUrls({
      appUrl: 'http://127.0.0.1:3000',
      supabaseUrl: 'http://localhost:54321',
      databaseUrl: 'postgresql://postgres:postgres@[::1]:54322/postgres',
    }).database.hostname).toContain('::1')
  })

  it.each([
    ['appUrl', 'https://posture-ai.example.com'],
    ['supabaseUrl', 'https://example.supabase.co'],
    ['databaseUrl', 'postgresql://postgres:secret@db.example.com/postgres'],
    ['appUrl', 'http://0.0.0.0:3000'],
    ['supabaseUrl', 'http://localhost.evil.example:54321'],
  ] as const)('rejects a non-loopback %s', (key, unsafe) => {
    const urls = {
      appUrl: 'http://127.0.0.1:3000',
      supabaseUrl: 'http://127.0.0.1:54321',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      [key]: unsafe,
    }
    expect(() => assertPerformanceUrls(urls)).toThrow(/loopback/)
  })

  it('rejects HTTP credentials and wrong protocols', () => {
    expect(() => assertPerformanceUrls({
      appUrl: 'http://user:secret@127.0.0.1:3000',
      supabaseUrl: 'http://127.0.0.1:54321',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })).toThrow(/must not contain credentials/)
    expect(() => assertPerformanceUrls({
      appUrl: 'file:///tmp/app',
      supabaseUrl: 'http://127.0.0.1:54321',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })).toThrow()
  })
})

describe('performance fixture identity and counts', () => {
  it('generates stable canonical UUIDs with distinct names', () => {
    const one = deterministicUuid('150:client:1')
    expect(one).toBe(deterministicUuid('150:client:1'))
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(one).not.toBe(deterministicUuid('150:client:2'))
  })

  it('accepts only the exact client, assessment, and findings counts', () => {
    expect(() => assertExactFixtureCounts(150, {
      activeClients: 150,
      completeAnchorAssessments: 150,
      findingsPerAssessment: 7,
      assessmentFindings: 1050,
    })).not.toThrow()
    expect(() => assertExactFixtureCounts(150, {
      activeClients: 149,
      completeAnchorAssessments: 150,
      findingsPerAssessment: 7,
      assessmentFindings: 1049,
    })).toThrow(/active clients 149|assessment findings 1049/)
  })

  it('fails if concurrent traversal cleanup does not restore exact N', () => {
    expect(() => assertFixtureRestored(300, 300, 'test traversal')).not.toThrow()
    expect(() => assertFixtureRestored(300, 301, 'test traversal')).toThrow(/not restored.*301.*300/)
    expect(() => assertFixtureRestored(300, 299, 'test traversal')).toThrow(/not restored.*299.*300/)
  })

  it('cleans up and verifies exact N before the next concurrent traversal', async () => {
    let count = 150
    const events: string[] = []
    await expect(withExactFixtureRestoration({
      expectedRecords: 150,
      context: 'cursor-1',
      async countRecords() { events.push(`count:${count}`); return count },
      async cleanup() { events.push('cleanup'); count = 150 },
      async run() { events.push('run'); count = 151; return 'ok' },
    })).resolves.toBe('ok')
    expect(events).toEqual(['count:150', 'run', 'cleanup', 'count:150'])

    events.length = 0
    await expect(withExactFixtureRestoration({
      expectedRecords: 150,
      context: 'cursor-2',
      async countRecords() { events.push(`count:${count}`); return count },
      async cleanup() { events.push('cleanup'); count = 150 },
      async run() { events.push('run'); count = 151; throw new Error('request failed') },
    })).rejects.toThrow('request failed')
    expect(events).toEqual(['count:150', 'run', 'cleanup', 'count:150'])
  })
})

describe('cursor traversal helpers', () => {
  it('detects omissions, duplicates, and a leaked concurrent insert', () => {
    const page: TimedCursorPage = {
      ids: ['a', 'a', 'new'],
      nextCursor: null,
      hasMore: false,
      durationMilliseconds: 1,
      decodedResponseBodyUtf8Bytes: 20,
      responseContentEncoding: 'identity',
      status: 200,
    }
    expect(summarizeTraversal(['a', 'b'], page.ids, 'new', [page])).toMatchObject({
      duplicateRecordCount: 1,
      omittedRecordCount: 1,
      unexpectedRecordCount: 1,
      concurrentRecordReturned: true,
    })
  })

  it('traverses a snapshot without duplicates or omissions after a newer insert', async () => {
    const expectedIds = Array.from({ length: 150 }, (_, index) => `id-${index}`)
    const snapshot = [...expectedIds]
    const live = [...snapshot]
    let inserted = false
    const result = await traverseCursorPages({
      expectedIds,
      concurrentId: 'newer-id',
      async requestPage(cursor) {
        const offset = cursor ? Number(cursor) : 0
        const ids = snapshot.slice(offset, offset + 50)
        const nextOffset = offset + ids.length
        return {
          ids,
          nextCursor: nextOffset < snapshot.length ? String(nextOffset) : null,
          hasMore: nextOffset < snapshot.length,
          durationMilliseconds: 2,
          decodedResponseBodyUtf8Bytes: ids.length * 10,
          responseContentEncoding: 'identity',
          status: 200,
        }
      },
      async insertNewerAfterFirstPage() {
        live.unshift('newer-id')
        inserted = true
      },
    })
    expect(inserted).toBe(true)
    expect(live).toHaveLength(151)
    expect(result.integrity).toMatchObject({
      expectedRecordCount: 150,
      returnedRecordCount: 150,
      duplicateRecordCount: 0,
      omittedRecordCount: 0,
      unexpectedRecordCount: 0,
      concurrentRecordReturned: false,
      pageCount: 3,
      maximumPageRecords: 50,
    })
  })

  it('fails closed on repeated cursors', async () => {
    await expect(traverseCursorPages({
      expectedIds: ['a', 'b'],
      concurrentId: 'new',
      requestPage: async () => ({
        ids: ['a'],
        nextCursor: 'same',
        hasMore: true,
        durationMilliseconds: 1,
        decodedResponseBodyUtf8Bytes: 1,
        responseContentEncoding: 'identity',
        status: 200,
      }),
      insertNewerAfterFirstPage: async () => {},
      maximumPages: 3,
    })).rejects.toThrow(/forward progress/)
  })
})
