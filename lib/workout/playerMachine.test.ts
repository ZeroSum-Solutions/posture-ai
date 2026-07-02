import { describe, test, expect } from 'vitest'
import type { SessionItem, SessionSnapshot, SessionTiming } from './generateWorkoutSession'
import {
  initPlayer,
  playerReducer,
  resumePlayer,
  UP_NEXT_MS,
  PREROLL_MS,
  type PlayerState,
} from './playerMachine'

// --- fixtures -------------------------------------------------------------
let seq = 0
function item(timing: SessionTiming, over: Partial<SessionItem> = {}): SessionItem {
  const i = seq++
  return {
    index: i,
    slug: `ex-${i}`,
    baseSlug: `ex-${i}`,
    name: `Exercise ${i}`,
    category: 'stretch',
    stepLabel: 'Lengthen',
    priorityKey: 'p',
    priorityLabel: 'Priority',
    isIntegrative: false,
    instructions: 'Do the thing calmly.',
    timing,
    ...over,
  }
}
const hold = (sets: number, secondsPerSet: number, restSeconds: number): SessionTiming => ({
  kind: 'hold',
  sets,
  secondsPerSet,
  restSeconds,
})
const reps = (sets: number, repsPerSet: number, restSeconds: number): SessionTiming => ({
  kind: 'reps',
  sets,
  repsPerSet,
  restSeconds,
})
// Fast-forward from idle to playing the first set (skipping the up-next + preroll waits).
function toPlaying(snap: SessionSnapshot): PlayerState {
  return run(
    initPlayer(snap),
    { type: 'START' },
    { type: 'ADVANCE' }, // intro -> upNext[0]
    { type: 'ADVANCE' }, // upNext -> preroll
    { type: 'ADVANCE' }, // preroll -> playing
  )
}
function snapshot(items: SessionItem[]): SessionSnapshot {
  return {
    version: 1,
    week: 1,
    capability: 'standard',
    priorities: [],
    items,
    estimatedDurationSec: 120,
    disclaimer: 'Screening only.',
  }
}

// Drive a sequence of actions from a starting state.
function run(state: PlayerState, ...actions: Parameters<typeof playerReducer>[1][]): PlayerState {
  return actions.reduce((s, a) => playerReducer(s, a), state)
}

