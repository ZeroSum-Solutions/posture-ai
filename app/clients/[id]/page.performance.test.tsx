// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const workspaceRenders = vi.hoisted(() => ({
  progress: vi.fn(),
  comparison: vi.fn(),
}))

const navigation = vi.hoisted(() => ({
  id: 'client-1',
  router: { push: vi.fn() },
}))

vi.mock('next/navigation', () => {
  return {
    useParams: () => ({ id: navigation.id }),
    useRouter: () => navigation.router,
  }
})
vi.mock('next/dynamic', () => ({
  default: () => function ProgressChartsStub() {
    workspaceRenders.progress()
    return <div data-testid="progress-charts">Progress charts loaded</div>
  },
}))
vi.mock('./ComparisonWorkspace', () => ({
  default: () => {
    workspaceRenders.comparison()
    return <div data-testid="comparison-workspace">Comparison loaded</div>
  },
}))
vi.mock('@/components/InPersonConsentForm', () => ({ default: () => null }))
vi.mock('@/components/RemoteConsentButton', () => ({ default: () => null }))
vi.mock('@/components/PrivacyLifecycleControls', () => ({ default: () => null }))

import ClientDetailPage from './ClientDetailClient'

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const assessments = [
  {
    id: 'assessment-1', assessed_at: '2026-07-01T00:00:00.000Z', overall_grade: 'B',
    overall_score: 18, scoring_engine_version: '2.1.0', status: 'complete', assessment_findings: [],
  },
  {
    id: 'assessment-2', assessed_at: '2026-07-02T00:00:00.000Z', overall_grade: 'A',
    overall_score: 12, scoring_engine_version: '2.1.0', status: 'complete', assessment_findings: [],
  },
]

