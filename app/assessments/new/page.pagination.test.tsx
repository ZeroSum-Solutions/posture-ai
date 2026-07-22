// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerPush = vi.fn()
const router = { push: routerPush }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams('client_id=20000000-0000-4000-8000-000000000002'),
}))
vi.mock('./FullScreenCapture', () => ({ default: () => null }))
vi.mock('@/components/InPersonConsentForm', () => ({ default: () => null }))
vi.mock('@/components/useLegalDocument', () => ({ default: () => ({ status: 'ready' }) }))
vi.mock('@/lib/pose/capture-runtime', () => ({ getCaptureRuntime: () => ({ dispose: vi.fn() }) }))

import { NewAssessmentWizard } from './page'

const pageClient = {
  id: '10000000-0000-4000-8000-000000000001',
  first_name: 'Page',
  last_name: 'One',
  date_of_birth: '1990-01-01',
}
const deepClient = {
  id: '20000000-0000-4000-8000-000000000002',
  first_name: 'Deep',
  last_name: 'Linked',
  date_of_birth: '1991-01-01',
}

describe('new assessment paginated client picker', () => {
  beforeEach(() => {
    routerPush.mockReset()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return new Response(JSON.stringify({ client: deepClient }), { status: 200 })
      }
      return new Response(JSON.stringify({ clients: [pageClient], pagination: { has_more: false, next_cursor: null } }), { status: 200 })
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps an off-page deep-linked selection visible when the directory search changes', async () => {
    render(<NewAssessmentWizard />)

    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Another person' } })

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('search=Another+person'))).toBe(true))
    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    expect((screen.getByRole('button', { name: 'Next: Upload Views' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('re-enables paging when search replaces an in-flight Load more request', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      }
      if (url.includes('cursor=cursor-one')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      if (url.includes('search=Another')) {
        return Promise.resolve(new Response(JSON.stringify({
          clients: [{ ...pageClient, first_name: 'Another' }],
          pagination: { has_more: true, next_cursor: 'cursor-two' },
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [pageClient],
        pagination: { has_more: true, next_cursor: 'cursor-one' },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewAssessmentWizard />)
    await screen.findByText('Page One')
    fireEvent.click(screen.getByRole('button', { name: 'Load more clients' }))
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Another' } })

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('search=Another'))).toBe(true))
    await screen.findByText('Another One')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Load more clients' }) as HTMLButtonElement).disabled).toBe(false))
  })
})
