import { describe, test, expect } from 'vitest'
import { buildRunUpdate, mergeRunItems, type RunRow } from './runState'

const NOW = '2026-07-02T12:00:00.000Z'
const LATER = '2026-07-02T12:05:00.000Z'

const base: RunRow = {
  status: 'started',
  current_item_index: 0,
  items: [{ slug: 'a', completed: false, skipped: false }],
  total_duration_ms: 0,
  last_paused_at: null,
  completed_at: null,
}

describe('runState.buildRunUpdate — idempotent, guarded playback merge', () => {
  test('advances current_item_index to the patch value and stamps updated_at', () => {
    const u = buildRunUpdate(base, { current_item_index: 2 }, NOW)
    expect(u.current_item_index).toBe(2)
    expect(u.updated_at).toBe(NOW)
  })

  test('OR-merges item completion by slug so a resume cannot un-complete an item', () => {
    const first = buildRunUpdate(base, { items: [{ slug: 'a', completed: true, skipped: false, durationMs: 5000 }] }, NOW)
    const later = buildRunUpdate(
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
    const done = buildRunUpdate(base, { status: 'completed' }, NOW)
    expect(done.status).toBe('completed')
    expect(done.completed_at).toBe(NOW)
    const after = buildRunUpdate({ ...base, status: 'completed', completed_at: NOW }, { status: 'in_progress' }, LATER)
    expect(after.status).toBe('completed')
    expect(after.completed_at).toBe(NOW)
  })

  test('pausing stamps last_paused_at', () => {
    const u = buildRunUpdate(base, { status: 'paused' }, NOW)
    expect(u.status).toBe('paused')
    expect(u.last_paused_at).toBe(NOW)
  })

  test('total_duration_ms is monotonic (never regresses)', () => {
    const u = buildRunUpdate({ ...base, total_duration_ms: 8000 }, { total_duration_ms: 3000 }, NOW)
    expect(u.total_duration_ms).toBe(8000)
  })

  test('applying the same patch twice is idempotent', () => {
    const patch = { current_item_index: 1, status: 'in_progress' as const, items: [{ slug: 'a', completed: true, skipped: false }] }
    const once = buildRunUpdate(base, patch, NOW)
    const twice = buildRunUpdate({ ...base, ...once }, patch, LATER)
    expect(twice.current_item_index).toBe(once.current_item_index)
    expect(twice.status).toBe(once.status)
    expect(twice.items).toEqual(once.items)
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
