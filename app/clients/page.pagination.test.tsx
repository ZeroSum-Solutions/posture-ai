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

  it('does not leave Load more disabled when search replaces an in-flight page', async () => {
    render(<ClientsPage />)
    await screen.findByText('Initial Example')

    fireEvent.click(screen.getByRole('button', { name: 'Load more clients' }))
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Jane' } })

    await screen.findByText('Jane Example')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Load more clients' }) as HTMLButtonElement).disabled).toBe(false))
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
    await screen.findByText('Initial Example')
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    expect((search as HTMLInputElement).style.minHeight).toBe('44px')

    fireEvent.change(search, { target: { value: 'Slow' } })
    expect((await screen.findByRole('status')).textContent).toContain('Searching…')
    expect(screen.getByText('Initial Example')).toBeTruthy()

    await waitFor(() => expect(finishSearch).not.toBeNull())
    finishSearch!(new Response(JSON.stringify({
      clients: [client('20000000-0000-4000-8000-000000000002', 'Slow')],
      pagination: { has_more: false, next_cursor: null },
    }), { status: 200 }))
    await screen.findByText('Slow Example')
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
    await screen.findByText('Initial Example')
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Ada' } })
    await waitFor(() => expect(searchRequestCount).toBe(1))

    fireEvent.change(search, { target: { value: 'Ada L' } })
    expect(firstSearchAborted).toBe(true)
    fireEvent.change(search, { target: { value: 'Ada' } })

    await screen.findByText('Ada Example')
    expect(searchRequestCount).toBe(2)
  })
})