afterEach(() => {
  cleanup()
  navigation.id = 'client-1'
  navigation.router.push.mockReset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('client detail progressive rendering', () => {
  it('paints the client record before consent and assessment history finish', async () => {
    const consent = deferred<Response>()
    const history = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/client-1') {
        return Promise.resolve(response({
          client: {
            id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
            sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
            consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
          },
        }))
      }
      if (url.startsWith('/api/consent?')) return consent.promise
      if (url.includes('/assessments?')) return history.promise
      throw new Error(`Unexpected URL: ${url}`)
    }))

    render(<ClientDetailPage />)
    let paintedBeforeSecondaryData = false
    window.setTimeout(() => {
      paintedBeforeSecondaryData = screen.queryByRole('heading', { name: 'Ada Lovelace' }) !== null
      consent.resolve(response({ hasConsent: true, legalState: 'current' }))
      history.resolve(response({ assessments, pagination: { has_more: false, next_cursor: null } }))
    }, 50)

    expect(await screen.findByRole('tab', { name: 'Progress' })).toBeTruthy()
    expect(paintedBeforeSecondaryData).toBe(true)
    expect(vi.mocked(fetch).mock.calls.some(([input]) => (
      String(input) === '/api/clients/client-1/assessments?include_findings=true&limit=20'
    ))).toBe(true)
  })

  it('presents a lightweight tab before mounting and retaining expensive workspaces', async () => {
    const frameQueue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameQueue.push(callback)
      return frameQueue.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/client-1') {
        return Promise.resolve(response({
          client: {
            id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
            sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
            consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
          },
        }))
      }
      if (url.startsWith('/api/consent?')) return Promise.resolve(response({ hasConsent: true, legalState: 'current' }))
      if (url.includes('/assessments?')) return Promise.resolve(response({ assessments, pagination: { has_more: false, next_cursor: null } }))
      throw new Error(`Unexpected URL: ${url}`)
    }))

    render(<ClientDetailPage />)
    const progress = await screen.findByRole('tab', { name: 'Progress' })
    expect(screen.queryByTestId('progress-charts')).toBeNull()
    expect(screen.queryByTestId('comparison-workspace')).toBeNull()

    act(() => fireEvent.click(progress))

    expect(screen.getByRole('tabpanel', { name: 'Progress' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Preparing progress charts')
    expect(screen.queryByTestId('progress-charts')).toBeNull()
    act(() => frameQueue.shift()?.(performance.now()))
    expect(screen.queryByTestId('progress-charts')).toBeNull()
    act(() => frameQueue.shift()?.(performance.now()))
    const charts = screen.getByTestId('progress-charts')
    const progressRenderCount = workspaceRenders.progress.mock.calls.length

    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Compare' })))
    expect(screen.getByRole('tabpanel', { name: 'Compare' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Preparing comparison')
    expect(screen.queryByTestId('comparison-workspace')).toBeNull()
    act(() => frameQueue.shift()?.(performance.now()))
    act(() => frameQueue.shift()?.(performance.now()))
    const comparison = screen.getByTestId('comparison-workspace')
    const comparisonRenderCount = workspaceRenders.comparison.mock.calls.length

    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Progress' })))
    expect(screen.getByTestId('progress-charts')).toBe(charts)
    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Compare' })))
    expect(screen.getByTestId('comparison-workspace')).toBe(comparison)
    expect(workspaceRenders.progress).toHaveBeenCalledTimes(progressRenderCount)
    expect(workspaceRenders.comparison).toHaveBeenCalledTimes(comparisonRenderCount)
  })

  it('uses server-seeded identity and history without repeating those requests after hydration', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/consent?')) {
        return Promise.resolve(response({ hasConsent: true, legalState: 'current' }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ClientDetailPage
        initialData={{
          client: {
            id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
            sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
            consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
          },
          assessments: [
            { ...assessments[0], assessed_at: '2026-07-01T23:30:00-07:00' },
            { ...assessments[1], assessed_at: '2026-07-02T23:30:00-07:00' },
          ],
          pagination: {
            has_more: false,
            next_cursor: null,
            snapshot_at: '2026-07-03T00:00:00.000Z',
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Progress' })).toBeTruthy()
    expect(screen.getByText('Assessment — Jul 2, 2026')).toBeTruthy()
    expect(screen.getByText('Assessment — Jul 3, 2026')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/consent?client_id=client-1')
  })

  it('merges older pages by id, advances the cursor, and clears it at the end', async () => {
    const duplicateUpdate = {
      ...assessments[1],
      overall_grade: 'S',
      overall_score: 5,
    }
    const olderAssessment = {
      ...assessments[0],
      id: 'assessment-0',
      assessed_at: '2026-06-30T00:00:00.000Z',
      overall_grade: 'C',
      overall_score: 24,
    }
    const newerAssessment = {
      ...assessments[1],
      id: 'assessment-3',
      assessed_at: '2026-07-03T00:00:00.000Z',
      overall_grade: 'A',
      overall_score: 8,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/client-1') {
        return Promise.resolve(response({
          client: {
            id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
            sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
            consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
          },
        }))
      }
      if (url.startsWith('/api/consent?')) {
        return Promise.resolve(response({ hasConsent: true, legalState: 'current' }))
      }
      if (url.includes('cursor=cursor-one')) {
        return Promise.resolve(response({
          assessments: [olderAssessment, duplicateUpdate],
          pagination: { has_more: true, next_cursor: 'cursor-two' },
        }))
      }
      if (url.includes('cursor=cursor-two')) {
        return Promise.resolve(response({
          assessments: [newerAssessment],
          pagination: { has_more: false, next_cursor: null },
        }))
      }
      if (url.includes('/assessments?')) {
        return Promise.resolve(response({
          assessments,
          pagination: { has_more: true, next_cursor: 'cursor-one' },
        }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ClientDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load older assessments' }))

    await waitFor(() => expect(screen.getAllByText('Grade S')).toHaveLength(2))
    expect(screen.getAllByText(/^Assessment — /)).toHaveLength(3)
    expect(screen.getByText('3+')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes('include_findings=true&limit=50&cursor=cursor-one')
    ))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Load older assessments' }))

    await waitFor(() => expect(screen.getAllByText(/^Assessment — /)).toHaveLength(4))
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load older assessments' })).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes('include_findings=true&limit=50&cursor=cursor-two')
    ))).toBe(true)
  })

  it('clears the previous client while replacement history is pending and after it fails', async () => {
    const replacementClient = deferred<Response>()
    const replacementHistory = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/client-1') {
        return Promise.resolve(response({
          client: {
            id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
            sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
            consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
          },
        }))
      }
      if (url === '/api/clients/client-2') return replacementClient.promise
      if (url === '/api/clients/client-1/assessments?include_findings=true&limit=20') {
        return Promise.resolve(response({ assessments, pagination: { has_more: true, next_cursor: 'client-1-cursor' } }))
      }
      if (url === '/api/clients/client-2/assessments?include_findings=true&limit=20') {
        return replacementHistory.promise
      }
      if (url.startsWith('/api/consent?')) {
        return Promise.resolve(response({ hasConsent: true, legalState: 'current' }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<ClientDetailPage />)
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy()
    expect(await screen.findByRole('tab', { name: 'Progress' })).toBeTruthy()
    expect(screen.getByText('2+')).toBeTruthy()

    navigation.id = 'client-2'
    view.rerender(<ClientDetailPage />)

    expect(screen.queryByRole('heading', { name: 'Ada Lovelace' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Loading client evidence')

    await act(async () => {
      replacementClient.resolve(response({
        client: {
          id: 'client-2', first_name: 'Grace', last_name: 'Hopper', date_of_birth: '1985-01-01',
          sex_at_birth: 'female', height_cm: 168, weight_kg: 62, notes: null,
          consent_recorded_at: '2026-07-02T00:00:00.000Z', created_at: '2026-06-02T00:00:00.000Z',
        },
      }))
      await Promise.resolve()
    })

    expect(await screen.findByRole('heading', { name: 'Grace Hopper' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Progress' })).toBeNull()
    expect(screen.queryByTestId('progress-charts')).toBeNull()
    expect(screen.queryByTestId('comparison-workspace')).toBeNull()
    expect(screen.queryByText('2+')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Loading assessment history')

    await act(async () => {
      replacementHistory.resolve(response({ error: 'unavailable' }, 503))
      await Promise.resolve()
    })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load the assessment history for this client.',
    )
    expect(screen.queryByRole('tab', { name: 'Progress' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load older assessments' })).toBeNull()
  })
})
