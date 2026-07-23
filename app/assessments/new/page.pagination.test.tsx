// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerPush = vi.fn()
const router = { push: routerPush }

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
vi.mock('@/components/useLegalDocument', () => ({ default: () => ({ status: 'ready', document: {}, error: null }) }))
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
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/consent?'))).toHaveLength(1)

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
})
