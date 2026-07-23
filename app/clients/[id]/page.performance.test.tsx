// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => {
  const router = { push: vi.fn() }
  return {
    useParams: () => ({ id: 'client-1' }),
    useRouter: () => router,
  }
})
vi.mock('next/dynamic', () => ({
  default: () => function ProgressChartsStub() {
    return <div data-testid="progress-charts">Progress charts loaded</div>
  },
}))
vi.mock('./ComparisonWorkspace', () => ({
  default: () => <div data-testid="comparison-workspace">Comparison loaded</div>,
}))
vi.mock('@/components/InPersonConsentForm', () => ({ default: () => null }))
vi.mock('@/components/RemoteConsentButton', () => ({ default: () => null }))
vi.mock('@/components/PrivacyLifecycleControls', () => ({ default: () => null }))

import ClientDetailPage from './page'

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
  vi.useRealTimers()
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
  })

  it('paints tab feedback before building the expensive workspace', async () => {
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
    vi.useFakeTimers()
    act(() => fireEvent.click(progress))

    expect(screen.getByRole('tabpanel', { name: 'Progress' })).toBeTruthy()
    expect(screen.getByText('Preparing progress charts…')).toBeTruthy()
    expect(screen.queryByTestId('progress-charts')).toBeNull()

    act(() => vi.advanceTimersByTime(249))
    expect(screen.queryByTestId('progress-charts')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('progress-charts')).toBeTruthy()

    act(() => fireEvent.click(progress))
    expect(screen.getByTestId('progress-charts')).toBeTruthy()
    expect(screen.queryByText('Preparing progress charts…')).toBeNull()
  })
})
