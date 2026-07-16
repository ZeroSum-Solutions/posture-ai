import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardExperience from './DashboardExperience'

type Assessment = {
  id: string
  overall_grade: string | null
  overall_score: number | null
  created_at: string
  client_id: string
  clients: { first_name: string; last_name: string }[] | { first_name: string; last_name: string } | null
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  // Server component: per-request clock read is intentional here.
  // eslint-disable-next-line react-hooks/purity
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Three independent reads — run them together instead of three serial round trips.
  const [clientCountResult, weekAssessmentsResult, recentAssessmentsResult] = await Promise.all([
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .is('archived_at', null)
      // Erased clients (deleted_at set) must not inflate the count (QA-001).
      .is('deleted_at', null),
    // Count completed assessments only, matching the Recent Activity feed — a
    // failed/abandoned capture must not show as "1 this week" above an empty feed.
    supabase
      .from('assessments')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .gte('created_at', oneWeekAgo),
    supabase
      .from('assessments')
      // !inner + deleted_at filter drops assessments whose client has been erased
      // so a tombstoned client never surfaces in Recent Activity (QA-001).
      .select('id, overall_grade, overall_score, created_at, client_id, clients!inner(first_name, last_name, deleted_at)')
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .is('clients.deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const loadError = clientCountResult.error || weekAssessmentsResult.error || recentAssessmentsResult.error
    ? 'Dashboard data could not load. Refresh to try again.'
    : null
  const recentAssessments = (recentAssessmentsResult.data ?? []) as unknown as Assessment[]

  return (
    <DashboardExperience
      clientCount={clientCountResult.count ?? 0}
      weekAssessments={weekAssessmentsResult.count ?? 0}
      recentAssessments={recentAssessments}
      loadError={loadError}
    />
  )
}
