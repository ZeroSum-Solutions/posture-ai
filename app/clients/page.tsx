'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/array/Icon'
import { bandFromGrade } from '@/components/array/severity'
import {
  Avatar,
  Banner,
  Button,
  ChipRow,
  EmptyState,
  FilterChip,
  IconButton,
  ListGroup,
  ListRow,
  ListRowSkeleton,
  SearchField,
  SeverityChip,
  Sheet,
  TopBar,
} from '@/components/ui'
import { CLIENT_FILTERS, toDirectoryRow, type ClientFilter, type DirectoryClient, type DirectoryRow } from './clientRow'
import { REPEAT_CAPTURE_LIMITATION_COPY } from '@/lib/comparison/policy'

const PAGE_SIZE = 30
const DISCLAIMER_DISMISSED_KEY = 'pa:clients-disclaimer-dismissed'

interface DirectorySummary {
  total: number
  needs_review: number
  improving: number
  overdue: number
}

interface ClientPageResponse {
  clients?: DirectoryClient[]
  summary?: DirectorySummary | null
  pagination?: { next_cursor?: string | null; has_more?: boolean }
  error?: string
}

function readDisclaimerDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISCLAIMER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/** The row's one trailing status indicator (DESIGN.md › Clients: "trailing
 * SeverityChip or status chip once"). Priority: a fresh client reads "New",
 * never "Overdue" — then review > overdue > the last grade. */
function RowStatus({ row }: { row: DirectoryRow }) {
  if (!row.hasScan) return <SeverityChip band="neutral" size="sm" label="New" />
  if (row.awaitingReview) return <SeverityChip band="monitor" size="sm" label="In review" />
  if (row.overdue) return <SeverityChip band="monitor" size="sm" label="Overdue" />
  // `bandFromGrade` is typed for the wider engine SeverityBand (it also
  // covers 'info'), but a grade band never actually resolves to 'info'.
  const band = bandFromGrade(row.grade)
  return <SeverityChip band={band === 'info' ? 'neutral' : band} size="sm" />
}

