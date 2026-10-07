'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import DebouncedSearchInput from '@/components/DebouncedSearchInput'
import Icon from '@/components/array/Icon'
import { FilterChip, FilterRow, GradeChip } from '@/components/array/Chip'
import { Surface, SurfaceLink } from '@/components/array/Surface'
import { tone } from '@/components/array/severity'
import { CLIENT_FILTERS, toDirectoryRow, type ClientFilter, type DirectoryClient } from './clientRow'
import { REPEAT_CAPTURE_LIMITATION_COPY } from '@/lib/comparison/policy'
import styles from './ClientsPage.module.css'

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
    const query = new URLSearchParams({ limit: '50', filter: input.filter })
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

  return (
    <div className="app-screen">
      <header className={styles.header}>
        <div>
          <p className="t-overline" style={{ marginBottom: 10 }}>
            Directory{summary ? ` — ${summary.total} active` : ''}
          </p>
          <h1 className="t-title-1">Clients</h1>
        </div>
        <Link href="/clients/new" className={styles.add} aria-label="Add a new client">
          <Icon name="user-plus-linear" size={20} />
        </Link>
      </header>

      <div className="app-screen-x app-stack">
        <div className={styles.searchShell}>
          <div className={styles.searchGradient} />
          <div className={styles.searchInner}>
            <Icon name="magnifer-linear" size={17} />
            <DebouncedSearchInput
              placeholder="Search by name"
              ariaLabel="Search clients by name"
              style={{ minHeight: 44 }}
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
          </div>
        </div>

        <FilterRow label="Filter the directory">
          {CLIENT_FILTERS.map((entry) => (
            <FilterChip
              key={entry.value}
              label={entry.label}
              count={counts[entry.value]}
              active={filter === entry.value}
              band={entry.band}
              onClick={() => {
                if (filter === entry.value) return
                setNextCursor(null)
                if (clients.length > 0) setSearching(true)
                else setLoading(true)
                setFilter(entry.value)
              }}
            />
          ))}
        </FilterRow>
        <p className="t-footnote">{REPEAT_CAPTURE_LIMITATION_COPY}</p>

        <div className={styles.sortRow}>
          <span className="t-footnote">Sorted by date added</span>
          <span className={styles.sortValue}>
            <Icon name="sort-vertical-linear" size={14} />
            Newest first
          </span>
        </div>

        {erasureNotice === 'complete' && (
          <Surface tier="tile" pad="rowy">
            <p role="status" className="t-body">Client data was erased. No external file cleanup remains.</p>
          </Surface>
        )}
        {erasureNotice === 'pending' && (
          <Surface tier="tile" pad="rowy">
            <p role="alert" className="t-body" style={{ color: tone('monitor') }}>
              Client database data was erased. Stored report cleanup is still pending; this page is
              checking its retry status automatically.
            </p>
          </Surface>
        )}

        {error && (
          <Surface tier="tile" pad="rowy">
            <p role="alert" className="t-body" style={{ color: tone('monitor') }}>{error}</p>
          </Surface>
        )}

        {searching && !loading && (
          <p className={styles.status} role="status" aria-live="polite">Searching…</p>
        )}

        {loading ? (
          <p className={styles.status} role="status" aria-live="polite">Loading the directory…</p>
        ) : error && rows.length === 0 ? (
          // A failed fetch must never fall through to the empty-directory copy
          // below: to a practitioner scanning the list, "no clients yet" and
          // "the directory is broken" look identical unless this is kept
          // separate. The error banner above is already the full explanation.
          null
        ) : rows.length === 0 ? (
          <Surface tier="tile" pad="rowy">
            <div className={styles.empty}>
              <p className="t-headline">
                {search.trim()
                  ? 'No matching clients'
                  : filter === 'all' ? 'No clients yet' : `Nothing under ${activeLabel.toLowerCase()}`}
              </p>
              <p className="t-body">
                {search.trim()
                  ? 'Try a different first or last name.'
                  : filter === 'all'
                    ? 'Add a client to start their screening history.'
                    : 'Clear the filter to see the whole directory.'}
              </p>
            </div>
          </Surface>
        ) : (
          <>
            {rows.map((row) => (
              <SurfaceLink key={row.id} href={row.href} tier="row">
                <span className={styles.row}>
                  <GradeChip grade={row.grade} />
                  <span className={styles.body}>
                    <span className={styles.name}>{row.name}</span>
                    <span className={styles.meta}>{row.meta}</span>
                  </span>
                  <span className={styles.trend}>
                    {/* The visible form is a bare arrow and number; the sentence
                        beside it is what a screen reader reads instead. No
                        aria-label on the row itself — that would replace the
                        grade and scan meta rather than add to them. */}
                    <span className={styles.trendValue} style={{ color: tone(row.trendBand) }} aria-hidden="true">
                      <Icon name={row.trendIcon} size={14} />
                      {row.trend}
                    </span>
                    <span className="sr-only">{row.trendLabel}</span>
                    <span className={styles.chevron}>
                      <Icon name="alt-arrow-right-linear" size={16} />
                    </span>
                  </span>
                </span>
              </SurfaceLink>
            ))}
            {nextCursor && (
              <div className={styles.more}>
                <button type="button" className="a-secondary" disabled={loadingMore} onClick={loadMoreClients}>
                  {loadingMore ? 'Loading…' : 'Load more clients'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
