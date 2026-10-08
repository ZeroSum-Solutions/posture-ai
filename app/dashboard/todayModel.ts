import { bandFromGrade, type SeverityBand } from '@/components/array/severity'
import type { SeverityChipBand } from '@/components/ui'
import { axisDate, relativeDay, waitedFor } from '@/lib/time/relative'

/** `bandFromGrade` is typed for the wider engine `SeverityBand`, but it never
 * actually returns 'info' — narrow it to what `SeverityChip` accepts. */
function chipBand(band: SeverityBand): SeverityChipBand {
  return band === 'info' ? 'neutral' : band
}

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

/** The single hero sentence + primary action, chosen by DESIGN.md's Today rule. */
export interface HeroState {
  sentence: string
  action: { label: string; href: string }
}

export type SetupStepId = 'client' | 'scan' | 'workout'

export interface SetupStep {
  id: SetupStepId
  label: string
  done: boolean
  href: string
}

export interface SetupChecklist {
  steps: SetupStep[]
  doneCount: number
  total: number
}

/** A row in the merged "Needs attention" list — a review-queue item or the re-scan reminder. */
export interface NeedsAttentionItem {
  id: string
  href: string
  name: string
  subtitle: string
  /** Oldest queue item: the hero button commits to this one. */
  isHeroTarget: boolean
}

/** One of the oldest waiting reports, shown inside the hero (dataviz F). */
export interface QueueItem {
  id: string
  href: string
  name: string
  /** Exact wait, compact: `10 wk`, `3 d`, `18 h`, `42 min`. */
  wait: string | null
  /** Spoken form of `wait`: `10 weeks`. */
  waitSpoken: string | null
  /** When the scan arrived: `29 Jul`. */
  received: string | null
  findingCount: number
}

/** The client who has gone longest without a scan, when there is one. */
export interface RescanItem {
  id: string
  href: string
  name: string
  lastScan: string | null
  since: string | null
}

export interface MetricTile {
  key: 'added' | 'scans' | 'score'
  value: string
  label: string
  /** Raw numeric delta; Stat derives its own band/icon from severity.ts, so this stays unformatted. */
  delta: { value: number; goodDirection: 'up' | 'down' } | null
}

export interface RecentScanItem {
  id: string
  href: string
  name: string
  meta: string
  band: SeverityChipBand
}

export interface TodayModel {
  /** True when the practice has no clients yet — Today renders the first-run setup screen instead. */
  isFirstRun: boolean
  /** Null only when `isFirstRun`: first-run has no "next up" to name. */
  hero: HeroState | null
  setup: SetupChecklist
  queueTotal: number
  needsAttention: NeedsAttentionItem[]
  /** The three oldest waiting reports, oldest first. */
  queue: QueueItem[]
  rescan: RescanItem | null
  recent: RecentScanItem[]
  metrics: MetricTile[]
  /** All active clients (not a weekly figure) — shown beside "This week", outside the strip. */
  activeClients: number
}

/** Practitioner-avatar initials. Today no longer shows an avatar itself (TopBar
 * owns the header), but `page.tsx` still computes this for its own data test. */
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

const WAIT_UNITS: Record<string, [string, string, string]> = {
  m: ['min', 'minute', 'minutes'],
  h: ['h', 'hour', 'hours'],
  d: ['d', 'day', 'days'],
  w: ['wk', 'week', 'weeks'],
}

