// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  id: 'client-1',
  router: { push: vi.fn() },
}))

vi.mock('next/navigation', () => {
  return {
    useParams: () => ({ id: navigation.id }),
    useRouter: () => navigation.router,
    // ActionBar (components/ui/ActionBar) reads the route to decide whether
    // it stands alone on an immersive/tab-bar-hidden route; any string is
    // fine here since this page is never one of those.
    usePathname: () => `/clients/${navigation.id}`,
  }
})
vi.mock('./FindingsTrend', () => ({
  default: () => <div data-testid="findings-trend">Findings trend loaded</div>,
}))
vi.mock('./ComparisonWorkspace', () => ({
  default: () => <div data-testid="comparison-workspace">Comparison loaded</div>,
}))
vi.mock('@/components/InPersonConsentForm', () => ({
  default: () => <form aria-label="Record in-person consent" />,
}))
vi.mock('@/components/RemoteConsentButton', () => ({ default: () => null }))
vi.mock('@/components/PrivacyLifecycleControls', () => ({
  default: () => <div data-testid="privacy-lifecycle-controls">Privacy controls loaded</div>,
}))

import ClientDetailPage from './ClientDetailClient'

function seededInitialData() {
  return {
    client: {
      id: 'client-1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1990-01-01',
      sex_at_birth: 'female', height_cm: 165, weight_kg: 60, notes: null,
      consent_recorded_at: '2026-07-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
    },
    assessments: [
      {
        id: 'assessment-1', assessed_at: '2026-07-01T00:00:00.000Z', overall_grade: 'B',
        overall_score: 18, scoring_engine_version: '2.1.0', status: 'complete', assessment_findings: [],
      },
    ],
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
})

describe('client record actions menu', () => {
  // Tabbing into a menu item and pressing Escape puts the keydown's target
  // inside the menu container, which is exactly the containment check meant
  // for the outside-pointerdown case. Escape must close from there anyway.
  it('closes on Escape even when focus is on a menu item, and returns focus to the toggle', () => {
    render(<ClientDetailPage initialData={seededInitialData()} />)

    const toggle = screen.getByRole('button', { name: 'Client record actions' })
    fireEvent.click(toggle)
    const editLink = screen.getByRole('link', { name: /Edit client/ })
    editLink.focus()
    expect(document.activeElement).toBe(editLink)

    fireEvent.keyDown(editLink, { key: 'Escape' })

    expect(screen.queryByRole('link', { name: /Edit client/ })).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  it('still closes on an outside click, unaffected by the Escape fix', () => {
    render(<ClientDetailPage initialData={seededInitialData()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Client record actions' }))
    expect(screen.getByRole('link', { name: /Edit client/ })).toBeTruthy()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('link', { name: /Edit client/ })).toBeNull()
  })
})
