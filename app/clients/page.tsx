'use client'
import { useState, useEffect, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  created_at: string
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { window.location.href = '/auth/sign-in'; return }
    const { data, error: fetchError } = await supabase
      .from('clients')
      .select('id, first_name, last_name, date_of_birth, created_at')
      .eq('practitioner_id', user.id)
      .is('archived_at', null)
      // Exclude erased (right-to-erasure) clients — deleted_at is the tombstone.
      // Without this an erased client lingers as a redacted ghost row, disagreeing
      // with /api/clients which filters both (QA-001).
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setClients(data || [])
    }
    setLoading(false)
  }, [])

  // Fetch-on-mount; loading flag flips synchronously by design. Revisit in P5 polish.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchClients() }, [fetchClients])

  const filtered = clients.filter(c => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q) ||
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q)
    )
  })

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5' }}>Clients</h1>
        <Link
          href="/clients/new"
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            background: '#4F46E5',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.9rem',
          }}
        >
          + New Client
        </Link>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search clients by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: '#161618',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px',
            color: '#F5F5F5',
            fontSize: '0.9rem',
                        boxSizing: 'border-box' as const,
          }}
        />
      </div>

      {error && <p style={{ color: '#EF4444' }}>Error loading clients: {error}</p>}

      {loading ? (
        <p style={{ color: '#A1A1AA' }}>Loading clients...</p>
      ) : filtered.length === 0 && clients.length === 0 ? (
        <p style={{ color: '#A1A1AA' }}>No clients yet. Add your first client to get started.</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#A1A1AA' }}>No clients match your search.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((client) => (
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
                {client.date_of_birth
                  ? `DOB: ${new Date(client.date_of_birth).toLocaleDateString()}`
                  : `Added ${new Date(client.created_at).toLocaleDateString()}`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
