'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { bandFromGrade } from '@/components/array/severity'
import {
  ActionBar,
  Avatar,
  Banner,
  Button,
  ChipRow,
  EmptyState,
  FilterChip,
  Morph,
  SearchField,
  SeverityChip,
  Sheet,
  Skeleton,
  TopBar,
} from '@/components/ui'
import { CLIENT_FILTERS, toDirectoryRow, type ClientFilter, type DirectoryClient, type DirectoryRow } from './clientRow'
import { REPEAT_CAPTURE_LIMITATION_COPY } from '@/lib/comparison/policy'
import styles from './ClientsPage.module.css'

const PAGE_SIZE = 30
const STAGGER_CAP = 8

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

/** The row's status word, beside the scan date. Priority: a fresh client reads
 * "New", never "Overdue" — then a waiting report > overdue. */
function rowStatus(row: DirectoryRow): { text: string; strong: boolean } | null {
  if (!row.hasScan) return { text: 'New', strong: false }
  if (row.awaitingReview) return { text: 'To review', strong: true }
  if (row.overdue) return { text: 'Overdue', strong: false }
  return null
}

/** The latest scan's grade band as beads + word; nothing for a client with no scan. */
function RowSeverity({ row }: { row: DirectoryRow }) {
  if (!row.hasScan) return null
  // `bandFromGrade` is typed for the wider engine SeverityBand (it also
  // covers 'info'), but a grade band never actually resolves to 'info'.
  const band = bandFromGrade(row.grade)
  return <SeverityChip band={band === 'info' ? 'neutral' : band} size="sm" />
}

/**
 * One directory row on the canvas: avatar, name and the dated latest scan —
 * wrapped in the `client-${id}` morph so they carry into the client header —
 * then the latest grade as beads + word (dataviz G).
 */
function ClientRow({ row, index }: { row: DirectoryRow; index: number }) {
  const status = rowStatus(row)
  return (
    <li className={styles.item} style={{ '--i': Math.min(index, STAGGER_CAP) } as CSSProperties}>
      <Link href={row.href} className={styles.row}>
        <Morph name={`client-${row.id}`}>
          <span className={styles.identity}>
            {/* Avatar carries its own sr-only name; hidden so the link names the client once. */}
            <span aria-hidden="true" className={styles.avatar}><Avatar name={row.name} /></span>
            <span className={styles.text}>
              <span className={styles.name}>{row.name}</span>
              <span className={`t-label ${styles.meta}`}>{row.meta}</span>
            </span>
          </span>
        </Morph>
        <span className={styles.trail}>
          <RowSeverity row={row} />
          {status ? (
            <span className={`t-label ${status.strong ? styles.statusStrong : ''}`}>
              <span className="sr-only">, </span>{status.text}
            </span>
          ) : null}
        </span>
        <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
      </Link>
    </li>
  )
}

function RowsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading clients" className={styles.skeletons}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={styles.skeletonRow}>
          <Skeleton shape="row" style={{ width: 40, height: 40, borderRadius: 'var(--r-full)' }} />
          <div className={styles.skeletonText}>
            <Skeleton shape="line" style={{ width: `${48 + ((index * 17) % 30)}%`, height: 16 }} />
            <Skeleton shape="line" style={{ width: '38%', height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  )
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
  const [whyOpen, setWhyOpen] = useState(false)
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

  const searchActive = search.trim().length > 0

  return (
    <div className="app-screen">
      <TopBar
        title="Clients"
        subtitle={summary ? `${summary.total} active` : undefined}
      />

      <div className={`app-screen-x ${styles.page}`}>
        <div className={styles.controls}>
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

          <ChipRow label="Filter the directory" bleed>
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
        </div>

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

        <section aria-labelledby="clients-list-head">
          <div className={styles.listHead}>
            <h2 id="clients-list-head" className="t-micro">
              {searchActive ? 'Matches' : filter === 'all' ? 'Recently added' : activeLabel}
            </h2>
            <button type="button" className={styles.why} onClick={() => setWhyOpen(true)}>
              <Icon name="info-circle-linear" size={16} />
              About values
            </button>
          </div>

          {searching && !loading && (
            <p className={`t-label ${styles.searching}`} role="status" aria-live="polite">Searching…</p>
          )}

          {loading ? (
            <RowsSkeleton />
          ) : error && rows.length === 0 ? (
            // A failed fetch must never fall through to the empty-directory copy
            // below: to a practitioner scanning the list, "no clients yet" and
            // "the directory is broken" look identical unless this is kept
            // separate. The error banner above is already the full explanation.
            null
          ) : rows.length === 0 ? (
            <EmptyState
              icon="users-group-rounded-linear"
              title={searchActive ? 'No matching clients' : filter === 'all' ? 'No clients yet' : `Nothing under ${activeLabel.toLowerCase()}`}
              body={
                searchActive
                  ? 'Try a different first or last name.'
                  : filter === 'all'
                    ? 'Add a client to start their screening history.'
                    : 'Clear the filter to see the whole directory.'
              }
            />
          ) : (
            <>
              <ul className={styles.list} aria-label="Clients" data-searching={searching ? 'true' : undefined}>
                {rows.map((row, index) => (
                  <ClientRow key={row.id} row={row} index={index} />
                ))}
              </ul>
              {nextCursor && (
                <div className={styles.more}>
                  <Button variant="secondary" loading={loadingMore} onClick={loadMoreClients}>
                    Show more
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <ActionBar>
        <Button href="/clients/new" size="lg" block icon="user-plus-linear">
          New client
        </Button>
      </ActionBar>

      <Sheet open={whyOpen} onOpenChange={setWhyOpen} title="About recorded values" detents={['compact']}>
        <p className="t-body">{REPEAT_CAPTURE_LIMITATION_COPY}</p>
      </Sheet>
    </div>
  )
}
