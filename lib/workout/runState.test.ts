import { describe, test, expect } from 'vitest'
import { buildRunUpdate, mergeRunItems, redFlagBlocksCompletion, type RunRow } from './runState'

// Non-null wrapper for cases where the patch is never stale (throws in-test otherwise).
const mustBuild = (...args: Parameters<typeof buildRunUpdate>) => {
  const u = buildRunUpdate(...args)
  if (!u) throw new Error('unexpected stale-revision drop')
  return u
}

const NOW = '2026-07-02T12:00:00.000Z'
const LATER = '2026-07-02T12:05:00.000Z'

const base: RunRow = {
  status: 'started',
  current_item_index: 0,
  items: [{ slug: 'a', completed: false, skipped: false }],
  total_duration_ms: 0,
  last_paused_at: null,
  completed_at: null,
  revision: 0,
}

describe('runState.buildRunUpdate — idempotent, guarded playback merge', () => {
  test('advances current_item_index to the patch value and stamps updated_at', () => {
    const u = mustBuild(base, { current_item_index: 2 }, NOW)
    expect(u.current_item_index).toBe(2)
    expect(u.updated_at).toBe(NOW)
  })

  test('OR-merges item completion by slug so a resume cannot un-complete an item', () => {
    const first = mustBuild(base, { items: [{ slug: 'a', completed: true, skipped: false, durationMs: 5000 }] }, NOW)
    const later = mustBuild(
      { ...base, items: first.items },
      { items: [{ slug: 'a', completed: false, skipped: false }, { slug: 'b', completed: true, skipped: false }] },
      LATER,
    )
    const a = later.items.find((i) => i.slug === 'a')!
    const b = later.items.find((i) => i.slug === 'b')!
    expect(a.completed).toBe(true) // preserved despite the later incomplete re-send
    expect(a.durationMs).toBe(5000) // max preserved
    expect(b.completed).toBe(true)
  })

  test("status 'completed' is terminal — a later downgrade is ignored and completion time is preserved", () => {
    const done = mustBuild(base, { status: 'completed' }, NOW)
    expect(done.status).toBe('completed')
    expect(done.completed_at).toBe(NOW)
    const after = mustBuild({ ...base, status: 'completed', completed_at: NOW }, { status: 'in_progress' }, LATER)
    expect(after.status).toBe('completed')
    expect(after.completed_at).toBe(NOW)
  })

  test('pausing stamps last_paused_at', () => {
    const u = mustBuild(base, { status: 'paused' }, NOW)
    expect(u.status).toBe('paused')
    expect(u.last_paused_at).toBe(NOW)
  })

  test('total_duration_ms is monotonic (never regresses)', () => {
    const u = mustBuild({ ...base, total_duration_ms: 8000 }, { total_duration_ms: 3000 }, NOW)
    expect(u.total_duration_ms).toBe(8000)
  })

  test('applying the same patch twice is idempotent', () => {
    const patch = { current_item_index: 1, status: 'in_progress' as const, items: [{ slug: 'a', completed: true, skipped: false }] }
    const once = mustBuild(base, patch, NOW)
    const twice = mustBuild({ ...base, ...once }, patch, LATER)
    expect(twice.current_item_index).toBe(once.current_item_index)
    expect(twice.status).toBe(once.status)
    expect(twice.items).toEqual(once.items)
  })
})

