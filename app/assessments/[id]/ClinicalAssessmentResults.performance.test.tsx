// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ router: { push: vi.fn() } }))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/assessments/test-assessment-id',
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('./PriorityProgram', () => ({ default: () => null }))
vi.mock('./ReviewDock', () => ({
  default: ({
    comparisonId,
    comparisonOptions,
    hasMoreComparisonOptions,
    isLoadingMoreComparisonOptions,
    onComparisonChange,
    onLoadMoreComparisonOptions,
  }: {
    comparisonId: string
    comparisonOptions: Array<{ id: string }>
    hasMoreComparisonOptions: boolean
    isLoadingMoreComparisonOptions: boolean
    onComparisonChange: (id: string) => void
    onLoadMoreComparisonOptions: () => void
  }) => (
    <div
      data-testid="review-dock"
      data-comparison-id={comparisonId}
      data-comparison-count={comparisonOptions.length}
      data-comparison-ids={comparisonOptions.map((option) => option.id).join(',')}
      data-loading-more={isLoadingMoreComparisonOptions ? 'true' : 'false'}
    >
      {comparisonOptions.length > 0 && (
        <button type="button" onClick={() => onComparisonChange(comparisonOptions[0].id)}>
          Select first comparison
        </button>
      )}
      {hasMoreComparisonOptions && (
        <button type="button" onClick={onLoadMoreComparisonOptions}>Load older report options</button>
      )}
    </div>
  ),
}))
vi.mock('./MuscleBodyMap', () => ({ default: () => null }))
vi.mock('./MuscleModel3D', () => ({ default: () => <h2 id="anatomy-viewer-title">Posture map</h2> }))
vi.mock('@/components/LegalNotice', () => ({ default: () => null }))

import ClinicalAssessmentResults from './ClinicalAssessmentResults'
import type { AssessmentResultsPayload } from './loadAssessmentResults'

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

// The report dock loads when its "Report, share & compare" disclosure first opens.
async function openReportDock() {
  const summary = screen.getByText('Report, share & compare')
  if (!summary.closest('details')?.open) fireEvent.click(summary)
  return screen.findByTestId('review-dock')
}

