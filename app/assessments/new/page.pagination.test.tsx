// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerPush = vi.fn()
const router = { push: routerPush }
const legalDocumentState = vi.hoisted(() => ({
  enabledCalls: [] as boolean[],
  value: {
    document: {} as Record<string, never> | null,
    isLoading: false,
    error: null as string | null,
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams('client_id=20000000-0000-4000-8000-000000000002'),
}))
vi.mock('./FullScreenCapture', () => ({
  default: ({
    captures,
    onCameraCapture,
    onExit,
  }: {
    captures: { front: { rawRepresentativeUrl: string | null; slotStatus: string } }
    onCameraCapture: (slot: 'front', burst: string[], roll: null, pixelQuality: null) => void
    onExit: () => void
  }) => (
    <div data-testid="capture-step">
      <span data-testid="front-capture">{captures.front.rawRepresentativeUrl ?? 'empty'}</span>
      <span data-testid="front-capture-status">{captures.front.slotStatus}</span>
      <button type="button" onClick={() => onCameraCapture('front', ['fixture:manual-front'], null, null)}>
        Record front fixture
      </button>
      <button type="button" onClick={onExit}>Exit capture</button>
    </div>
  ),
}))
vi.mock('@/components/InPersonConsentForm', () => ({ default: () => null }))
vi.mock('@/components/useLegalDocument', () => ({
  default: (_kind: string, enabled = true) => {
    legalDocumentState.enabledCalls.push(enabled)
    return legalDocumentState.value
  },
}))
vi.mock('@/lib/pose/capture-runtime', () => ({
  getCaptureRuntime: () => ({
    detect: vi.fn(async () => ({
      view: 'front',
      source: 'camera',
      detectedPoseCount: 1,
      landmarks: {
        left_shoulder: { x: 0.4, y: 0.3, visibility: 1 },
        left_hip: { x: 0.4, y: 0.5, visibility: 1 },
        left_knee: { x: 0.4, y: 0.7, visibility: 1 },
        left_ankle: { x: 0.4, y: 0.9, visibility: 1 },
      },
    })),
    dispose: vi.fn(),
  }),
}))

import { NewAssessmentWizard } from './NewAssessmentWizard'

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
    legalDocumentState.enabledCalls = []
    legalDocumentState.value = { document: {}, isLoading: false, error: null }
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
    vi.useRealTimers()
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

  it('does not load the client directory or enable the legal notice before search or selection', async () => {
    const fetchMock = vi.mocked(fetch)
    render(<NewAssessmentWizard />)

    expect(screen.getByText(/Search by first or last name to select a client/)).toBeTruthy()
    expect(legalDocumentState.enabledCalls[0]).toBe(false)
    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/clients?limit=50')).toBe(false)
    expect(legalDocumentState.enabledCalls).toContain(true)
  })

  it('keeps capture disabled until the required screening notice is ready', async () => {
    legalDocumentState.value = { document: null, isLoading: true, error: null }
    const view = render(<NewAssessmentWizard />)

    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    expect(screen.getByText('Loading required screening notice…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next: Upload Views' }) as HTMLButtonElement).disabled).toBe(true)

    legalDocumentState.value = { document: {}, isLoading: false, error: null }
    view.rerender(<NewAssessmentWizard />)

    expect((screen.getByRole('button', { name: 'Next: Upload Views' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps capture disabled and exposes an alert when the screening notice fails', async () => {
    legalDocumentState.value = { document: null, isLoading: false, error: 'Required notice unavailable.' }
    render(<NewAssessmentWizard />)

    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    expect(screen.getByRole('alert').textContent).toContain('Required notice unavailable.')
    expect((screen.getByRole('button', { name: 'Next: Upload Views' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refetches the same settled query after input invalidates its in-flight request', async () => {
    let pageSearchCount = 0
    let firstSearchAborted = false
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      }
      if (url.includes('search=Page')) {
        pageSearchCount += 1
        if (pageSearchCount === 1) {
          init?.signal?.addEventListener('abort', () => { firstSearchAborted = true }, { once: true })
          return new Promise<Response>(() => {})
        }
        return Promise.resolve(new Response(JSON.stringify({
          clients: [pageClient], pagination: { has_more: false, next_cursor: null },
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [], pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewAssessmentWizard />)
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Page' } })
    await waitFor(() => expect(pageSearchCount).toBe(1))

    fireEvent.change(search, { target: { value: 'Page O' } })
    expect(firstSearchAborted).toBe(true)
    fireEvent.change(search, { target: { value: 'Page' } })

    await screen.findByText('Page One')
    expect(pageSearchCount).toBe(2)
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Page' } })
    await screen.findByText('Page One')
    fireEvent.click(screen.getByRole('button', { name: 'Load more clients' }))
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Another' } })

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('search=Another'))).toBe(true))
    await screen.findByText('Another One')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Load more clients' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('clears denied consent progress under StrictMode while locking duplicate checks', async () => {
    let resolveConsent!: (response: Response) => void
    const consentResponse = new Promise<Response>((resolve) => { resolveConsent = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      }
      if (url.startsWith('/api/consent?')) return consentResponse
      return Promise.resolve(new Response(JSON.stringify({
        clients: [pageClient], pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StrictMode>
        <NewAssessmentWizard />
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    const next = screen.getByRole('button', { name: 'Next: Upload Views' })
    expect((next as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(next)
    fireEvent.click(next)

    expect(screen.getByRole('button', { name: 'Checking consent…' })).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/consent?'))).toHaveLength(0)
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/consent?'))).toHaveLength(1)
    })

    await act(async () => {
      resolveConsent(new Response(JSON.stringify({ captureAllowed: false, reason: 'Consent required.' }), { status: 200 }))
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Next: Upload Views' })).toBeTruthy()
  })

  it('does not apply an allowed consent response after the selected client changes', async () => {
    let resolveConsent!: (response: Response) => void
    const consentResponse = new Promise<Response>((resolve) => { resolveConsent = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      }
      if (url.startsWith('/api/consent?')) return consentResponse
      return Promise.resolve(new Response(JSON.stringify({
        clients: [pageClient], pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewAssessmentWizard />)
    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    const next = screen.getByRole('button', { name: 'Next: Upload Views' })
    expect((next as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(next)
    expect(screen.getByRole('button', { name: 'Checking consent…' })).toBeTruthy()
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/consent?'))).toHaveLength(1)
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Page' } })
    await screen.findByText('Page One')
    fireEvent.click(screen.getByRole('button', { name: /Page One/ }))
    expect(screen.getByTestId('selected-client-summary').textContent).toContain('Page One')
    expect((screen.getByRole('button', { name: 'Next: Upload Views' }) as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      resolveConsent(new Response(JSON.stringify({ captureAllowed: true }), { status: 200 }))
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'Step 1: Select Client' })).toBeTruthy()
    expect(screen.getByTestId('selected-client-summary').textContent).toContain('Page One')
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/consent?'))).toHaveLength(1)
  })

  it('does not let a late deep-link preselection replace a manually captured subject', async () => {
    let resolveDeepLink!: (response: Response) => void
    const deepLinkResponse = new Promise<Response>((resolve) => { resolveDeepLink = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/api/clients/${deepClient.id}`) return deepLinkResponse
      if (url === `/api/consent?client_id=${pageClient.id}`) {
        return Promise.resolve(new Response(JSON.stringify({ captureAllowed: true }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [pageClient], pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewAssessmentWizard />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Page' } })
    fireEvent.click(await screen.findByRole('button', { name: /Page One/ }))
    expect(screen.getByTestId('selected-client-summary').textContent).toContain('Page One')

    fireEvent.click(screen.getByRole('button', { name: 'Next: Upload Views' }))
    await screen.findByTestId('capture-step')
    fireEvent.click(screen.getByRole('button', { name: 'Record front fixture' }))
    expect(screen.getByTestId('front-capture').textContent).toBe('fixture:manual-front')
    await waitFor(() => expect(screen.getByTestId('front-capture-status').textContent).toBe('ok'))

    await act(async () => {
      resolveDeepLink(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      await Promise.resolve()
    })

    expect(screen.getByTestId('front-capture').textContent).toBe('fixture:manual-front')
    fireEvent.click(screen.getByRole('button', { name: 'Exit capture' }))
    expect(screen.getByTestId('selected-client-summary').textContent).toContain('Page One')
  })

  it('restores the settled search after leaving capture without starting another request', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      }
      if (url.startsWith(`/api/consent?client_id=${pageClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ captureAllowed: true }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [pageClient], pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<NewAssessmentWizard />)
    const search = screen.getByRole('textbox', { name: 'Search clients by name' })
    fireEvent.change(search, { target: { value: 'Page' } })
    await screen.findByText('Page One')
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('search=Page'))).toBe(true))
    const searchRequestCount = fetchMock.mock.calls.filter(([input]) => String(input).includes('search=Page')).length

    fireEvent.click(screen.getByRole('button', { name: /Page One/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next: Upload Views' }))
    await screen.findByTestId('capture-step')
    fireEvent.click(screen.getByRole('button', { name: 'Exit capture' }))

    expect((screen.getByRole('textbox', { name: 'Search clients by name' }) as HTMLInputElement).value).toBe('Page')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Page' } })
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('search=Page'))).toHaveLength(searchRequestCount)
    expect(screen.queryByText('Loading clients...')).toBeNull()
  })

  it('refetches a settled search that capture aborted before returning to selection', async () => {
    let pageSearchCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/clients/${deepClient.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ client: deepClient }), { status: 200 }))
      }
      if (url === `/api/consent?client_id=${deepClient.id}`) {
        return Promise.resolve(new Response(JSON.stringify({ captureAllowed: true }), { status: 200 }))
      }
      if (url.includes('search=Page')) {
        pageSearchCount += 1
        if (pageSearchCount === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          })
        }
        return Promise.resolve(new Response(JSON.stringify({
          clients: [pageClient], pagination: { has_more: false, next_cursor: null },
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        clients: [], pagination: { has_more: false, next_cursor: null },
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewAssessmentWizard />)
    await waitFor(() => expect(screen.getByTestId('selected-client-summary').textContent).toContain('Deep Linked'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clients by name' }), { target: { value: 'Page' } })
    await waitFor(() => expect(pageSearchCount).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Next: Upload Views' }))
    await screen.findByTestId('capture-step')
    fireEvent.click(screen.getByRole('button', { name: 'Exit capture' }))

    await screen.findByText('Page One')
    expect(pageSearchCount).toBe(2)
    expect((screen.getByRole('textbox', { name: 'Search clients by name' }) as HTMLInputElement).value).toBe('Page')
  })
})