describe('runState.buildRunUpdate — revisioned writes (authoritative replace)', () => {
  const withRev: RunRow = {
    ...base,
    revision: 3,
    items: [
      { slug: 'a', completed: true, skipped: false },
      { slug: 'b', completed: true, skipped: false },
    ],
  }

  test('a higher revision REPLACES items outright — Back can un-complete an item', () => {
    // Player semantics: BACK clears the target item's result before replaying.
    // The revisioned write is the newest full client state, so it wins verbatim.
    const u = mustBuild(
      withRev,
      { revision: 4, items: [{ slug: 'a', completed: true, skipped: false }, { slug: 'b', completed: false, skipped: true }] },
      NOW,
    )
    expect(u).not.toBeNull()
    expect(u.revision).toBe(4)
    expect(u.items.find((i) => i.slug === 'b')).toEqual({ slug: 'b', completed: false, skipped: true })
  })

  test('a stale or duplicate revision is dropped (returns null)', () => {
    expect(buildRunUpdate(withRev, { revision: 3, items: [] }, NOW)).toBeNull()
    expect(buildRunUpdate(withRev, { revision: 2, items: [{ slug: 'a', completed: false, skipped: false }] }, NOW)).toBeNull()
  })

  test('a patch without a revision keeps the legacy OR-merge path', () => {
    const u = mustBuild(withRev, { items: [{ slug: 'a', completed: false, skipped: false }] }, NOW)
    expect(u).not.toBeNull()
    expect(u.items.find((i) => i.slug === 'a')!.completed).toBe(true) // merge preserved
    expect(u.revision).toBe(3) // unchanged
  })

  test("revisioned writes still respect terminal 'completed' status and monotonic duration", () => {
    const done: RunRow = { ...withRev, status: 'completed', completed_at: NOW, total_duration_ms: 90_000 }
    const u = mustBuild(done, { revision: 9, status: 'in_progress', total_duration_ms: 1000, items: [] }, LATER)
    expect(u).not.toBeNull()
    expect(u.status).toBe('completed')
    expect(u.completed_at).toBe(NOW)
    expect(u.total_duration_ms).toBe(90_000)
  })
})

describe('runState.buildRunUpdate — red_flag_acknowledged', () => {
  test('a patch carrying red_flag_acknowledged persists it regardless of other fields', () => {
    const u = mustBuild(base, { red_flag_acknowledged: true }, NOW)
    expect(u.red_flag_acknowledged).toBe(true)
  })

  test('red_flag_acknowledged remains true when a subsequent patch omits it', () => {
    const acknowledged: RunRow = { ...base, red_flag_acknowledged: true }
    const u = mustBuild(acknowledged, { status: 'in_progress' }, NOW)
    expect(u.red_flag_acknowledged).toBe(true)
  })

  test('red_flag_acknowledged is null when neither the patch nor the row carries it', () => {
    const u = mustBuild(base, { status: 'in_progress' }, NOW)
    expect(u.red_flag_acknowledged).toBeNull()
  })
})

describe('runState.mergeRunItems', () => {
  test('unions items across resumes, preserving completion and max duration', () => {
    const merged = mergeRunItems(
      [{ slug: 'a', completed: true, skipped: false, durationMs: 4000 }],
      [{ slug: 'a', completed: false, skipped: false, durationMs: 1000 }, { slug: 'b', completed: false, skipped: true }],
    )
    expect(merged).toHaveLength(2)
    expect(merged.find((i) => i.slug === 'a')).toEqual({ slug: 'a', completed: true, skipped: false, durationMs: 4000 })
    expect(merged.find((i) => i.slug === 'b')).toEqual({ slug: 'b', completed: false, skipped: true })
  })
})

describe('runState.redFlagBlocksCompletion', () => {
  const row = (over: Partial<RunRow> = {}): RunRow => ({
    status: 'in_progress',
    current_item_index: 1,
    items: [],
    total_duration_ms: 1000,
    last_paused_at: null,
    completed_at: null,
    revision: 3,
    red_flag_acknowledged: null,
    ...over,
  })

  test('blocks completion when ack is absent everywhere', () => {
    expect(redFlagBlocksCompletion(row(), { status: 'completed' })).toBe(true)
  })
  test('allows completion when the patch itself carries the ack', () => {
    expect(redFlagBlocksCompletion(row(), { status: 'completed', red_flag_acknowledged: true })).toBe(false)
  })
  test('allows completion when the row was already acknowledged', () => {
    expect(redFlagBlocksCompletion(row({ red_flag_acknowledged: true }), { status: 'completed' })).toBe(false)
  })
  test('never blocks non-completing patches', () => {
    expect(redFlagBlocksCompletion(row(), { status: 'in_progress' })).toBe(false)
    expect(redFlagBlocksCompletion(row(), { current_item_index: 2 })).toBe(false)
  })
  test('never blocks a re-send to an already-completed run (terminal, no-op)', () => {
    expect(redFlagBlocksCompletion(row({ status: 'completed' }), { status: 'completed' })).toBe(false)
  })
})
