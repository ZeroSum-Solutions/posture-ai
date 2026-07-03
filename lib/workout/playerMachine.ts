/**
 * Pure state machine for the guided workout player. Framework-free and
 * Date-free so it unit-tests deterministically and drives an identical timeline
 * on web and (later) mobile. The component owns real timers and dispatches
 * { type: 'TICK', ms } on each frame/interval; every transition here is a pure
 * function of (state, action).
 *
 * Lifecycle (per the plan's §4 state machine):
 *   idle → intro → [ upNext → preroll → playing (→ resting → playing …) ]* → summary
 *
 * A `hold` set counts down (auto-advances at 0:00); a `reps` set is untimed and
 * completes on NEXT (tap-Next). Rest sits between sets of the same item. Skip /
 * Back / Pause work throughout, and the state carries index + set + remainingMs
 * so playback can be persisted and resumed.
 */
import type { SessionSnapshot, SessionItem } from './generateWorkoutSession'

export const UP_NEXT_MS = 3_000
export const PREROLL_MS = 3_000

export type PlayerPhase = 'idle' | 'intro' | 'upNext' | 'preroll' | 'playing' | 'resting' | 'summary'

export interface ItemResult {
  completed: boolean
  skipped: boolean
}

export interface PlayerState {
  items: SessionItem[]
  phase: PlayerPhase
  /** Current item (0-based); equals items.length at the summary. */
  index: number
  /** Current set within the item (1-based). */
  set: number
  /** Milliseconds left in the current timed segment (upNext/preroll/hold/rest). */
  remainingMs: number
  /** Total active (non-paused) play time so far — drives the summary duration. */
  elapsedMs: number
  paused: boolean
  results: ItemResult[]
}

export type PlayerAction =
  | { type: 'START' }
  | { type: 'ADVANCE' } // skip the current wait (intro/up-next/preroll/rest)
  | { type: 'TICK'; ms: number }
  | { type: 'NEXT' } // complete the current work set (reps tap-Next / early hold finish)
  | { type: 'SKIP' } // skip the whole current item
  | { type: 'BACK' } // return to the previous item
  | { type: 'PAUSE' }
  | { type: 'RESUME' }

export function initPlayer(snapshot: SessionSnapshot): PlayerState {
  return {
    items: snapshot.items,
    phase: 'idle',
    index: 0,
    set: 1,
    remainingMs: 0,
    elapsedMs: 0,
    paused: false,
    results: snapshot.items.map(() => ({ completed: false, skipped: false })),
  }
}

/**
 * Rebuild player state from persisted run progress (current_item_index + the
 * per-item completed/skipped flags stored by slug). A fresh run with no progress
 * resumes at the idle start card; otherwise it drops the user back at the
 * persisted item's up-next card with prior results applied.
 */
export function resumePlayer(
  snapshot: SessionSnapshot,
  resume: { index: number; items?: { slug: string; completed: boolean; skipped: boolean }[] },
): PlayerState {
  const bySlug = new Map((resume.items ?? []).map((i) => [i.slug, i]))
  const results: ItemResult[] = snapshot.items.map((it) => {
    const r = bySlug.get(it.slug)
    return { completed: r?.completed ?? false, skipped: r?.skipped ?? false }
  })
  const base: PlayerState = { ...initPlayer(snapshot), results }
  const idx = Math.max(0, Math.min(resume.index, snapshot.items.length))
  const anyProgress = results.some((r) => r.completed || r.skipped)
  return idx <= 0 && !anyProgress ? base : enterItem(base, idx)
}

const holdMs = (item: SessionItem): number =>
  item.timing.kind === 'hold' ? item.timing.secondsPerSet * 1_000 : 0
const restMs = (item: SessionItem): number => item.timing.restSeconds * 1_000

function withResult(state: PlayerState, index: number, r: ItemResult): ItemResult[] {
  return state.results.map((cur, i) => (i === index ? r : cur))
}

/** Enter an item at its up-next card, or land on the summary past the last item. */
function enterItem(state: PlayerState, index: number): PlayerState {
  if (index >= state.items.length) {
    return { ...state, phase: 'summary', index: state.items.length, set: 1, remainingMs: 0 }
  }
  return { ...state, phase: 'upNext', index, set: 1, remainingMs: UP_NEXT_MS }
}

/** Begin the work of the current set: hold counts down, reps is untimed. */
function beginPlaying(state: PlayerState): PlayerState {
  return { ...state, phase: 'playing', remainingMs: holdMs(state.items[state.index]) }
}

/** A work set finished → rest before the next set, or complete + advance the item. */
function completeSet(state: PlayerState): PlayerState {
  const item = state.items[state.index]
  if (state.set < item.timing.sets) {
    return { ...state, phase: 'resting', remainingMs: restMs(item) }
  }
  const results = withResult(state, state.index, { completed: true, skipped: false })
  return enterItem({ ...state, results }, state.index + 1)
}

/** Whether the current phase is counting down right now (not while paused). */
function isTimed(state: PlayerState): boolean {
  if (state.paused) return false
  switch (state.phase) {
    case 'upNext':
    case 'preroll':
    case 'resting':
      return true
    case 'playing':
      return state.items[state.index]?.timing.kind === 'hold'
    default:
      return false
  }
}

/** A timed segment reached 0:00 — move to the next phase. */
function onSegmentComplete(state: PlayerState): PlayerState {
  switch (state.phase) {
    case 'upNext':
      return { ...state, phase: 'preroll', remainingMs: PREROLL_MS }
    case 'preroll':
      return beginPlaying(state)
    case 'playing':
      return completeSet(state)
    case 'resting':
      return beginPlaying({ ...state, set: state.set + 1 })
    default:
      return state
  }
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'START':
      return state.phase === 'idle' ? { ...state, phase: 'intro' } : state

    case 'ADVANCE':
      switch (state.phase) {
        case 'intro':
          return enterItem(state, 0)
        case 'upNext':
          return { ...state, phase: 'preroll', remainingMs: PREROLL_MS }
        case 'preroll':
          return beginPlaying(state)
        case 'resting':
          return beginPlaying({ ...state, set: state.set + 1 })
        default:
          return state
      }

    case 'TICK': {
      if (state.paused || state.phase === 'idle' || state.phase === 'intro' || state.phase === 'summary') return state
      const elapsedMs = state.elapsedMs + action.ms
      if (!isTimed(state)) return { ...state, elapsedMs } // reps set: time passes, no countdown
      const remainingMs = state.remainingMs - action.ms
      return remainingMs > 0
        ? { ...state, elapsedMs, remainingMs }
        : { ...onSegmentComplete(state), elapsedMs }
    }

    case 'NEXT':
      return state.phase === 'playing' ? completeSet(state) : state

    case 'SKIP': {
      if (state.phase === 'idle' || state.phase === 'intro' || state.phase === 'summary') return state
      const results = withResult(state, state.index, { completed: false, skipped: true })
      return enterItem({ ...state, results }, state.index + 1)
    }

    case 'BACK': {
      if (state.phase === 'idle' || state.phase === 'intro') return state
      const target = state.phase === 'summary' ? state.items.length - 1 : Math.max(0, state.index - 1)
      // Clear the target item's (and anything after it) recorded result — replaying re-records it.
      const results = state.results.map((r, i) => (i >= target ? { completed: false, skipped: false } : r))
      return enterItem({ ...state, results }, target)
    }

    case 'PAUSE':
      return { ...state, paused: true }

    case 'RESUME':
      return { ...state, paused: false }

    default:
      return state
  }
}
