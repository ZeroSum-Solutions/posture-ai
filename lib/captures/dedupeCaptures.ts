/** Minimal shape the de-dup needs; the GET route rows carry more fields. */
export interface ViewSideRow {
  view: string
  profile_side?: 'left' | 'right' | null
  storage_path?: string | null
}

/**
 * One capture per (view, profile_side): a burst (engine 1.3.0) stores every
 * frame for re-scorability, but the results page shows a single photo slot per
 * distinct view/side. Keying on `view` alone would collapse a left- and a
 * right-side capture into one indistinguishable `side` row — this preserves
 * laterality while still de-duping within-burst frames. Front/back carry a
 * NULL profile, so they still yield exactly one row per view (back-compat).
 */
export function dedupeCapturesByViewSide<T extends ViewSideRow>(rows: T[]): T[] {
  const chosen = new Map<string, T>()
  for (const r of rows) {
    const key = `${r.view}:${r.profile_side ?? ''}`
    const previous = chosen.get(key)
    if (!previous || (!previous.storage_path && r.storage_path)) chosen.set(key, r)
  }
  return [...chosen.values()]
}