function assessmentResponseData({
  id = 'assessment-1',
  clientId = 'client-1',
  assessedAt = '2026-07-02T00:00:00.000Z',
}: {
  id?: string
  clientId?: string
  assessedAt?: string
} = {}): AssessmentResultsPayload {
  return {
    assessment: {
      id,
      status: 'complete',
      overall_score: 12,
      overall_grade: 'A' as const,
      scoring_engine_version: '2.1.0',
      tilt_corrected: false,
      level_verified: true,
      capture_stability: 0.98,
      assessed_at: assessedAt,
      priority_keys: [],
      capability: 'standard',
      exercise_swaps: {},
      practitioner_approved: false,
      practitioner_approved_at: null,
      notes: null,
      clients: { id: clientId, first_name: 'Ada', last_name: 'Lovelace' },
    },
    findings: [],
    captures: [],
    screening_context: {
      version: 'screening-context-v1' as const,
      scanUse: 'descriptive' as const,
      scanAllowsGeneralTraining: true as const,
      reasonCodes: [],
      context: null,
    },
    clinical_content: {
      enabled: true,
      surfaces: { recommendations: true, programs: true, workouts: true, knowledgeLinks: true },
      mode: 'test_fixture',
      version: 'test',
      projection: {
        program: {
          hasPlan: false,
          priorities: [],
          monitored: [],
          eligibleOrder: [],
          positives: [],
          screeningSummary: 'No corrective priorities.',
          oneMoreToWatch: null,
          capability: 'standard',
        },
        exercises: [],
        sessionPreview: null,
      },
    },
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('assessment results progressive rendering', () => {
  it('renders the posture map as the page hero, ahead of the tabs, for the viewer deep link', async () => {
    window.history.replaceState(null, '', '#anatomy-viewer-title')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) {
        return response({ assessments: [], pagination: { has_more: false, next_cursor: null } })
      }
      if (url === '/api/workouts?assessment_id=assessment-1') return response({ runs: [] })
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const data = assessmentResponseData()
    data.findings = [{
      id: 'finding-1',
      imbalance_key: 'forward_head',
      region: 'head_shoulders',
      label: 'Head position',
      zone: 'warning',
      deviation: 4,
      severity_pct: 20,
      confidence: 0.9,
      direction: 'forward',
      view_used: 'side',
      uncertainty_deg: 1,
    }]
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: typeof data
    }>

    render(<ComponentWithInitialData
      params={Promise.resolve({ id: 'assessment-1' })}
      initialAssessmentId="assessment-1"
      initialData={data}
    />)

    // The map is the page's own hero (the browser's native anchor scroll lands on it); the tabs
    // under it are Findings (open on arrival, renamed from "Evidence") and Program.
    const hero = await screen.findByRole('heading', { name: 'Posture map' })
    expect(hero.id).toBe('anatomy-viewer-title')
    expect(screen.getByRole('tab', { name: 'Findings' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('tab', { name: /^Evidence/ })).toBeNull()
    const tabs = screen.getByRole('tablist')
    expect(hero.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('states when an incompatible scan cannot drive the corrective report or program', () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) {
        return response({ assessments: [], pagination: { has_more: false, next_cursor: null } })
      }
      if (url === '/api/workouts?assessment_id=assessment-1') return response({ runs: [] })
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const data = assessmentResponseData()
    data.screening_context = {
      version: 'screening-context-v1',
      scanUse: 'incompatible',
      scanAllowsGeneralTraining: true,
      reasonCodes: ['unsupported_engine_version:0.9.0'],
      context: null,
    }
    data.assessment.overall_score = null
    data.assessment.overall_grade = null
    data.clinical_content.projection = null
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: typeof data
    }>

    render(<ComponentWithInitialData
      params={Promise.resolve({ id: 'assessment-1' })}
      initialAssessmentId="assessment-1"
      initialData={data}
    />)

    expect(screen.getByRole('heading', { level: 1, name: 'No current grade is available.' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/unsupported engine version.*cannot drive/i)
    expect(screen.queryByRole('heading', { name: /^Grade / })).toBeNull()
  })

  it('paints the primary review before optional comparison history finishes', async () => {
    const priorHistory = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/assessments/assessment-1') {
        return Promise.resolve(response(assessmentResponseData()))
      }
      if (url.startsWith('/api/clients/client-1/assessments?')) return priorHistory.promise
      if (url === '/api/workouts?assessment_id=assessment-1') return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))

    render(<ClinicalAssessmentResults params={Promise.resolve({ id: 'assessment-1' })} />)

    expect(await screen.findByRole('heading', { level: 1, name: /^Grade / })).toBeTruthy()
    expect(screen.queryByText('Loading results...')).toBeNull()
    await openReportDock()
    expect(screen.getByTestId('review-dock').getAttribute('data-comparison-count')).toBe('0')

    priorHistory.resolve(response({
      assessments: [{
        id: 'assessment-0',
        assessed_at: '2026-07-01T00:00:00.000Z',
        overall_grade: 'B',
        scoring_engine_version: '2.1.0',
      }],
      pagination: { has_more: false, next_cursor: null },
    }))

    await waitFor(() => {
      expect(screen.getByTestId('review-dock').getAttribute('data-comparison-count')).toBe('1')
    })
  })

  it('renders server-provided report data without refetching the primary assessment', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) {
        return Promise.resolve(response({
          assessments: [],
          pagination: { has_more: false, next_cursor: null },
        }))
      }
      if (url === '/api/workouts?assessment_id=assessment-1') return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: ReturnType<typeof assessmentResponseData>
    }>

    render(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-1' })}
        initialAssessmentId="assessment-1"
        initialData={assessmentResponseData()}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: /^Grade / })).toBeTruthy()
    // Accuracy lives in the Evidence panel's own Disclosure, which mounts
    // just after first paint and is collapsed by default.
    fireEvent.click(await screen.findByRole('button', { name: /^Accuracy & methodology/ }))
    expect(await screen.findByText('Within-burst landmark consistency 98%')).toBeTruthy()
    // No disclaimer copy on the page: practitioners accept the screening notice at onboarding.
    expect(screen.queryByText(/clinical accuracy are not established/)).toBeNull()
    expect(screen.queryByText(/Capture stability/)).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain('/api/assessments/assessment-1')
  })

  it('keeps the primary report painted when optional comparison history rejects', async () => {
    const priorHistory = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) return priorHistory.promise
      if (url === '/api/workouts?assessment_id=assessment-1') return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: ReturnType<typeof assessmentResponseData>
    }>

    render(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-1' })}
        initialAssessmentId="assessment-1"
        initialData={assessmentResponseData()}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: /^Grade / })).toBeTruthy()

    priorHistory.reject(new Error('comparison history unavailable'))

    expect(await screen.findByText('Some report options could not load (prior assessments). Refresh to try again.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: /^Grade / })).toBeTruthy()
    expect(screen.queryByText('Failed to load assessment.')).toBeNull()
  })

  it('discards a stale comparison-history rejection after navigating to another assessment', async () => {
    const stalePriorHistory = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) return stalePriorHistory.promise
      if (url.startsWith('/api/clients/client-2/assessments?')) {
        return Promise.resolve(response({
          assessments: [],
          pagination: { has_more: false, next_cursor: null },
        }))
      }
      if (url.startsWith('/api/workouts?assessment_id=')) return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: ReturnType<typeof assessmentResponseData>
    }>
    const { rerender } = render(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-1' })}
        initialAssessmentId="assessment-1"
        initialData={assessmentResponseData()}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: /^Grade / })).toBeTruthy()
    await openReportDock()

    rerender(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-2' })}
        initialAssessmentId="assessment-2"
        initialData={assessmentResponseData({
          id: 'assessment-2',
          clientId: 'client-2',
          assessedAt: '2026-07-03T00:00:00.000Z',
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('review-dock').getAttribute('data-comparison-count')).toBe('0')
    })

    await act(async () => {
      stalePriorHistory.reject(new Error('stale comparison history failure'))
      await stalePriorHistory.promise.catch(() => {})
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { level: 1, name: /^Grade / })).toBeTruthy()
    expect(screen.queryByText('Some report options could not load (prior assessments). Refresh to try again.')).toBeNull()
    expect(screen.queryByText('Failed to load assessment.')).toBeNull()
  })

  it('clears old comparison state before a new assessment history request rejects', async () => {
    const newAssessmentHistory = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
        if (cursor === 'cursor-1') return Promise.resolve(response({}, 500))
        return Promise.resolve(response({
          assessments: [{
            id: 'assessment-0',
            assessed_at: '2026-07-01T00:00:00.000Z',
            overall_grade: 'B',
            scoring_engine_version: '2.1.0',
          }],
          pagination: { has_more: true, next_cursor: 'cursor-1' },
        }))
      }
      if (url.startsWith('/api/clients/client-2/assessments?')) return newAssessmentHistory.promise
      if (url.startsWith('/api/workouts?assessment_id=')) return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: ReturnType<typeof assessmentResponseData>
    }>
    const { rerender } = render(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-1' })}
        initialAssessmentId="assessment-1"
        initialData={assessmentResponseData()}
      />,
    )
    await openReportDock()
    await screen.findByRole('button', { name: 'Select first comparison' })
    fireEvent.click(screen.getByRole('button', { name: 'Select first comparison' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load older report options' }))
    expect(await screen.findByText('Some older report options could not load. Try again.')).toBeTruthy()
    expect(screen.getByTestId('review-dock').getAttribute('data-comparison-id')).toBe('assessment-0')

    rerender(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-2' })}
        initialAssessmentId="assessment-2"
        initialData={assessmentResponseData({
          id: 'assessment-2',
          clientId: 'client-2',
          assessedAt: '2026-07-03T00:00:00.000Z',
        })}
      />,
    )

    await waitFor(() => {
      const dock = screen.getByTestId('review-dock')
      expect(dock.getAttribute('data-comparison-count')).toBe('0')
      expect(dock.getAttribute('data-comparison-id')).toBe('')
      expect(dock.getAttribute('data-loading-more')).toBe('false')
      expect(screen.queryByText('Some older report options could not load. Try again.')).toBeNull()
    })

    await act(async () => {
      newAssessmentHistory.reject(new Error('new assessment history unavailable'))
      await newAssessmentHistory.promise.catch(() => {})
      await Promise.resolve()
    })

    expect(screen.getByText('Some report options could not load (prior assessments). Refresh to try again.')).toBeTruthy()
    expect(screen.queryByText('Some older report options could not load. Try again.')).toBeNull()
    expect(screen.getByTestId('review-dock').getAttribute('data-comparison-count')).toBe('0')
    expect(screen.getByTestId('review-dock').getAttribute('data-comparison-id')).toBe('')
  })

  it('continues cursor pagination while merging and deduplicating prior assessments', async () => {
    const requestedCursors: Array<string | null> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
        requestedCursors.push(cursor)
        if (cursor === null) {
          return Promise.resolve(response({
            assessments: [{
              id: 'assessment-0',
              assessed_at: '2026-07-01T00:00:00.000Z',
              overall_grade: 'B',
              scoring_engine_version: '2.1.0',
            }],
            pagination: { has_more: true, next_cursor: 'cursor-1' },
          }))
        }
        if (cursor === 'cursor-1') {
          return Promise.resolve(response({
            assessments: [
              {
                id: 'assessment-0',
                assessed_at: '2026-07-01T00:00:00.000Z',
                overall_grade: 'B',
                scoring_engine_version: '2.1.0',
              },
              {
                id: 'assessment-minus-1',
                assessed_at: '2026-06-30T00:00:00.000Z',
                overall_grade: 'C',
                scoring_engine_version: '2.1.0',
              },
            ],
            pagination: { has_more: true, next_cursor: 'cursor-2' },
          }))
        }
        if (cursor === 'cursor-2') {
          return Promise.resolve(response({
            assessments: [{
              id: 'assessment-minus-2',
              assessed_at: '2026-06-29T00:00:00.000Z',
              overall_grade: 'D',
              scoring_engine_version: '2.1.0',
            }],
            pagination: { has_more: false, next_cursor: null },
          }))
        }
      }
      if (url === '/api/workouts?assessment_id=assessment-1') return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: ReturnType<typeof assessmentResponseData>
    }>

    render(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-1' })}
        initialAssessmentId="assessment-1"
        initialData={assessmentResponseData()}
      />,
    )
    await openReportDock()
    await waitFor(() => {
      expect(screen.getByTestId('review-dock').getAttribute('data-comparison-count')).toBe('1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load older report options' }))
    await waitFor(() => {
      expect(screen.getByTestId('review-dock').getAttribute('data-comparison-ids'))
        .toBe('assessment-minus-1,assessment-0')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load older report options' }))
    await waitFor(() => {
      expect(screen.getByTestId('review-dock').getAttribute('data-comparison-ids'))
        .toBe('assessment-minus-2,assessment-minus-1,assessment-0')
    })

    expect(requestedCursors).toEqual([null, 'cursor-1', 'cursor-2'])
    expect(screen.queryByRole('button', { name: 'Load older report options' })).toBeNull()
  })

  it('discards a stale load-more response after navigating to another assessment', async () => {
    const staleLoadMore = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/clients/client-1/assessments?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
        if (cursor === 'cursor-1') return staleLoadMore.promise
        return Promise.resolve(response({
          assessments: [{
            id: 'assessment-0',
            assessed_at: '2026-07-01T00:00:00.000Z',
            overall_grade: 'B',
            scoring_engine_version: '2.1.0',
          }],
          pagination: { has_more: true, next_cursor: 'cursor-1' },
        }))
      }
      if (url.startsWith('/api/clients/client-2/assessments?')) {
        return Promise.resolve(response({
          assessments: [],
          pagination: { has_more: false, next_cursor: null },
        }))
      }
      if (url.startsWith('/api/workouts?assessment_id=')) return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))
    const ComponentWithInitialData = ClinicalAssessmentResults as unknown as React.ComponentType<{
      params: Promise<{ id: string }>
      initialAssessmentId: string
      initialData: ReturnType<typeof assessmentResponseData>
    }>
    const { rerender } = render(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-1' })}
        initialAssessmentId="assessment-1"
        initialData={assessmentResponseData()}
      />,
    )
    await openReportDock()
    await screen.findByRole('button', { name: 'Load older report options' })
    fireEvent.click(screen.getByRole('button', { name: 'Load older report options' }))

    rerender(
      <ComponentWithInitialData
        params={Promise.resolve({ id: 'assessment-2' })}
        initialAssessmentId="assessment-2"
        initialData={assessmentResponseData({
          id: 'assessment-2',
          clientId: 'client-2',
          assessedAt: '2026-07-03T00:00:00.000Z',
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('review-dock').getAttribute('data-comparison-count')).toBe('0')
    })

    await act(async () => {
      staleLoadMore.resolve(response({
        assessments: [{
          id: 'stale-assessment',
          assessed_at: '2026-06-28T00:00:00.000Z',
          overall_grade: 'E',
          scoring_engine_version: '2.1.0',
        }],
        pagination: { has_more: false, next_cursor: null },
      }))
      await staleLoadMore.promise
      await Promise.resolve()
    })

    expect(screen.getByTestId('review-dock').getAttribute('data-comparison-ids')).toBe('')
  })
})
