/**
 * Pure merge for session_runs playback state — the guarded, idempotent core of
 * PATCH /api/workouts/[id]/run. Kept Date-free (the route passes nowIso) so it
 * unit-tests deterministically.
 *
 * Guarantees the route relies on:
 *  - revisioned writes (patch.revision) are ordered: a stale/duplicate revision
 *    is dropped (null), and a newer revision REPLACES items verbatim — the
 *    client's full state is authoritative, so Back/replay can un-complete an
 *    item without the server resurrecting the old flag;
 *  - legacy writes (no revision) fall back to the OR-merge: completion never
 *    regresses on that path;
 *  - 'completed' is terminal: a late/duplicate downgrade is ignored and the
 *    original completed_at is preserved;
 *  - total_duration_ms is monotonic;
 *  - the same patch applied twice yields the same row (idempotent).
 */
export type RunStatus = 'started' | 'in_progress' | 'paused' | 'completed' | 'abandoned'

export interface RunItem {
  slug: string
  completed: boolean
  skipped: boolean
  durationMs?: number
}

export interface RunRow {
  status: RunStatus
  current_item_index: number
  items: RunItem[]
  total_duration_ms: number | null
  last_paused_at: string | null
  completed_at: string | null
  revision: number | null
}

export interface RunPatch {
  status?: RunStatus
  current_item_index?: number
  items?: RunItem[]
  total_duration_ms?: number
  revision?: number
}

export interface RunUpdate {
  status: RunStatus
  current_item_index: number
  items: RunItem[]
  total_duration_ms: number
  last_paused_at: string | null
  completed_at: string | null
  revision: number
  updated_at: string
}

/** Union two item lists by slug, OR-ing completed/skipped and keeping max duration. */
export function mergeRunItems(existing: RunItem[], incoming: RunItem[]): RunItem[] {
  const bySlug = new Map<string, RunItem>()
  for (const it of existing) bySlug.set(it.slug, { ...it })
  for (const it of incoming) {
    const cur = bySlug.get(it.slug)
    if (!cur) {
      bySlug.set(it.slug, { ...it })
      continue
    }
    const durationMs = Math.max(cur.durationMs ?? 0, it.durationMs ?? 0)
    bySlug.set(it.slug, {
      slug: it.slug,
      completed: cur.completed || it.completed,
      skipped: cur.skipped || it.skipped,
      ...(durationMs > 0 ? { durationMs } : {}),
    })
  }
  return [...bySlug.values()]
}

/** Returns null when a revisioned patch is stale (≤ stored revision) — drop it. */
export function buildRunUpdate(existing: RunRow, patch: RunPatch, nowIso: string): RunUpdate | null {
  const revisioned = patch.revision != null
  if (revisioned && patch.revision! <= (existing.revision ?? 0)) return null

  const terminal = existing.status === 'completed'
  const status: RunStatus = terminal ? 'completed' : patch.status ?? existing.status
  const becameCompleted = status === 'completed' && existing.status !== 'completed'

  // Revisioned writes carry the client's full authoritative item state (Back can
  // legitimately un-complete an item); only the legacy path needs the OR-merge.
  const items = patch.items
    ? revisioned
      ? patch.items
      : mergeRunItems(existing.items ?? [], patch.items)
    : existing.items ?? []

  return {
    status,
    current_item_index: patch.current_item_index ?? existing.current_item_index,
    items,
    total_duration_ms: Math.max(existing.total_duration_ms ?? 0, patch.total_duration_ms ?? 0),
    last_paused_at: status === 'paused' ? nowIso : existing.last_paused_at,
    completed_at: becameCompleted ? nowIso : existing.completed_at,
    revision: patch.revision ?? existing.revision ?? 0,
    updated_at: nowIso,
  }
}