export default function ClientsPage() {
  const [clients, setClients] = useState<DirectoryClient[]>([])
  const [summary, setSummary] = useState<DirectorySummary | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ClientFilter>('all')
  const [searchRevision, setSearchRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  /** A refetch over results already on screen: announce it, keep them visible. */
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [erasureNotice, setErasureNotice] = useState<'complete' | 'pending' | null>(null)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(readDisclaimerDismissed)
  const requestVersion = useRef(0)
  const clientPageController = useRef<AbortController | null>(null)
  const loadMoreController = useRef<AbortController | null>(null)

  useEffect(() => () => {
    clientPageController.current?.abort()
    loadMoreController.current?.abort()
  }, [])

  const fetchClientPage = useCallback(async (input: {
    search: string
    filter: ClientFilter
    cursor?: string | null
    signal?: AbortSignal
  }): Promise<ClientPageResponse> => {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), filter: input.filter })
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

  // The directory loads on arrival and reloads when the search or filter changes.
  // Filtering happens in SQL, so a page always reflects the chip that is lit — a
  // client-side filter over one page would quietly hide matching records.
  useEffect(() => {
    const version = ++requestVersion.current
    clientPageController.current?.abort()
    const normalizedSearch = search.trim().replace(/\s+/g, ' ')
    const controller = new AbortController()
    clientPageController.current = controller

    const run = async () => {
      try {
        const body = await fetchClientPage({ search: normalizedSearch, filter, signal: controller.signal })
        if (controller.signal.aborted || requestVersion.current !== version) return
        startTransition(() => {
          setClients(body.clients ?? [])
          if (body.summary) setSummary(body.summary)
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
        if (clientPageController.current === controller) clientPageController.current = null
      }
    }
    void run()

    return () => {
      controller.abort()
      if (clientPageController.current === controller) clientPageController.current = null
    }
  }, [fetchClientPage, search, searchRevision, filter])

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

  // Today's "Needs attention" hands off here with `?filter=needs-review`.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('filter')
    if (requested === 'needs-review') setFilter('needs_review')
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
        filter,
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

  // One clock for the whole render, so every "scanned N days ago" agrees — but it
  // has to keep moving. A directory left open overnight would otherwise go on
  // saying "Today" and would never cross the six-week overdue boundary.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const rows = useMemo(() => clients.map((client) => toDirectoryRow(client, now)), [clients, now])

  const counts: Record<ClientFilter, number | undefined> = {
    all: summary?.total,
    needs_review: summary?.needs_review,
    improving: summary?.improving,
    overdue: summary?.overdue,
  }
  const activeLabel = CLIENT_FILTERS.find((entry) => entry.value === filter)?.label ?? 'All'

  function dismissDisclaimer() {
    setDisclaimerDismissed(true)
    try {
      window.localStorage.setItem(DISCLAIMER_DISMISSED_KEY, '1')
    } catch {
      // Private-browsing / blocked storage: the hint just reappears next visit.
    }
  }
  function reopenDisclaimer() {
    setDisclaimerDismissed(false)
    try {
      window.localStorage.removeItem(DISCLAIMER_DISMISSED_KEY)
    } catch {
      // Same as above — non-fatal.
    }
  }

  return (
    <div className="app-screen">
      <TopBar
        title="Clients"
        subtitle={summary ? `${summary.total} active` : undefined}
        actions={(
          <>
            <IconButton icon="sort-vertical-linear" label="Sort clients" onClick={() => setSortSheetOpen(true)} />
            <IconButton icon="user-plus-linear" label="New client" onClick={() => window.location.assign('/clients/new')} />
          </>
        )}
      />

      <div className="app-screen-x app-stack">
        <SearchField
          label="Search clients by name"
          placeholder="Search by name"
          onInputActivity={() => {
            // Keep the input DOM-owned while cancelling an obsolete settled search.
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
            if (query === search) setSearchRevision((current) => current + 1)
            else setSearch(query)
            // Results already on screen stay put while the next page lands.
            if (clients.length > 0) setSearching(true)
            else setLoading(true)
            setError(null)
            setNextCursor(null)
          }}
        />

        <ChipRow label="Filter the directory">
          {CLIENT_FILTERS.map((entry) => (
            <FilterChip
              key={entry.value}
              label={entry.label}
              count={counts[entry.value]}
              selected={filter === entry.value}
              onToggle={() => {
                if (filter === entry.value) return
                setNextCursor(null)
                if (clients.length > 0) setSearching(true)
                else setLoading(true)
                setFilter(entry.value)
              }}
            />
          ))}
        </ChipRow>

        {disclaimerDismissed ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <IconButton icon="info-circle-linear" label="About recorded values" onClick={reopenDisclaimer} />
          </div>
        ) : (
          <Banner variant="info" hint onDismiss={dismissDisclaimer}>
            {REPEAT_CAPTURE_LIMITATION_COPY}
          </Banner>
        )}

        {erasureNotice === 'complete' && (
          <div role="status">
            <Banner variant="success">Client data was erased. No external file cleanup remains.</Banner>
          </div>
        )}
        {erasureNotice === 'pending' && (
          <div role="alert">
            <Banner variant="warn">
              Client database data was erased. Stored report cleanup is still pending; this page is
              checking its retry status automatically.
            </Banner>
          </div>
        )}
        {error && <Banner variant="error">{error}</Banner>}

        {searching && !loading && (
          <p className="t-footnote" role="status" aria-live="polite">Searching…</p>
        )}

        {loading ? (
          <div role="status" aria-busy="true" aria-label="Loading clients">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : error && rows.length === 0 ? (
          // A failed fetch must never fall through to the empty-directory copy
          // below: to a practitioner scanning the list, "no clients yet" and
          // "the directory is broken" look identical unless this is kept
          // separate. The error banner above is already the full explanation.
          null
        ) : rows.length === 0 ? (
          <EmptyState
            icon="users-group-rounded-linear"
            title={search.trim() ? 'No matching clients' : filter === 'all' ? 'No clients yet' : `Nothing under ${activeLabel.toLowerCase()}`}
            body={
              search.trim()
                ? 'Try a different first or last name.'
                : filter === 'all'
                  ? 'Add a client to start their screening history.'
                  : 'Clear the filter to see the whole directory.'
            }
            primary={!search.trim() && filter === 'all' ? { label: 'Add client', href: '/clients/new' } : undefined}
          />
        ) : (
          <>
            <ListGroup label="Clients">
              {rows.map((row) => (
                <ListRow
                  key={row.id}
                  href={row.href}
                  // `Avatar` carries its own sr-only full name for standalone use;
                  // hidden here so the row link's accessible name states the name
                  // once (from `title`), not twice.
                  leading={<span aria-hidden="true"><Avatar name={row.name} /></span>}
                  title={row.name}
                  subtitle={row.meta}
                  trailing={<RowStatus row={row} />}
                  chevron
                />
              ))}
            </ListGroup>
            {nextCursor && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--s-4)' }}>
                <Button variant="secondary" loading={loadingMore} onClick={loadMoreClients}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Sheet open={sortSheetOpen} onOpenChange={setSortSheetOpen} title="Sort clients" detents={['compact']}>
        {/* The directory has one supported order today (date added, newest
            first) — the API takes no sort parameter (app/api/clients/route.ts).
            This picker states that order rather than offering choices the
            server cannot honor. */}
        <ListGroup label="Sort options">
          <ListRow
            title="Newest first"
            subtitle="By date added"
            trailing={<Icon name="check-linear" size={18} />}
            aria-label="Newest first, selected"
          />
        </ListGroup>
      </Sheet>
    </div>
  )
}
