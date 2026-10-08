import { bandFromGrade, deltaIcon, type DeltaArrow, type SeverityBand } from '@/components/array/severity'
import { formatClientDate } from './[id]/clientDate'

export const OVERDUE_DAYS = 42

export interface DirectoryClient {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  created_at: string
  last_scan_at: string | null
  last_assessment_id: string | null
  last_grade: string | null
  last_score: number | null
  previous_score: number | null
  awaiting_review: boolean | null
}

export interface DirectoryRow {
  id: string
  href: string
  name: string
  grade: string | null
  /** One line: when the client was last scanned, as a date — `Latest scan · 7 Oct` (dataviz G). */
  meta: string
  /** False for a freshly-added client — distinct from `overdue` (which is also
   * true for a never-scanned client): a new row should read "new", not "overdue". */
  hasScan: boolean
  /** A completed scan is waiting on the practitioner's sign-off. */
  awaitingReview: boolean
  /** No scan in `OVERDUE_DAYS`, or never scanned. */
  overdue: boolean
  /** Recorded score difference against the previous scan: `−6`, `+4`, `flat`, `new`. */
  trend: string
  trendIcon: DeltaArrow | 'user-plus-linear'
  trendBand: SeverityBand
  /** Read out to assistive tech in place of the icon-plus-number pairing. */
  trendLabel: string
}

export type ClientFilter = 'all' | 'needs_review' | 'improving' | 'overdue'

export const CLIENT_FILTERS: readonly { value: ClientFilter; label: string; band: SeverityBand }[] = [
  { value: 'all', label: 'All', band: 'neutral' },
  { value: 'needs_review', label: 'Needs review', band: 'monitor' },
  { value: 'overdue', label: 'Overdue', band: 'neutral' },
  { value: 'improving', label: 'Score decreased', band: 'neutral' },
]

/**
 * One directory row. The trend is the honest thing this screen adds: a client
 * with one scan has no trend to show and says so ("first scan"), rather than
 * being drawn as flat. `awaitingReview`/`overdue` are surfaced separately from
 * `meta` so the list row can show them as its one trailing status chip
 * (DESIGN.md › Clients) instead of folding them into the subtitle text.
 */
export function toDirectoryRow(client: DirectoryClient, now: number): DirectoryRow {
  const name = `${client.first_name} ${client.last_name}`.trim()
  const overdue = isOverdue(client.last_scan_at, now)
  const scanned = scanDate(client.last_scan_at, now)

  const meta = client.last_scan_at ? `Latest scan · ${scanned ?? 'date unknown'}` : 'No scan yet'

  const trend = describeTrend(client)

  return {
    id: client.id,
    // A client with a scan opens on their record, which is where the trend lives.
    href: `/clients/${client.id}`,
    name,
    grade: client.last_grade,
    meta,
    hasScan: Boolean(client.last_scan_at),
    awaitingReview: Boolean(client.awaiting_review),
    overdue,
    trend: trend.text,
    trendIcon: trend.icon,
    trendBand: trend.band,
    trendLabel: `${name}: ${trend.label}`,
  }
}

/**
 * `7 Oct` within the current year, `7 Oct 2025` otherwise — a bare day and month
 * must not be read as this year's. UTC calendar day, the same basis and month
 * spelling as the client header and Results (`formatClientDate`,
 * `utcCalendarLabel`), so one scan never reads as two different days.
 */
function scanDate(iso: string | null, now: number): string | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  const sameYear = new Date(parsed).getUTCFullYear() === new Date(now).getUTCFullYear()
  return formatClientDate(iso, sameYear ? 'day-month-short-no-year' : 'day-month-short')
}

export function isOverdue(lastScanAt: string | null, now: number): boolean {
  if (!lastScanAt) return true
  const parsed = Date.parse(lastScanAt)
  if (!Number.isFinite(parsed)) return false
  return now - parsed > OVERDUE_DAYS * 24 * 60 * 60 * 1000
}

function describeTrend(client: DirectoryClient): {
  text: string
  icon: DeltaArrow | 'user-plus-linear'
  band: SeverityBand
  label: string
} {
  if (!client.last_scan_at) {
    return { text: 'new', icon: 'user-plus-linear', band: 'neutral', label: 'no scan yet' }
  }
  if (client.last_score == null || client.previous_score == null) {
    return { text: 'first scan', icon: 'arrow-right-linear', band: 'neutral', label: 'first scan, no trend yet' }
  }
  const delta = Math.round(client.last_score - client.previous_score)
  if (delta === 0) {
    return { text: 'flat', icon: 'arrow-right-linear', band: 'neutral', label: 'unchanged since the previous scan' }
  }
  const magnitude = Math.abs(delta)
  return {
    text: `${delta < 0 ? '−' : '+'}${magnitude}`,
    icon: deltaIcon(delta),
    band: 'neutral',
    label: delta < 0
      ? `score decreased ${magnitude} points since the previous scan; meaningful change is not established`
      : `score increased ${magnitude} points since the previous scan; meaningful change is not established`,
  }
}

/** Grade band for the row's chip, so the list can be read by colour at a glance. */
export function rowBand(client: DirectoryClient): SeverityBand {
  return bandFromGrade(client.last_grade)
}
