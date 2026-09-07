import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type QueryResult = { data: unknown; error: unknown; count?: number | null }

const state = vi.hoisted(() => ({
  scoreRanges: [] as Array<{ start: string; from: number; to: number }>,
  scoreErrorAt: null as number | null,
}))

function query(table: string) {
  const filters = new Map<string, unknown>()
  let selected = ''
  let from = 0
  let to = 999
  const q = {
    select(columns: string) { selected = columns; return q },
    eq(column: string, value: unknown) { filters.set(column, value); return q },
    is() { return q },
    gte(column: string, value: unknown) { filters.set(`gte:${column}`, value); return q },
    lte(column: string, value: unknown) { filters.set(`lte:${column}`, value); return q },
    lt(column: string, value: unknown) { filters.set(`lt:${column}`, value); return q },
    order() { return q },
    limit() { return q },
    range(rangeFrom: number, rangeTo: number) { from = rangeFrom; to = rangeTo; return q },
    maybeSingle: async () => selected === 'display_name'
      ? { data: { display_name: 'Ada Lovelace' }, error: null }
      : { data: null, error: { message: 'column practitioners.first_name does not exist' } },
    then(onFulfilled: (value: QueryResult) => unknown, onRejected: (reason: unknown) => unknown) {
      let result: QueryResult = { data: [], error: null, count: 0 }
      if (table === 'assessments' && selected === 'overall_score') {
        const start = String(filters.get('gte:created_at'))
        const isCurrentWeek = start.startsWith('2026-07-31')
        const scores = isCurrentWeek
          ? [
              ...Array.from({ length: 494 }, () => ({ overall_score: 100 })),
              { overall_score: 50 },
              ...Array.from({ length: 505 }, () => ({ overall_score: 0 })),
              { overall_score: 100 },
            ]
          : [{ overall_score: 20 }]
        state.scoreRanges.push({ start, from, to })
        result = state.scoreErrorAt === from
          ? { data: null, error: { message: 'page failed' }, count: scores.length }
          : { data: scores.slice(from, to + 1), error: null, count: scores.length }
      } else if (table === 'clients' && selected.includes('first_name')) {
        result = { data: { first_name: 'Ada', last_name: 'Lovelace' }, error: null }
      }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'practitioner-1' } } }) },
    from: (table: string) => query(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import DashboardPage from './page'
import type { TodayModel } from './todayModel'

describe('DashboardPage score averages', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T12:00:00.000Z'))
    state.scoreRanges.length = 0
    state.scoreErrorAt = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('uses the practitioner display name supported by the database for avatar initials', async () => {
    const page = await DashboardPage() as ReactElement<{ practitionerInitials: string }>
    expect(page.props.practitionerInitials).toBe('AL')
  })

  test('includes the 1,001st weekly score instead of averaging one PostgREST page', async () => {
    const page = await DashboardPage() as ReactElement<{ model: TodayModel }>
    const scoreMetric = page.props.model.metrics.find((metric) => metric.key === 'score')

    expect(scoreMetric?.value).toBe('50')
    expect(state.scoreRanges.filter((range) => range.start.startsWith('2026-07-31'))).toEqual([
      expect.objectContaining({ from: 0, to: 499 }),
      expect.objectContaining({ from: 500, to: 999 }),
      expect.objectContaining({ from: 1000, to: 1499 }),
    ])
  })

  test('shows a load error instead of presenting a partial average when a later page fails', async () => {
    state.scoreErrorAt = 500

    const page = await DashboardPage() as ReactElement<{ model: TodayModel; loadError: string | null }>
    const scoreMetric = page.props.model.metrics.find((metric) => metric.key === 'score')

    expect(scoreMetric?.value).toBe('—')
    expect(page.props.loadError).toBe('Some dashboard data could not load. Refresh to try again.')
  })
})
