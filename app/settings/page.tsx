import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { data: practitioner } = await supabase
    .from('practitioners')
    .select('display_name, practice_name')
    .eq('id', user.id)
    .single()

  return (
    <div style={{ padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>Settings</h1>
      <div style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '16px',
      }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>Profile</h2>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '0.85rem', color: '#A1A1AA', display: 'block', marginBottom: '4px' }}>Email</label>
          <div style={{ color: '#F5F5F5' }}>{user.email}</div>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '0.85rem', color: '#A1A1AA', display: 'block', marginBottom: '4px' }}>Display Name</label>
          <div style={{ color: '#F5F5F5' }}>{practitioner?.display_name ?? '—'}</div>
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', color: '#A1A1AA', display: 'block', marginBottom: '4px' }}>Practice Name</label>
          <div style={{ color: '#F5F5F5' }}>{practitioner?.practice_name ?? '—'}</div>
        </div>
      </div>
      <form action="/api/auth/sign-out" method="POST">
        <button
          type="submit"
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            background: 'rgba(239,68,68,0.12)',
            color: '#EF4444',
            border: '1px solid rgba(239,68,68,0.3)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Sign Out
        </button>
      </form>
    </div>
  )
}