// --- the hold-item lifecycle spine ---------------------------------------
describe('playerMachine — single hold item lifecycle', () => {
  const snap = snapshot([item(hold(2, 30, 10))])

  test('initializes idle at item 0 with no results recorded', () => {
    const s = initPlayer(snap)
    expect(s.phase).toBe('idle')
    expect(s.index).toBe(0)
    expect(s.results).toEqual([{ completed: false, skipped: false }])
    expect(s.paused).toBe(false)
  })

  test('START moves idle -> intro', () => {
    const s = playerReducer(initPlayer(snap), { type: 'START' })
    expect(s.phase).toBe('intro')
  })

  test('ADVANCE from intro enters the first item up-next', () => {
    const s = run(initPlayer(snap), { type: 'START' }, { type: 'ADVANCE' })
    expect(s.phase).toBe('upNext')
    expect(s.index).toBe(0)
    expect(s.remainingMs).toBe(UP_NEXT_MS)
  })

  test('up-next ticks into the 3-2-1 preroll', () => {
    const s = run(initPlayer(snap), { type: 'START' }, { type: 'ADVANCE' }, { type: 'TICK', ms: UP_NEXT_MS })
    expect(s.phase).toBe('preroll')
    expect(s.remainingMs).toBe(PREROLL_MS)
  })

  test('preroll ticks into playing the first set with the hold countdown', () => {
    const s = run(
      initPlayer(snap),
      { type: 'START' },
      { type: 'ADVANCE' },
      { type: 'TICK', ms: UP_NEXT_MS },
      { type: 'TICK', ms: PREROLL_MS },
    )
    expect(s.phase).toBe('playing')
    expect(s.set).toBe(1)
    expect(s.remainingMs).toBe(30_000)
  })

  test('a partial tick decrements the countdown without advancing', () => {
    const s = run(
      initPlayer(snap),
      { type: 'START' },
      { type: 'ADVANCE' },
      { type: 'TICK', ms: UP_NEXT_MS },
      { type: 'TICK', ms: PREROLL_MS },
      { type: 'TICK', ms: 5_000 },
    )
    expect(s.phase).toBe('playing')
    expect(s.remainingMs).toBe(25_000)
  })

  test('finishing a non-final hold set rests, then resumes the next set', () => {
    const base = run(
      initPlayer(snap),
      { type: 'START' },
      { type: 'ADVANCE' },
      { type: 'TICK', ms: UP_NEXT_MS },
      { type: 'TICK', ms: PREROLL_MS },
    )
    const resting = playerReducer(base, { type: 'TICK', ms: 30_000 })
    expect(resting.phase).toBe('resting')
    expect(resting.remainingMs).toBe(10_000)

    const set2 = playerReducer(resting, { type: 'TICK', ms: 10_000 })
    expect(set2.phase).toBe('playing')
    expect(set2.set).toBe(2)
    expect(set2.remainingMs).toBe(30_000)
  })

  test('finishing the final set completes the item and reaches the summary', () => {
    const set2 = run(
      initPlayer(snap),
      { type: 'START' },
      { type: 'ADVANCE' },
      { type: 'TICK', ms: UP_NEXT_MS },
      { type: 'TICK', ms: PREROLL_MS },
      { type: 'TICK', ms: 30_000 }, // set 1 -> rest
      { type: 'TICK', ms: 10_000 }, // rest -> set 2
    )
    const done = playerReducer(set2, { type: 'TICK', ms: 30_000 })
    expect(done.phase).toBe('summary')
    expect(done.index).toBe(1) // == items.length
    expect(done.results[0]).toEqual({ completed: true, skipped: false })
  })
})

// --- reps items are untimed and complete on tap-Next ----------------------
describe('playerMachine — reps item (tap-Next)', () => {
  const snap = snapshot([item(reps(2, 12, 20))])

  test('playing a reps set does not count down on TICK', () => {
    const s = toPlaying(snap)
    expect(s.phase).toBe('playing')
    expect(s.set).toBe(1)
    expect(s.remainingMs).toBe(0)
    const later = playerReducer(s, { type: 'TICK', ms: 999_999 })
    expect(later.phase).toBe('playing')
    expect(later.set).toBe(1)
  })

  test('NEXT completes a non-final reps set into rest, then the next set', () => {
    const resting = playerReducer(toPlaying(snap), { type: 'NEXT' })
    expect(resting.phase).toBe('resting')
    expect(resting.remainingMs).toBe(20_000)
    const set2 = playerReducer(resting, { type: 'ADVANCE' }) // skip rest
    expect(set2.phase).toBe('playing')
    expect(set2.set).toBe(2)
  })

  test('NEXT on the final reps set completes the item and reaches summary', () => {
    const set2 = run(toPlaying(snap), { type: 'NEXT' }, { type: 'ADVANCE' })
    const done = playerReducer(set2, { type: 'NEXT' })
    expect(done.phase).toBe('summary')
    expect(done.results[0]).toEqual({ completed: true, skipped: false })
  })
})

