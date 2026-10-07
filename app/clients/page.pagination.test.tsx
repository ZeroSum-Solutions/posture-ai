// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ClientsPage from './page'

function client(id: string, firstName: string) {
  return {
    id,
    first_name: firstName,
    last_name: 'Example',
    date_of_birth: null,
    created_at: '2026-07-22T12:00:00.000Z',
  }
}

describe('client directory pagination', () => {
  let finishStaleLoad: (() => void) | null = null

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor=cursor-one')) {
        return new Promise<Response>((resolve) => {
          finishStaleLoad = () => resolve(new Response(JSON.stringify({ clients: [], pagination: { has_more: false } }), { status: 200 }))
        })
      }
      if (url.includes('search=Jane')) {
        return Promise.resolve(new Response(JSON.stringify({
          clients: [client('20000000-0000-4000-8000-000000000002', 'Jane')],
          pagination: { has_more: true, next_cursor: 'cursor-two' },
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [client('10000000-0000-4000-8000-000000000001', 'Initial')],
        pagination: { has_more: true, next_cursor: 'cursor-one' },
      }), { status: 200 }))
    }))
  })

  afterEach(() => {
    finishStaleLoad?.()
    finishStaleLoad = null
    cleanup()
    vi.unstubAllGlobals()
  })

  // The Array directory is a browsable list, not a search box that reveals one:
  // it loads on arrival so the practitioner sees who is overdue without typing.
  it('loads the directory on arrival and narrows it on a settled search', async () => {
    render(<ClientsPage />)

    await screen.findByRole('link', { name: /Initial Example/ })
    const initialUrls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    expect(initialUrls).toHaveLength(1)
    expect(initialUrls[0]).toContain('filter=all')
    expect(initialUrls[0]).not.toContain('search=')

    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Jane' } })

    await screen.findByRole('link', { name: /Jane Example/ })
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('search=Jane'))).toBe(true)
  })

  it('resolves a chosen filter on the server, not over one page in the browser', async () => {
    render(<ClientsPage />)
    await screen.findByRole('link', { name: /Initial Example/ })

    fireEvent.click(screen.getByRole('button', { name: /Needs review/ }))

    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
      expect(urls.some((url) => url.includes('filter=needs_review'))).toBe(true)
    })
  })

  // v3: the hand-rolled "Load more clients" / "Loading…" button is now the
  // shared `Button` component with its own loading contract — label stays
  // "Show more" throughout (DESIGN.md › Clients: "~30 + 'Show more'"), and
  // busy state is `aria-busy` rather than a disabled attribute or a text swap
  // (components/ui/Button: `loading` swallows clicks via its own handler, it
  // never sets the native `disabled` attribute).
  it('does not leave Show more stuck busy when search replaces an in-flight page', async () => {
    render(<ClientsPage />)
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Initial' } })
    await screen.findByRole('link', { name: /Initial Example/ })

    const showMore = screen.getByRole('button', { name: 'Show more' })
    fireEvent.click(showMore)
    expect(showMore.getAttribute('aria-busy')).toBe('true')

    fireEvent.change(search, { target: { value: 'Jane' } })

    await screen.findByRole('link', { name: /Jane Example/ })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show more' }).getAttribute('aria-busy')).not.toBe('true'))
  })

  it('keeps prior results visible and announces a slow search without shrinking the touch target', async () => {
    let finishSearch: ((response: Response) => void) | null = null
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('search=Slow')) {
        return new Promise<Response>((resolve) => { finishSearch = resolve })
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [client('10000000-0000-4000-8000-000000000001', 'Initial')],
        pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    }))

    render(<ClientsPage />)
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Initial' } })
    await screen.findByRole('link', { name: /Initial Example/ })
    // v3: touch-target size is a CSS-class contract of the shared SearchField
    // (components/ui/Field.module.css: `.control { min-height: 52px }`), not
    // a per-instance inline-style override — there is no longer an inline
    // `style.minHeight` to assert on the input itself.

    fireEvent.change(search, { target: { value: 'Slow' } })
    expect((await screen.findByRole('status')).textContent).toContain('Searching…')
    expect(screen.getByRole('link', { name: /Initial Example/ })).toBeTruthy()

    await waitFor(() => expect(finishSearch).not.toBeNull())
    finishSearch!(new Response(JSON.stringify({
      clients: [client('20000000-0000-4000-8000-000000000002', 'Slow')],
      pagination: { has_more: false, next_cursor: null },
    }), { status: 200 }))
    await screen.findByRole('link', { name: /Slow Example/ })
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull())
  })

  it('aborts obsolete directory work on input and refetches an invalidated settled query', async () => {
    let firstSearchAborted = false
    let searchRequestCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('search=Ada')) {
        searchRequestCount += 1
        if (searchRequestCount === 1) {
          init?.signal?.addEventListener('abort', () => { firstSearchAborted = true }, { once: true })
          return new Promise<Response>(() => {})
        }
        return Promise.resolve(new Response(JSON.stringify({
          clients: [client('30000000-0000-4000-8000-000000000003', 'Ada')],
          pagination: { has_more: false, next_cursor: null },
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [client('10000000-0000-4000-8000-000000000001', 'Initial')],
        pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    }))

    render(<ClientsPage />)
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Ada' } })
    await waitFor(() => expect(searchRequestCount).toBe(1))

    fireEvent.change(search, { target: { value: 'Ada L' } })
    expect(firstSearchAborted).toBe(true)
    fireEvent.change(search, { target: { value: 'Ada' } })

    await screen.findByRole('link', { name: /Ada Example/ })
    expect(searchRequestCount).toBe(2)
  })
})

describe('client directory error state', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // A failed fetch and a genuinely empty directory must never render the same
  // way: to a practitioner scanning the list, "no clients yet" reads as
  // reassurance, not as a warning that the query broke.
  it('never renders the friendly empty state when the directory fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
    ))

    render(<ClientsPage />)

    expect((await screen.findByRole('alert')).textContent).toBe('Could not load clients. Refresh to try again.')
    expect(screen.queryByText('No clients yet')).toBeNull()
    expect(screen.queryByText('Add a client to start their screening history.')).toBeNull()
  })
})