/** `waitedFor`'s `10 w` → `{ short: '10 wk', spoken: '10 weeks' }`. */
function formatWait(raw: string | null): { short: string; spoken: string } | null {
  if (!raw) return null
  const [count, unit] = raw.split(' ')
  const names = unit ? WAIT_UNITS[unit] : undefined
  if (!count || !names) return { short: raw, spoken: raw }
  return { short: `${count} ${names[0]}`, spoken: `${count} ${count === '1' ? names[1] : names[2]}` }
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
  const isFirstRun = counts.activeClients === 0

  /* ── Needs attention: review queue first (oldest first already), then the
     re-scan reminder if there's still room — capped at 3 rows total. ──── */
  const queueItems: NeedsAttentionItem[] = awaiting.map((row, index) => {
    const name = fullName(row.first_name, row.last_name)
    const wait = waitedFor(row.created_at, now)
    return {
      id: row.id,
      href: `/assessments/${row.id}`,
      name,
      subtitle: [
        `${row.finding_count} ${plural(row.finding_count, 'finding', 'findings')}`,
        wait ? `waiting ${wait.toLowerCase()}` : null,
      ].filter(Boolean).join(' · '),
      isHeroTarget: index === 0,
    }
  })

  const rescanItem: NeedsAttentionItem | null = rescan && relativeDay(rescan.last_scan_at, now)
    ? {
      id: `rescan-${rescan.id}`,
      href: `/clients/${rescan.id}`,
      name: fullName(rescan.first_name, rescan.last_name),
      subtitle: `Last scanned ${relativeDay(rescan.last_scan_at, now)!.toLowerCase()} · re-scan due`,
      isHeroTarget: false,
    }
    : null

  const queue: QueueItem[] = awaiting.slice(0, 3).map(row => {
    const wait = formatWait(waitedFor(row.created_at, now))
    return {
      id: row.id,
      href: `/assessments/${row.id}`,
      name: fullName(row.first_name, row.last_name),
      wait: wait?.short ?? null,
      waitSpoken: wait?.spoken ?? null,
      received: axisDate(row.created_at),
      findingCount: row.finding_count,
    }
  })

  const rescanView: RescanItem | null = rescan
    ? {
      id: rescan.id,
      href: `/clients/${rescan.id}`,
      name: fullName(rescan.first_name, rescan.last_name),
      lastScan: axisDate(rescan.last_scan_at),
      since: relativeDay(rescan.last_scan_at, now),
    }
    : null

  const needsAttention = [...queueItems, ...(rescanItem ? [rescanItem] : [])].slice(0, 3)

  /* ── Hero: one sentence + one button, chosen by rule (DESIGN.md › Today). ── */
  const oldest = awaiting[0] ?? null
  const oldestFirstName = oldest?.first_name?.trim() ?? null

  let hero: HeroState | null = null
  if (isFirstRun) {
    hero = null
  } else if (awaitingTotal > 0 && oldest && oldestFirstName) {
    const sentence = awaitingTotal === 1
      ? `1 report is waiting on ${oldestFirstName}.`
      : `${awaitingTotal} reports are waiting · ${oldestFirstName} has waited longest.`
    hero = { sentence, action: { label: `Review ${oldestFirstName} first`, href: `/assessments/${oldest.id}` } }
  } else if (rescan) {
    const since = relativeDay(rescan.last_scan_at, now)
    hero = {
      sentence: since
        ? `${rescan.first_name.trim()} is due for a re-scan — last seen ${since.toLowerCase()}.`
        : `${rescan.first_name.trim()} is due for a re-scan.`,
      action: { label: 'Start scan', href: `/assessments/new?client_id=${rescan.id}` },
    }
  } else {
    hero = { sentence: 'Ready for your next client.', action: { label: 'Start scan', href: '/assessments/new' } }
  }

  /* ── First-run setup checklist. Steps 1-2 are derived from data already
     loaded on this page; step 3 ("Build a workout") has no signal in this
     query set and so never auto-completes — a known gap, not a guess. ──── */
  const hasScan = recent.length > 0 || awaitingTotal > 0
  const steps: SetupStep[] = [
    { id: 'client', label: 'Add your first client', done: counts.activeClients > 0, href: '/clients/new' },
    { id: 'scan', label: 'Run a first scan', done: hasScan, href: '/assessments/new' },
    { id: 'workout', label: 'Build a workout', done: false, href: '/workouts' },
  ]
  const setup: SetupChecklist = { steps, doneCount: steps.filter(s => s.done).length, total: steps.length }

  /* ── Metrics strip: raw deltas only — Stat derives band/icon itself. ──── */
  const scoreDelta = counts.averageScoreThisWeek != null && counts.averageScorePriorWeek != null
    ? counts.averageScoreThisWeek - counts.averageScorePriorWeek
    : null
  const scansDelta = counts.scansThisWeek - counts.scansPriorWeek

  const metrics: MetricTile[] = [
    {
      key: 'scans',
      value: String(counts.scansThisWeek),
      label: 'Scans',
      delta: scansDelta !== 0 ? { value: scansDelta, goodDirection: 'up' } : null,
    },
    {
      key: 'score',
      value: counts.averageScoreThisWeek == null ? '—' : String(counts.averageScoreThisWeek),
      label: 'Avg score',
      // Deviation score: lower is better.
      delta: scoreDelta != null && scoreDelta !== 0 ? { value: scoreDelta, goodDirection: 'down' } : null,
    },
    // Every cell here is a this-week figure; the all-time active count lives
    // beside the section head (`activeClients`), not in the weekly strip.
    {
      key: 'added',
      value: String(counts.clientsAddedThisWeek),
      label: 'New clients',
      delta: null,
    },
  ]

  const recentItems: RecentScanItem[] = recent.map(row => ({
    id: row.id,
    href: `/assessments/${row.id}`,
    name: fullName(row.first_name, row.last_name),
    meta: [
      axisDate(row.created_at),
      // practitioner_approved records sign-off, not report generation or delivery
      // (reports are a separate table written by their own endpoint), so this must
      // not claim a report was sent.
      row.practitioner_approved ? 'Approved' : 'Awaiting review',
    ].filter(Boolean).join(' · '),
    band: chipBand(bandFromGrade(row.overall_grade)),
  }))

  return {
    isFirstRun,
    hero,
    setup,
    queueTotal: awaitingTotal,
    needsAttention,
    queue,
    rescan: rescanView,
    recent: recentItems,
    metrics,
    activeClients: counts.activeClients,
  }
}
