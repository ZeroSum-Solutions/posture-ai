const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * How long a scan has been waiting, as a compact readout for the review queue:
 * `42 m`, `18 h`, `2 d`, `5 w`. Deliberately terse — it sits right-aligned in a
 * row where the name carries the weight.
 *
 * Returns null for a missing or unparseable timestamp rather than guessing, so
 * a broken row shows no wait instead of a wrong one.
 */
export function waitedFor(iso: string | null | undefined, now: number): string | null {
  const then = toMillis(iso)
  if (then == null) return null
  const elapsed = Math.max(0, now - then)
  if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))} m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)} d`
  return `${Math.floor(elapsed / WEEK)} w`
}

/**
 * When something happened, in prose: `Today`, `Yesterday`, `3 days ago`,
 * `6 weeks ago`. Used in row meta, where a date carries less meaning than a
 * distance from now.
 */
export function relativeDay(iso: string | null | undefined, now: number): string | null {
  const then = toMillis(iso)
  if (then == null) return null
  const elapsed = now - then
  if (elapsed < 0) return 'Today'
  const days = Math.floor(elapsed / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return 'Last week'
  if (weeks < 9) return `${weeks} weeks ago`
  const months = Math.floor(days / 30)
  return months <= 1 ? 'Last month' : `${months} months ago`
}

/** Whole days elapsed, or null when the timestamp is unusable. */
export function daysSince(iso: string | null | undefined, now: number): number | null {
  const then = toMillis(iso)
  if (then == null) return null
  return Math.floor(Math.max(0, now - then) / DAY)
}

/** Short absolute date for scan history rows: `12 Jul 2026`. */
export function shortDate(iso: string | null | undefined): string | null {
  const then = toMillis(iso)
  if (then == null) return null
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Short date without the year, for axis labels: `12 Jul`. */
export function axisDate(iso: string | null | undefined): string | null {
  const then = toMillis(iso)
  if (then == null) return null
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function toMillis(iso: string | null | undefined): number | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}
