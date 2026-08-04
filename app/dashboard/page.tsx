import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import DashboardExperience from './DashboardExperience'
import { averageOf, buildTodayModel, initialsOf, type AwaitingRow, type RecentRow, type RescanRow } from './todayModel'

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
    weekScoresResult,
    priorWeekScoresResult,
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
    supabase
      .from('assessments')
      .select('overall_score')
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .gte('created_at', weekAgo),
    supabase
      .from('assessments')
      .select('overall_score')
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo),
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
    // Longest since a scan. The feed is descending, so the first row per client
    // is that client's latest scan; clients with no scan at all are absent,
    // since "due for re-scan" only means something after a first one.
    supabase
      .from('assessments')
      .select('created_at, clients!inner(id, first_name, last_name, deleted_at, archived_at)')
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .is('clients.deleted_at', null)
      .is('clients.archived_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const failed = [
    clientCountResult, clientsAddedResult, weekScansResult, priorWeekScansResult,
    weekScoresResult, priorWeekScoresResult, awaitingResult, awaitingCountResult,
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

  const { data: practitioner } = await supabase
    .from('practitioners')
    .select('first_name, last_name')
    .eq('id', user.id)
    .maybeSingle()

  const model = buildTodayModel({
    awaiting,
    awaitingTotal: awaitingCountResult.count ?? awaiting.length,
    recent,
    rescan: pickMostOverdue(rescanResult.data),
    counts: {
      activeClients: clientCountResult.count ?? 0,
      clientsAddedThisWeek: clientsAddedResult.count ?? 0,
      scansThisWeek: weekScansResult.count ?? 0,
      scansPriorWeek: priorWeekScansResult.count ?? 0,
      averageScoreThisWeek: averageOf((weekScoresResult.data ?? []).map(row => row.overall_score)),
      averageScorePriorWeek: averageOf((priorWeekScoresResult.data ?? []).map(row => row.overall_score)),
    },
    now,
  })

  return (
    <DashboardExperience
      model={model}
      practitionerInitials={initialsOf(practitioner?.first_name ?? '', practitioner?.last_name ?? '')}
      todayLabel={new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
      loadError={loadError}
    />
  )
}

/** Reduce a descending scan feed to the client whose most recent scan is oldest. */
function pickMostOverdue(rows: unknown): RescanRow | null {
  type ClientRef = { id: string; first_name: string; last_name: string }
  const feed = (rows ?? []) as Array<{ created_at: string | null; clients: ClientRef | ClientRef[] | null }>
  const latestByClient = new Map<string, RescanRow>()
  for (const row of feed) {
    const client = firstRelation(row.clients)
    if (!client || latestByClient.has(client.id)) continue
    latestByClient.set(client.id, {
      id: client.id,
      first_name: client.first_name,
      last_name: client.last_name,
      last_scan_at: row.created_at,
    })
  }
  let oldest: RescanRow | null = null
  for (const candidate of latestByClient.values()) {
    if (!candidate.last_scan_at) continue
    if (!oldest?.last_scan_at || candidate.last_scan_at < oldest.last_scan_at) oldest = candidate
  }
  return oldest
}
