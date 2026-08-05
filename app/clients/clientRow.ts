import { bandFromGrade, deltaBand, deltaIcon, type DeltaArrow, type SeverityBand } from '@/components/array/severity'
import { relativeDay } from '@/lib/time/relative'

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
  meta: string
  /** Trend against the previous scan: `−6`, `worse`, `flat`, `new`. */
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
  { value: 'improving', label: 'Improving', band: 'neutral' },
  { value: 'overdue', label: 'Overdue', band: 'neutral' },
]

/**
 * One directory row. The trend is the honest thing this screen adds: a client
 * with one scan has no trend to show and says so ("first scan"), rather than
 * being drawn as flat.
 */
export function toDirectoryRow(client: DirectoryClient, now: number): DirectoryRow {
  const name = `${client.first_name} ${client.last_name}`.trim()
  const scanned = relativeDay(client.last_scan_at, now)
  const overdue = isOverdue(client.last_scan_at, now)

  const meta = client.last_scan_at
    ? [
      `Scanned ${scanned?.toLowerCase() ?? 'recently'}`,
      client.awaiting_review ? 'in review' : null,
      overdue ? 'overdue' : null,
    ].filter(Boolean).join(' · ')
    : 'No scan yet'

  const trend = describeTrend(client)

  return {
    id: client.id,
    // A client with a scan opens on their record, which is where the trend lives.
    href: `/clients/${client.id}`,
    name,
    grade: client.last_grade,
    meta,
    trend: trend.text,
    trendIcon: trend.icon,
    trendBand: trend.band,
    trendLabel: `${name}: ${trend.label}`,
  }
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
  // Deviation score: lower is better, so a fall is an improvement.
  const band = deltaBand(delta, true)
  const magnitude = Math.abs(delta)
  return {
    text: `${delta < 0 ? '−' : '+'}${magnitude}`,
    icon: deltaIcon(delta),
    band,
    label: delta < 0
      ? `improved ${magnitude} points since the previous scan`
      : `worsened ${magnitude} points since the previous scan`,
  }
}

/** Grade band for the row's chip, so the list can be read by colour at a glance. */
export function rowBand(client: DirectoryClient): SeverityBand {
  return bandFromGrade(client.last_grade)
}
