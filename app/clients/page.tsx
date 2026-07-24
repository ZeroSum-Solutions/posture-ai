'use client'
import { startTransition, useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import DebouncedSearchInput from '@/components/DebouncedSearchInput'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  created_at: string
}

interface ClientPageResponse {
  clients?: Client[]
  pagination?: {
    next_cursor?: string | null
    has_more?: boolean
  }
  error?: string
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [erasureNotice, setErasureNotice] = useState<'complete' | 'pending' | null>(null)
  const requestVersion = useRef(0)
  const clientPageController = useRef<AbortController | null>(null)
  const loadMoreController = useRef<AbortController | null>(null)
  useEffect(() => () => {
    clientPageController.current?.abort()
    loadMoreController.current?.abort()
  }, [])

  const fetchClientPage = useCallback(async (input: {
    search: string
    cursor?: string | null
    signal?: AbortSignal
  }): Promise<ClientPageResponse> => {
    const query = new URLSearchParams({ limit: '50' })
    if (input.search) query.set('search', input.search)
    if (input.cursor) query.set('cursor', input.cursor)
    const response = await fetch(`/api/clients?${query.toString()}`, {
      cache: 'no-store',
      signal: input.signal,
    })
    if (response.status === 401) {
      window.location.assign('/auth/sign-in')
      throw new Error('Unauthorized')
    }
    const body = await response.json().catch(() => ({})) as ClientPageResponse
    if (!response.ok) throw new Error(body.error || 'Could not load clients.')
    return body
  }, [])

  // Server-side search is debounced so a growing directory never has to be
  // downloaded just to filter it in the browser. Each response is a maximum of
  // 50 records and older responses are discarded when the query changes.
  useEffect(() => {
    const version = ++requestVersion.current
    clientPageController.current?.abort()
    const controller = new AbortController()
    clientPageController.current = controller
    const normalizedSearch = search.trim().replace(/\s+/g, ' ')
    const timer = window.setTimeout(async () => {
      try {
        const body = await fetchClientPage({ search: normalizedSearch, signal: controller.signal })
        if (controller.signal.aborted || requestVersion.current !== version) return
        startTransition(() => {
          setClients(body.clients ?? [])
          setNextCursor(body.pagination?.has_more ? body.pagination.next_cursor ?? null : null)
          setError(null)
          setLoading(false)
          setSearching(false)
        })
      } catch (caught) {
        if ((caught as Error)?.name === 'AbortError' || requestVersion.current !== version) return
        startTransition(() => {
          setNextCursor(null)
          if ((caught as Error)?.message !== 'Unauthorized') setError('Could not load clients. Refresh to try again.')
          setLoading(false)
          setSearching(false)
        })
      } finally {
        if (clientPageController.current === controller) {
          clientPageController.current = null
        }
      }
    }, 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (clientPageController.current === controller) {
        clientPageController.current = null
      }
    }
  }, [fetchClientPage, search, searchRevision])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const status = new URLSearchParams(window.location.search).get('erasure')
      if (status === 'complete') {
        sessionStorage.removeItem('postureai:pending-erasure-receipt')
        setErasureNotice('complete')
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function loadMoreClients() {
    if (!nextCursor || loadingMore) return
    const version = requestVersion.current
    loadMoreController.current?.abort()
    const controller = new AbortController()
    loadMoreController.current = controller
    setLoadingMore(true)
    setError(null)
    try {
      const body = await fetchClientPage({
        search: search.trim().replace(/\s+/g, ' '),
        cursor: nextCursor,
        signal: controller.signal,
      })
      if (requestVersion.current !== version) return
      setClients((current) => {
        const seen = new Set(current.map((client) => client.id))
        return [...current, ...(body.clients ?? []).filter((client) => !seen.has(client.id))]
      })
      setNextCursor(body.pagination?.has_more ? body.pagination.next_cursor ?? null : null)
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError' && requestVersion.current === version && (caught as Error)?.message !== 'Unauthorized') {
        setError('Could not load more clients. Try again.')
      }
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('erasure')
    const receiptId = sessionStorage.getItem('postureai:pending-erasure-receipt')
    if (status !== 'pending' || !receiptId) return

    let stopped = false
    // The query/session receipt is external navigation state synchronized here.
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
        <DebouncedSearchInput
          placeholder="Search clients by name..."
          ariaLabel="Search clients by name"
          onInputActivity={() => {
            // The initial 50-row directory request must not finish and repaint
            // over a practitioner's next keystroke. Keep the input DOM-owned
            // while cancelling obsolete work immediately.
            const controller = clientPageController.current
            if (!controller) return false
            requestVersion.current += 1
            controller.abort()
            clientPageController.current = null
            return true
          }}
          onQueryChange={(query) => {
            loadMoreController.current?.abort()
            loadMoreController.current = null
            setLoadingMore(false)
            if (query === search) {
              setSearchRevision((current) => current + 1)
            } else {
              setSearch(query)
            }
            setSearching(true)
            setError(null)
            setNextCursor(null)
          }}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            minHeight: '44px',
            boxSizing: 'border-box' as const,
          }}
        />
      </div>

      {searching && !loading && (
        <p role="status" aria-live="polite" style={{ color: 'var(--text-secondary)', margin: '-12px 0 16px' }}>
          Searching…
        </p>
      )}

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

      {error && <p role="alert" style={{ color: 'var(--danger)' }}>Error loading clients: {error}</p>}

      {loading ? (
        <div className="app-panel app-empty-state"><div className="app-empty-state-icon"><span className="data-readout">···</span></div><div><h2>Loading clients</h2><p>Preparing the practice directory.</p></div></div>
      ) : error && clients.length === 0 ? null : clients.length === 0 && !search.trim() ? (
        <div className="app-panel app-empty-state"><div className="app-empty-state-icon"><span className="data-readout">01</span></div><div><h2>No clients yet</h2><p>Add the first client when you are ready to create a baseline.</p></div><Link href="/clients/new">Add client →</Link></div>
      ) : clients.length === 0 ? (
        <div className="app-panel app-empty-state"><div className="app-empty-state-icon"><span className="data-readout">0</span></div><div><h2>No matching clients</h2><p>Try a different first or last name.</p></div></div>
      ) : (
        <>
          <div className="app-list">
            {clients.map((client, index) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                prefetch={false}
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
          {nextCursor && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="app-gradient-action"
                disabled={loadingMore}
                onClick={loadMoreClients}
              >
                <span>{loadingMore ? 'Loading…' : 'Load more clients'}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
