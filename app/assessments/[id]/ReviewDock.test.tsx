// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ReviewDock, { type ReviewDockProps } from './ReviewDock'

afterEach(cleanup)

function props(overrides: Partial<ReviewDockProps> = {}): ReviewDockProps {
  return {
    clientName: 'Ada Lovelace',
    assessedAtLabel: 'July 15, 2026',
    grade: 'B',
    score: 42,
    reliabilityLabel: 'Camera level verified',
    reliabilityDetail: 'Capture stability 86%',
    unreliableCount: 0,
    isApproved: false,
    saveState: 'idle',
    hasSession: true,
    isApproving: false,
    isLaunching: false,
    onApprove: vi.fn(),
    onLaunch: vi.fn(),
    onRetrySave: vi.fn(),
    pdfLoading: null,
    pdfUrl: null,
    pdfKind: 'practitioner',
    onGeneratePdf: vi.fn(),
    comparisonId: '',
    comparisonOptions: [],
    onComparisonChange: vi.fn(),
    isSharing: false,
    shareLink: null,
    copied: false,
    onShare: vi.fn(),
    onCopyShare: vi.fn(),
    backHref: '/clients/c1',
    newAssessmentHref: '/assessments/new',
    ...overrides,
  }
}

describe('ReviewDock action hierarchy', () => {
  it('makes approval the only primary action and disables exports before approval', () => {
    const { container } = render(<ReviewDock {...props()} />)

    expect(screen.getByRole('button', { name: 'Approve report' }).getAttribute('data-visual-weight')).toBe('primary')
    expect(screen.queryByRole('button', { name: 'Launch session' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Practitioner PDF' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Client report' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('link', { name: /summary|program|alignment|findings|library/i })).toHaveLength(5)
    expect(container.querySelectorAll('[data-visual-weight="primary"]')).toHaveLength(1)
  })

  it('makes launch the only primary action after approval when a session exists', () => {
    const { container } = render(<ReviewDock {...props({ isApproved: true })} />)

    expect(screen.queryByRole('button', { name: 'Approve report' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Launch session' }).getAttribute('data-visual-weight')).toBe('primary')
    expect((screen.getByRole('button', { name: 'Practitioner PDF' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Client report' }) as HTMLButtonElement).disabled).toBe(false)
    expect(container.querySelectorAll('[data-visual-weight="primary"]')).toHaveLength(1)
  })

  it('replaces practitioner actions with a single saving state while overrides persist', () => {
    render(<ReviewDock {...props({ saveState: 'saving' })} />)

    expect((screen.getByRole('button', { name: 'Saving changes…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Approve report' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Launch session' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Practitioner PDF' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('promotes retry after a failed save and invokes the supplied recovery action', () => {
    const onRetrySave = vi.fn()
    render(<ReviewDock {...props({ saveState: 'failed', onRetrySave })} />)

    const retry = screen.getByRole('button', { name: 'Retry save' })
    expect(retry.getAttribute('data-visual-weight')).toBe('primary')
    expect(screen.getByRole('alert').textContent).toMatch(/not saved/i)
    fireEvent.click(retry)
    expect(onRetrySave).toHaveBeenCalledOnce()
  })

  it('keeps reliability, empty-session, and generated-report states explicit', () => {
    const onGeneratePdf = vi.fn()
    const { container } = render(<ReviewDock {...props({
      isApproved: true,
      hasSession: false,
      reliabilityLabel: 'Camera level not verified',
      reliabilityDetail: null,
      unreliableCount: 2,
      pdfUrl: 'https://example.test/report.pdf',
      pdfKind: 'client',
      onGeneratePdf,
    })} />)

    expect(screen.getByText('Camera level not verified')).toBeTruthy()
    expect(screen.getByText(/2 readings unavailable/i)).toBeTruthy()
    expect(screen.getByText(/no guided session is available/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Launch session' })).toBeNull()
    const clientReport = screen.getByRole('button', { name: 'Client report' })
    expect(clientReport.getAttribute('data-visual-weight')).toBe('primary')
    expect(container.querySelectorAll('[data-visual-weight="primary"]')).toHaveLength(1)
    fireEvent.click(clientReport)
    expect(onGeneratePdf).toHaveBeenCalledWith('client')
    expect(screen.getByRole('link', { name: 'Download client report' })).toBeTruthy()
  })
})
