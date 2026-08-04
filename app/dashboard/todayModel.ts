import { bandFromGrade, deltaBand, deltaIcon, formatDelta, type DeltaArrow, type SeverityBand } from '@/components/array/severity'
import type { IconName } from '@/components/array/icons'
import { relativeDay, waitedFor } from '@/lib/time/relative'

/* ── Inputs: the shapes the dashboard query returns ─────────────────────── */

export interface AwaitingRow {
  id: string
  client_id: string
  first_name: string
  last_name: string
  created_at: string | null
  /** Ordinal of this scan within the client's history, 1-based. */
  scan_index: number | null
  finding_count: number
}

export interface RecentRow {
  id: string
  first_name: string
  last_name: string
  overall_grade: string | null
  created_at: string | null
  practitioner_approved: boolean
}

export interface RescanRow {
  id: string
  first_name: string
  last_name: string
  last_scan_at: string | null
}

export interface TodayCounts {
  activeClients: number
  clientsAddedThisWeek: number
  scansThisWeek: number
  scansPriorWeek: number
  averageScoreThisWeek: number | null
  averageScorePriorWeek: number | null
}

/* ── Outputs ────────────────────────────────────────────────────────────── */

export interface QueueItem {
  id: string
  href: string
  name: string
  initials: string
  meta: string
  wait: string | null
  /** The oldest item is the one the primary action commits to. */
  oldest: boolean
}

export interface MetricTile {
  key: 'active' | 'scans' | 'score'
  icon: IconName
  value: string
  label: string
  delta: string | null
  deltaIcon: DeltaArrow
  deltaBand: SeverityBand
}

export interface RecentScanItem {
  id: string
  href: string
  name: string
  grade: string | null
  meta: string
  icon: IconName
  band: SeverityBand
}

export interface TodayModel {
  /** Two-tone headline: the verdict, then the detail at 45% white. */
  headline: { lead: string; tail: string | null }
  kicker: string
  queueTotal: number
  queue: QueueItem[]
  primaryAction: { label: string; href: string } | null
  metrics: MetricTile[]
  recent: RecentScanItem[]
  rescan: { name: string; href: string; meta: string; readout: string } | null
}

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** Spelled out below ten, numeral at ten and above — a headline is prose. */
export function countWord(n: number): string {
  const word = SMALL_NUMBERS[n]
  if (!word) return String(n)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function initialsOf(first: string, last: string): string {
  const a = first.trim().charAt(0)
  const b = last.trim().charAt(0)
  return `${a}${b}`.toUpperCase() || '—'
}

function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim()
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function averageOf(scores: readonly (number | null)[]): number | null {
  return mean(scores.filter((score): score is number => typeof score === 'number' && Number.isFinite(score)))
}

/**
 * Everything the Today screen states, derived from the rows it was given.
 *
 * `now` is passed in rather than read here so the derivation stays pure and the
 * wait times in a rendered screen all share one clock.
 */
export function buildTodayModel({
  awaiting,
  awaitingTotal,
  recent,
  rescan,
  counts,
  now,
}: {
  awaiting: readonly AwaitingRow[]
  awaitingTotal: number
  recent: readonly RecentRow[]
  rescan: RescanRow | null
  counts: TodayCounts
  now: number
}): TodayModel {
  const queue: QueueItem[] = awaiting.map((row, index) => ({
    id: row.id,
    href: `/assessments/${row.id}`,
    name: fullName(row.first_name, row.last_name),
    initials: initialsOf(row.first_name, row.last_name),
    meta: [
      row.scan_index ? `Scan ${String(row.scan_index).padStart(2, '0')}` : null,
      `${row.finding_count} ${plural(row.finding_count, 'finding', 'findings')}`,
    ].filter(Boolean).join(' · '),
    wait: waitedFor(row.created_at, now),
    oldest: index === 0,
  }))

  const oldest = queue[0] ?? null
  const oldestFirstName = awaiting[0]?.first_name?.trim() ?? null

  const headline = awaitingTotal > 0
    ? {
      lead: `${countWord(awaitingTotal)} ${plural(awaitingTotal, 'report is', 'reports are')} waiting.`,
      tail: oldestFirstName ? `${oldestFirstName} has waited longest.` : null,
    }
    : {
      lead: 'Nothing waiting for sign-off.',
      tail: counts.scansThisWeek > 0
        ? `${countWord(counts.scansThisWeek)} ${plural(counts.scansThisWeek, 'scan', 'scans')} this week.`
        : 'No scans captured this week.',
    }

  const scoreDelta = counts.averageScoreThisWeek != null && counts.averageScorePriorWeek != null
    ? counts.averageScoreThisWeek - counts.averageScorePriorWeek
    : null
  const scansDelta = counts.scansThisWeek - counts.scansPriorWeek

  const metrics: MetricTile[] = [
    {
      key: 'active',
      icon: 'users-group-rounded-linear',
      value: String(counts.activeClients),
      label: 'Active',
      delta: formatDelta(counts.clientsAddedThisWeek),
      deltaIcon: deltaIcon(counts.clientsAddedThisWeek),
      // More clients on the books is the good direction.
      deltaBand: deltaBand(counts.clientsAddedThisWeek, false),
    },
    {
      key: 'scans',
      icon: 'scanner-linear',
      value: String(counts.scansThisWeek),
      label: 'Scans / wk',
      delta: formatDelta(scansDelta),
      deltaIcon: deltaIcon(scansDelta),
      deltaBand: deltaBand(scansDelta, false),
    },
    {
      key: 'score',
      icon: 'graph-down-linear',
      value: counts.averageScoreThisWeek == null ? '—' : String(counts.averageScoreThisWeek),
      label: 'Avg score',
      delta: formatDelta(scoreDelta),
      deltaIcon: deltaIcon(scoreDelta),
      // Deviation score: lower is better.
      deltaBand: deltaBand(scoreDelta, true),
    },
  ]

  const recentItems: RecentScanItem[] = recent.map(row => ({
    id: row.id,
    href: `/assessments/${row.id}`,
    name: fullName(row.first_name, row.last_name),
    grade: row.overall_grade,
    meta: [
      relativeDay(row.created_at, now),
      row.practitioner_approved ? 'Approved · report sent' : 'Awaiting review',
    ].filter(Boolean).join(' · '),
    icon: row.practitioner_approved ? 'check-circle-linear' : 'clock-circle-linear',
    // The trailing icon reports review state, not grade — the chip already
    // carries the grade, and an amber tick on an approved C reads as a warning.
    band: row.practitioner_approved ? 'maintain' : 'monitor',
  }))

  return {
    headline,
    kicker: awaitingTotal > 0 ? 'Review queue — live' : 'Review queue — clear',
    queueTotal: awaitingTotal,
    queue,
    primaryAction: oldest && oldestFirstName
      ? { label: `Review ${oldestFirstName} first`, href: oldest.href }
      : null,
    metrics,
    recent: recentItems,
    rescan: buildRescan(rescan, now),
  }
}

/**
 * The design's "next booked session" row. This app has no scheduling table, so
 * the slot carries the truthful equivalent instead: the client who has gone
 * longest without a scan. It is never presented as a booking.
 */
function buildRescan(row: RescanRow | null, now: number): TodayModel['rescan'] {
  if (!row) return null
  const since = relativeDay(row.last_scan_at, now)
  if (!since) return null
  return {
    name: `Due for re-scan — ${fullName(row.first_name, row.last_name)}`,
    href: `/clients/${row.id}`,
    meta: `Last scanned ${since.toLowerCase()}`,
    readout: 'Longest wait',
  }
}
