import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ClientsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, date_of_birth, created_at, archived_at')
    .eq('practitioner_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5' }}>Clients</h1>
        <Link
          href="/clients/new"
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
          + New Client
        </Link>
      </div>
      {error && <p style={{ color: '#EF4444' }}>Error loading clients: {error.message}</p>}
      {!clients?.length && (
        <p style={{ color: '#A1A1AA' }}>No clients yet. Add your first client to get started.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {clients?.map((client) => (
          <Link
            key={client.id}
            href={`/clients/${client.id}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px',
              background: '#161618',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              textDecoration: 'none',
              color: '#F5F5F5',
            }}
          >
            <span style={{ fontWeight: 500 }}>{client.first_name} {client.last_name}</span>
            <span style={{ fontSize: '0.8rem', color: '#A1A1AA' }}>
              Added {new Date(client.created_at).toLocaleDateString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
