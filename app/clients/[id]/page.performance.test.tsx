// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const workspaceRenders = vi.hoisted(() => ({
  findings: vi.fn(),
  comparison: vi.fn(),
  privacy: vi.fn(),
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
// The findings panel is no longer behind next/dynamic: dropping recharts removed
// the only chunk worth deferring, so the panel is plain SVG built from the
// history already in memory. It is still stubbed here to count its renders.
vi.mock('./FindingsTrend', () => ({
  default: () => {
    workspaceRenders.findings()
    return <div data-testid="findings-trend">Findings trend loaded</div>
  },
}))
vi.mock('./ComparisonWorkspace', () => ({
  default: () => {
    workspaceRenders.comparison()
    return <div data-testid="comparison-workspace">Comparison loaded</div>
  },
}))
vi.mock('@/components/InPersonConsentForm', () => ({
  default: () => <form aria-label="Record in-person consent" />,
}))
vi.mock('@/components/RemoteConsentButton', () => ({ default: () => null }))
vi.mock('@/components/PrivacyLifecycleControls', () => ({
  default: () => {
    workspaceRenders.privacy()
    return <div data-testid="privacy-lifecycle-controls">Privacy controls loaded</div>
  },
}))

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

/** Every scan row carries its deviation readout, so this counts history rows. */
function historyRows() {
  return screen.queryAllByRole('link', { name: /Deviation/ })
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

function seededInitialData() {
  return {
    client: {
      id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
      sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
      consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
    },
    assessments,
    consentStatus: 'valid' as const,
    pagination: {
      has_more: false,
      next_cursor: null,
      snapshot_at: '2026-07-03T00:00:00.000Z',
    },
  }
}

afterEach(() => {
  cleanup()
  navigation.id = 'client-1'
  navigation.router.push.mockReset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('client detail progressive rendering', () => {
  it('defers hidden privacy lifecycle work until the Details tab is presented', () => {
    workspaceRenders.privacy.mockClear()
    vi.useFakeTimers()

    render(
      <ClientDetailPage
        initialData={seededInitialData()}
      />,
    )

    expect(workspaceRenders.privacy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByRole('heading', { name: 'Client Information' })).toBeTruthy()
    const privacyStatus = screen.getByTestId('privacy-workspace-status')
    expect(privacyStatus.getAttribute('aria-live')).toBe('polite')
    expect(privacyStatus.getAttribute('aria-atomic')).toBe('true')
    expect(privacyStatus.textContent).toBe('Preparing privacy controls…')
    expect(workspaceRenders.privacy).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(299))
    expect(workspaceRenders.privacy).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))

    expect(screen.getByTestId('privacy-lifecycle-controls')).toBeTruthy()
    expect(privacyStatus.textContent).toBe('Privacy controls ready.')
    expect(workspaceRenders.privacy).toHaveBeenCalledTimes(1)
  })

  it('cancels deferred privacy work when the practitioner leaves Details', () => {
    workspaceRenders.privacy.mockClear()
    vi.useFakeTimers()
    render(<ClientDetailPage initialData={seededInitialData()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    const privacyStatus = screen.getByTestId('privacy-workspace-status')
    expect(privacyStatus.textContent).toBe('Preparing privacy controls…')
    fireEvent.click(screen.getByRole('tab', { name: 'Findings' }))
    act(() => vi.advanceTimersByTime(300))

    expect(privacyStatus.textContent).toBe('')
    expect(workspaceRenders.privacy).not.toHaveBeenCalled()
  })

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

    // Compare only exists once a second scan is known, so its tab appearing is
    // the signal that history landed after the record had already painted.
    expect(await screen.findByRole('tab', { name: 'Compare' })).toBeTruthy()
    expect(paintedBeforeSecondaryData).toBe(true)
    expect(vi.mocked(fetch).mock.calls.some(([input]) => (
      String(input) === '/api/clients/client-1/assessments?include_findings=true&limit=20'
    ))).toBe(true)
  })

  it('presents lightweight tabs before mounting and retaining expensive workspaces', async () => {
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

    const forcedLayoutSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const dateFormattingSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')
    render(<ClientDetailPage />)
    const compareTab = await screen.findByRole('tab', { name: 'Compare' })
    const findingsPanel = document.getElementById('client-panel-findings')!
    const comparePanel = document.getElementById('client-panel-compare')!
    // Hidden panels are hidden by class, never by aria-hidden, inert, or hidden:
    // the tab strip already tells assistive technology which panel is current,
    // and the other three attributes would each fight it differently.
    expect(findingsPanel.getAttribute('aria-hidden')).toBeNull()
    expect(comparePanel.getAttribute('aria-hidden')).toBeNull()
    expect(findingsPanel.hasAttribute('inert')).toBe(false)
    expect(comparePanel.hasAttribute('inert')).toBe(false)
    expect(comparePanel.hasAttribute('hidden')).toBe(false)
    expect(findingsPanel.className).toContain('workspacePanelActive')
    expect(comparePanel.className).not.toContain('workspacePanelActive')
    const dateFormattingCount = dateFormattingSpy.mock.calls.length
    vi.useFakeTimers()
    expect(screen.queryByTestId('comparison-workspace')).toBeNull()

    act(() => fireEvent.click(compareTab))

    expect(screen.getByRole('tabpanel', { name: 'Compare' })).toBeTruthy()
    expect(findingsPanel.getAttribute('aria-hidden')).toBeNull()
    expect(comparePanel.getAttribute('aria-hidden')).toBeNull()
    expect(findingsPanel.hasAttribute('inert')).toBe(false)
    expect(comparePanel.hasAttribute('inert')).toBe(false)
    expect(findingsPanel.className).not.toContain('workspacePanelActive')
    expect(comparePanel.className).toContain('workspacePanelActive')
    expect(findingsPanel.tabIndex).toBe(-1)
    expect(comparePanel.tabIndex).toBe(0)
    // Switching panels must not re-project a single date: the trend card and the
    // history rows are above the tab strip and are not part of the switch.
    expect(dateFormattingSpy).toHaveBeenCalledTimes(dateFormattingCount)
    expect(screen.getByRole('status').textContent).toContain('Preparing comparison')
    act(() => vi.advanceTimersByTime(299))
    expect(screen.queryByTestId('comparison-workspace')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    const comparison = screen.getByTestId('comparison-workspace')
    const comparisonRenderCount = workspaceRenders.comparison.mock.calls.length
    const findings = screen.getByTestId('findings-trend')
    const findingsRenderCount = workspaceRenders.findings.mock.calls.length

    // Both panels stay mounted, so returning to one costs no work.
    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Findings' })))
    expect(screen.getByTestId('findings-trend')).toBe(findings)
    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Compare' })))
    expect(screen.getByTestId('comparison-workspace')).toBe(comparison)
    expect(workspaceRenders.findings).toHaveBeenCalledTimes(findingsRenderCount)
    expect(workspaceRenders.comparison).toHaveBeenCalledTimes(comparisonRenderCount)
    expect(forcedLayoutSpy).not.toHaveBeenCalled()
  })

  it('cancels an abandoned deferred workspace when tabs change quickly', async () => {
    workspaceRenders.comparison.mockClear()
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
    const compareTab = await screen.findByRole('tab', { name: 'Compare' })
    vi.useFakeTimers()
    act(() => fireEvent.click(compareTab))
    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Details' })))
    act(() => vi.advanceTimersByTime(300))

    expect(screen.queryByTestId('comparison-workspace')).toBeNull()
    expect(workspaceRenders.comparison).not.toHaveBeenCalled()
    expect(screen.getByTestId('privacy-lifecycle-controls')).toBeTruthy()
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
          consentStatus: 'valid',
          pagination: {
            has_more: false,
            next_cursor: null,
            snapshot_at: '2026-07-03T00:00:00.000Z',
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Compare' })).toBeTruthy()
    // Both offsets fall on the following UTC day; the row labels must name the
    // stored day, not the viewer's. Scoped to the rows because the trend card's
    // numeric table restates every date.
    const rowText = historyRows().map(row => row.textContent).join(' | ')
    expect(rowText).toContain('2 Jul 2026')
    expect(rowText).toContain('3 Jul 2026')
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
  })

  it('fails closed when server-seeded consent status is unavailable', () => {
    render(
      <ClientDetailPage
        initialData={{
          client: {
            id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
            sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
            consent_recorded_at: null, created_at: '2026-06-01T00:00:00.000Z',
          },
          assessments: [],
          consentStatus: 'unavailable',
          pagination: {
            has_more: false,
            next_cursor: null,
            snapshot_at: '2026-07-03T00:00:00.000Z',
          },
        }}
      />,
    )

    // Stated on the identity line and again in the Details panel's fact grid.
    expect(screen.getAllByText(/Consent status unavailable/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    const detailsPanel = document.getElementById('client-panel-details')!
    expect(detailsPanel.className).toContain('workspacePanelActive')
    expect(detailsPanel.textContent).toContain('Consent status unavailable')
    // An unknown consent state must never offer the in-person consent form.
    expect(screen.queryByRole('form', { name: 'Record in-person consent' })).toBeNull()
  })

  it('keeps the scan action available without consent controls in prototype operation', () => {
    const initialData = {
      ...seededInitialData(),
      operationMode: 'prototype' as const,
      consentStatus: 'not_required' as const,
    }
    render(<ClientDetailPage initialData={initialData} />)

    expect(screen.getByRole('link', { name: /New scan/i }).getAttribute('href'))
      .toBe('/assessments/new?client_id=client-1')
    expect(screen.getByText('Prototype operation')).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Record in-person consent' })).toBeNull()
    expect(screen.queryByText(/Consent active|Consent not recorded|New consent required/)).toBeNull()
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

    // assessment-2 arrives again with a revised grade; the merge must replace it
    // rather than append a second row for the same scan.
    await waitFor(() => expect(historyRows()).toHaveLength(3))
    expect(historyRows()[0].textContent).toContain('Deviation 5 / 100')
    expect(screen.getByText(/3\+ scans/)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes('include_findings=true&limit=50&cursor=cursor-one')
    ))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Load older assessments' }))

    await waitFor(() => expect(historyRows()).toHaveLength(4))
    expect(screen.getByText(/4 scans/)).toBeTruthy()
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
    expect(await screen.findByRole('tab', { name: 'Compare' })).toBeTruthy()
    expect(screen.getByText(/2\+ scans/)).toBeTruthy()

    navigation.id = 'client-2'
    view.rerender(<ClientDetailPage />)

    expect(screen.queryByRole('heading', { name: 'Ada Lovelace' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Loading client record')

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
    expect(screen.queryByRole('tab', { name: 'Compare' })).toBeNull()
    expect(screen.queryByTestId('comparison-workspace')).toBeNull()
    expect(screen.queryByText(/2\+ scans/)).toBeNull()
    expect(historyRows()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toContain('Loading assessment history')

    await act(async () => {
      replacementHistory.resolve(response({ error: 'unavailable' }, 503))
      await Promise.resolve()
    })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load the assessment history for this client.',
    )
    expect(screen.queryByRole('tab', { name: 'Compare' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load older assessments' })).toBeNull()
  })
})
