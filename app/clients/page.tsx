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
  const [erasureNotice, setErasureNotice] = useState<'complete' | 'pending' | null>(null)

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
  useEffect(() => {
    // Existing imperative Supabase loader; it owns loading/error state updates.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchClients()
    const status = new URLSearchParams(window.location.search).get('erasure')
    if (status === 'complete') {
      sessionStorage.removeItem('postureai:pending-erasure-receipt')
      setErasureNotice('complete')
    }
  }, [fetchClients])

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('erasure')
    const receiptId = sessionStorage.getItem('postureai:pending-erasure-receipt')
    if (status !== 'pending' || !receiptId) return

    let stopped = false
    // The query/session receipt is external navigation state synchronized here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErasureNotice('pending')
    async function poll() {
      const response = await fetch('/api/privacy/erasure-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ receipt_id: receiptId }),
      }).catch(() => null)
      if (stopped || !response?.ok) return
      const body = await response.json().catch(() => ({})) as { external_deletion_status?: string }
      if (body.external_deletion_status === 'complete') {
        sessionStorage.removeItem('postureai:pending-erasure-receipt')
        setErasureNotice('complete')
        window.history.replaceState(null, '', '/clients?erasure=complete')
      }
    }
    void poll()
    const timer = window.setInterval(poll, 5_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

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
    <div className="app-standard-page">
      <div className="app-page-header">
        <div>
          <p className="app-page-kicker">Practice directory</p>
          <h1 className="app-page-heading">Clients</h1>
          <p className="app-page-lede">Find a record, review prior screens, or begin a new baseline.</p>
        </div>
        <Link
          href="/clients/new"
          className="app-gradient-action"
        >
          <span>New client&nbsp; ↗</span>
        </Link>
      </div>

      <div className="app-search-shell">
        <input
          type="text"
          placeholder="Search clients by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
                        boxSizing: 'border-box' as const,
          }}
        />
      </div>

      {erasureNotice === 'complete' && (
        <p role="status" className="app-panel" style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
          Client data was erased. No external file cleanup remains.
        </p>
      )}
      {erasureNotice === 'pending' && (
        <p role="alert" className="app-panel" style={{ padding: '12px 16px', color: 'var(--warning)' }}>
          Client database data was erased. Stored report cleanup is still pending; this page is checking its retry status automatically.
        </p>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>Error loading clients: {error}</p>}

      {loading ? (
        <div className="app-panel app-empty-state"><div className="app-empty-state-icon"><span className="data-readout">···</span></div><div><h2>Loading clients</h2><p>Preparing the practice directory.</p></div></div>
      ) : filtered.length === 0 && clients.length === 0 ? (
        <div className="app-panel app-empty-state"><div className="app-empty-state-icon"><span className="data-readout">01</span></div><div><h2>No clients yet</h2><p>Add the first client when you are ready to create a baseline.</p></div><Link href="/clients/new">Add client →</Link></div>
      ) : filtered.length === 0 ? (
        <div className="app-panel app-empty-state"><div className="app-empty-state-icon"><span className="data-readout">0</span></div><div><h2>No matching clients</h2><p>Try a different first or last name.</p></div></div>
      ) : (
        <div className="app-list">
          {filtered.map((client, index) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="app-list-row"
              style={{ textDecoration: 'none', color: 'var(--text-primary)' }}
            >
              <span className="app-row-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="app-row-main">{client.first_name} {client.last_name}</span>
              <span className="app-row-meta">
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
