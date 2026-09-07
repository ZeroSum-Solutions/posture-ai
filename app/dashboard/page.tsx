import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import DashboardExperience from './DashboardExperience'
import { buildTodayModel, initialsOf, type AwaitingRow, type RecentRow, type RescanRow } from './todayModel'

type ClientName = { first_name: string; last_name: string }

/** Supabase renders an embedded to-one relation as an object or a single-item array. */
function firstRelation<T>(relation: T | T[] | null): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null
  return relation
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  // Server component: per-request clock read is intentional here. One clock is
  // read for the whole screen so every wait time on it agrees.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()

  const [
    clientCountResult,
    clientsAddedResult,
    weekScansResult,
    priorWeekScansResult,
    weekScoreAverageResult,
    priorWeekScoreAverageResult,
    awaitingResult,
    awaitingCountResult,
    recentResult,
    rescanResult,
  ] = await Promise.all([
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .is('archived_at', null)
      // Erased clients (deleted_at set) must not inflate the count (QA-001).
      .is('deleted_at', null),
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .is('archived_at', null)
      .is('deleted_at', null)
      .gte('created_at', weekAgo),
    // Count completed assessments only, matching the recent-scans feed — a
    // failed/abandoned capture must not show as "1 this week" above an empty feed.
    supabase
      .from('assessments')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .gte('created_at', weekAgo),
    supabase
      .from('assessments')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo),
    loadAssessmentScoreAverage(supabase, {
      practitionerId: user.id,
      startAt: weekAgo,
      endAt: new Date(now).toISOString(),
      endInclusive: true,
    }),
    loadAssessmentScoreAverage(supabase, {
      practitionerId: user.id,
      startAt: twoWeeksAgo,
      endAt: weekAgo,
      endInclusive: false,
    }),
    // The queue: scored but unsigned, oldest first — the button commits to the
    // head of this list. !inner + deleted_at drops tombstoned clients (QA-001).
    supabase
      .from('assessments')
      .select('id, client_id, created_at, clients!inner(first_name, last_name, deleted_at), assessment_findings(count)')
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .eq('practitioner_approved', false)
      .is('clients.deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(4),
    supabase
      .from('assessments')
      .select('id, clients!inner(deleted_at)', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .eq('practitioner_approved', false)
      .is('clients.deleted_at', null),
    supabase
      .from('assessments')
      .select('id, overall_grade, created_at, practitioner_approved, clients!inner(first_name, last_name, deleted_at)')
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .is('clients.deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(4),
    // Longest since a scan, resolved in SQL. A capped feed of recent assessments
    // cannot answer this: the client who has waited longest is precisely the one
    // whose last scan sits furthest behind any cap.
    supabase.rpc('owned_client_longest_since_scan', { p_snapshot_at: new Date(now).toISOString() }),
  ])

  const failed = [
    clientCountResult, clientsAddedResult, weekScansResult, priorWeekScansResult,
    weekScoreAverageResult, priorWeekScoreAverageResult, awaitingResult, awaitingCountResult,
    recentResult, rescanResult,
  ].some(result => result.error)
  const loadError = failed ? 'Some dashboard data could not load. Refresh to try again.' : null

  const awaitingRaw = (awaitingResult.data ?? []) as unknown as Array<{
    id: string
    client_id: string
    created_at: string | null
    clients: ClientName | ClientName[] | null
    assessment_findings: { count: number }[] | null
  }>

  const awaiting: AwaitingRow[] = awaitingRaw.flatMap(row => {
    const client = firstRelation(row.clients)
    if (!client) return []
    return [{
      id: row.id,
      client_id: row.client_id,
      first_name: client.first_name,
      last_name: client.last_name,
      created_at: row.created_at,
      // The scan ordinal needs the client's full history. The row reads better
      // without a number than with a wrong one, so it is omitted here.
      scan_index: null,
      finding_count: row.assessment_findings?.[0]?.count ?? 0,
    }]
  })

  const recentRaw = (recentResult.data ?? []) as unknown as Array<{
    id: string
    overall_grade: string | null
    created_at: string | null
    practitioner_approved: boolean
    clients: ClientName | ClientName[] | null
  }>

  const recent: RecentRow[] = recentRaw.flatMap(row => {
    const client = firstRelation(row.clients)
    if (!client) return []
    return [{
      id: row.id,
      first_name: client.first_name,
      last_name: client.last_name,
      overall_grade: row.overall_grade,
      created_at: row.created_at,
      practitioner_approved: row.practitioner_approved,
    }]
  })

  const { data: practitioner, error: practitionerErr } = await supabase
    .from('practitioners')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()
  // Deliberately outside the `failed`/loadError gate above: the only visible
  // effect of this query failing is the avatar initials falling back to '—',
  // which doesn't warrant the full-page "some data could not load" banner
  // that the 10 Promise.all queries share. Still logged so the miss isn't silent.
  if (practitionerErr) console.error(`[dashboard/${user.id}] practitioner lookup failed:`, practitionerErr.message)

  const nameParts = (practitioner?.display_name ?? '').trim().split(/\s+/)
  const practitionerInitials = initialsOf(nameParts[0] ?? '', nameParts.length > 1 ? nameParts.at(-1)! : '')

  const model = buildTodayModel({
    awaiting,
    awaitingTotal: awaitingCountResult.count ?? awaiting.length,
    recent,
    rescan: firstRescanRow(rescanResult.data),
    counts: {
      activeClients: clientCountResult.count ?? 0,
      clientsAddedThisWeek: clientsAddedResult.count ?? 0,
      scansThisWeek: weekScansResult.count ?? 0,
      scansPriorWeek: priorWeekScansResult.count ?? 0,
      averageScoreThisWeek: weekScoreAverageResult.data,
      averageScorePriorWeek: priorWeekScoreAverageResult.data,
    },
    now,
  })

  return (
    <DashboardExperience
      model={model}
      practitionerInitials={practitionerInitials}
      todayLabel={new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
      loadError={loadError}
    />
  )
}

const SCORE_PAGE_SIZE = 500
type DashboardSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * Read every score page before calculating the displayed average. PostgREST's
 * server row cap applies to each response, so a single unbounded select can
 * silently omit the 1,001st assessment while still returning HTTP 200.
 */
async function loadAssessmentScoreAverage(
  supabase: DashboardSupabaseClient,
  {
    practitionerId,
    startAt,
    endAt,
    endInclusive,
  }: {
    practitionerId: string
    startAt: string
    endAt: string
    endInclusive: boolean
  },
) {
  let offset = 0
  let expectedCount: number | null = null
  let scoreCount = 0
  let scoreSum = 0

  while (expectedCount === null || offset < expectedCount) {
    let query = supabase
      .from('assessments')
      .select('overall_score', { count: 'exact' })
      .eq('practitioner_id', practitionerId)
      .eq('status', 'complete')
      .gte('created_at', startAt)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + SCORE_PAGE_SIZE - 1)
    query = endInclusive
      ? query.lte('created_at', endAt)
      : query.lt('created_at', endAt)

    const { data, error, count } = await query
    if (error) return { data: null, error }
    if (expectedCount === null && typeof count === 'number') expectedCount = count

    const rows = data ?? []
    for (const row of rows) {
      const score = row.overall_score
      if (typeof score === 'number' && Number.isFinite(score)) {
        scoreSum += score
        scoreCount += 1
      }
    }

    offset += rows.length
    if (rows.length === 0 || (expectedCount === null && rows.length < SCORE_PAGE_SIZE)) break
  }

  return {
    data: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
    error: null,
  }
}

/** Unwrap the single row owned_client_longest_since_scan returns, if any. */
function firstRescanRow(rows: unknown): RescanRow | null {
  const list = (rows ?? []) as RescanRow[]
  const row = Array.isArray(list) ? list[0] : (list as RescanRow | null)
  if (!row?.id || !row.last_scan_at) return null
  return row
}
