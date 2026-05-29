import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { count: clientCount } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('practitioner_id', user.id)

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: weekAssessments } = await supabase
    .from('assessments')
    .select('id', { count: 'exact', head: true })
    .eq('practitioner_id', user.id)
    .gte('created_at', oneWeekAgo)

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5' }}>Dashboard</h1>
        <a
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
        </a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <StatCard label="Total Clients" value={clientCount ?? 0} />
        <StatCard label="Assessments This Week" value={weekAssessments ?? 0} />
      </div>
      <p style={{ color: '#A1A1AA', fontSize: '0.85rem' }}>
        Welcome to Posture AI. Use the navigation above to manage clients and run assessments.
      </p>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: '#161618',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      padding: '20px',
    }}>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: '#F5F5F5' }}>{value}</div>
      <div style={{ fontSize: '0.85rem', color: '#A1A1AA', marginTop: '4px' }}>{label}</div>
    </div>
  )
}