// --- multi-item advance + transport --------------------------------------
describe('playerMachine — transport across items', () => {
  const two = () => snapshot([item(hold(1, 20, 10)), item(reps(2, 12, 20))])

  test('completing an item advances to the next item up-next', () => {
    const afterItem0 = playerReducer(toPlaying(two()), { type: 'TICK', ms: 20_000 })
    expect(afterItem0.phase).toBe('upNext')
    expect(afterItem0.index).toBe(1)
    expect(afterItem0.results[0]).toEqual({ completed: true, skipped: false })
  })

  test('SKIP marks the item skipped and moves to the next item', () => {
    const s = playerReducer(toPlaying(two()), { type: 'SKIP' })
    expect(s.index).toBe(1)
    expect(s.phase).toBe('upNext')
    expect(s.results[0]).toEqual({ completed: false, skipped: true })
  })

  test('SKIP on the last item reaches the summary', () => {
    const s = playerReducer(toPlaying(snapshot([item(hold(2, 30, 10))])), { type: 'SKIP' })
    expect(s.phase).toBe('summary')
    expect(s.results[0]).toEqual({ completed: false, skipped: true })
  })

  test('BACK returns to the previous item and clears its result', () => {
    const atItem1 = playerReducer(toPlaying(two()), { type: 'TICK', ms: 20_000 }) // item0 done -> item1 upNext
    const back = playerReducer(atItem1, { type: 'BACK' })
    expect(back.index).toBe(0)
    expect(back.phase).toBe('upNext')
    expect(back.results[0]).toEqual({ completed: false, skipped: false })
  })

  test('TICK accumulates total elapsed play time; paused time does not count', () => {
    const playing = toPlaying(snapshot([item(hold(2, 30, 10))]))
    expect(playing.elapsedMs).toBe(0)
    const t1 = playerReducer(playing, { type: 'TICK', ms: 1000 })
    expect(t1.elapsedMs).toBe(1000)
    const paused = playerReducer(t1, { type: 'PAUSE' })
    const stillPaused = playerReducer(paused, { type: 'TICK', ms: 5000 })
    expect(stillPaused.elapsedMs).toBe(1000) // frozen while paused
    const resumed = playerReducer(stillPaused, { type: 'RESUME' })
    const t2 = playerReducer(resumed, { type: 'TICK', ms: 500 })
    expect(t2.elapsedMs).toBe(1500)
  })

  test('PAUSE freezes the countdown; RESUME lets it run again', () => {
    const playing = toPlaying(two()) // hold set, remaining 20_000
    const paused = playerReducer(playing, { type: 'PAUSE' })
    expect(paused.paused).toBe(true)
    const stillPlaying = playerReducer(paused, { type: 'TICK', ms: 20_000 })
    expect(stillPlaying.phase).toBe('playing')
    expect(stillPlaying.remainingMs).toBe(20_000)
    const resumed = playerReducer(stillPlaying, { type: 'RESUME' })
    expect(resumed.paused).toBe(false)
    const advanced = playerReducer(resumed, { type: 'TICK', ms: 20_000 })
    expect(advanced.index).toBe(1) // item completed, moved on
  })
})

// --- resume from persisted playback state --------------------------------
describe('playerMachine — resumePlayer', () => {
  const three = snapshot([item(hold(1, 20, 10)), item(reps(2, 12, 20)), item(hold(1, 30, 10))])

  test('a fresh run (index 0, no progress) resumes at the idle start card', () => {
    const s = resumePlayer(three, { index: 0, items: [] })
    expect(s.phase).toBe('idle')
    expect(s.results.every((r) => !r.completed && !r.skipped)).toBe(true)
  })

  test('resumes mid-session at the persisted item with prior results applied (mapped by slug)', () => {
    const s = resumePlayer(three, {
      index: 2,
      items: [
        { slug: three.items[0].slug, completed: true, skipped: false },
        { slug: three.items[1].slug, completed: false, skipped: true },
      ],
    })
    expect(s.phase).toBe('upNext')
    expect(s.index).toBe(2)
    expect(s.results[0]).toEqual({ completed: true, skipped: false })
    expect(s.results[1]).toEqual({ completed: false, skipped: true })
  })

  test('a persisted index past the last item resumes at the summary', () => {
    const s = resumePlayer(three, { index: 3, items: [] })
    expect(s.phase).toBe('summary')
    expect(s.index).toBe(3)
  })
})
