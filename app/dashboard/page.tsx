import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

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

  const { count: clientCount } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('practitioner_id', user.id)
    .is('archived_at', null)

  // Server component: per-request clock read is intentional here.
  // eslint-disable-next-line react-hooks/purity
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: weekAssessments } = await supabase
    .from('assessments')
    .select('id', { count: 'exact', head: true })
    .eq('practitioner_id', user.id)
    .gte('created_at', oneWeekAgo)

  const { data: recentAssessmentsRaw } = await supabase
    .from('assessments')
    .select('id, overall_grade, overall_score, created_at, client_id, clients(first_name, last_name)')
    .eq('practitioner_id', user.id)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(5)

  const recentAssessments = (recentAssessmentsRaw ?? []) as unknown as Assessment[]

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5' }}>Dashboard</h1>
        <Link
          href="/assessments/new"
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            background: '#6366F1',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.9rem',
          }}
        >
          + New Assessment
        </Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <StatCard label="Total Clients" value={clientCount ?? 0} />
        <StatCard label="Assessments This Week" value={weekAssessments ?? 0} />
      </div>

      {/* Recent Activity Feed */}
      <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>Recent Activity</h2>
        {recentAssessments.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentAssessments.map((a) => {
              const clientData = a.clients
              const clientName = clientData
                ? Array.isArray(clientData)
                  ? clientData.length > 0
                    ? `${clientData[0].first_name} ${clientData[0].last_name}`
                    : 'Unknown Client'
                  : `${clientData.first_name} ${clientData.last_name}`
                : 'Unknown Client'
              const date = new Date(a.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
              return (
                <li
                  key={a.id}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    paddingBottom: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <a
                    href={`/assessments/${a.id}`}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none' }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', color: '#F5F5F5', fontWeight: 500 }}>{clientName}</div>
                      <div style={{ fontSize: '0.78rem', color: '#A1A1AA', marginTop: '2px' }}>Assessment · {date}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {a.overall_grade && (
                        <span
                          style={{
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            color: '#6366F1',
                            background: 'rgba(99,102,241,0.12)',
                            borderRadius: '6px',
                            padding: '2px 8px',
                          }}
                        >
                          Grade {a.overall_grade}
                        </span>
                      )}
                      <span style={{ color: '#A1A1AA', fontSize: '1rem' }}>›</span>
                    </div>
                  </a>
                </li>
              )
            })}
          </ul>
        ) : (
          <p style={{ color: '#A1A1AA', fontSize: '0.85rem', margin: 0 }}>
            No assessments yet.{' '}
            <Link href="/assessments/new" style={{ color: '#6366F1' }}>
              Run your first assessment →
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '20px',
      }}
    >
      <div style={{ fontSize: '2rem', fontWeight: 700, color: '#F5F5F5' }}>{value}</div>
      <div style={{ fontSize: '0.85rem', color: '#A1A1AA', marginTop: '4px' }}>{label}</div>
    </div>
  )
}
