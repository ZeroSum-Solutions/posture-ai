// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { LegalSnapshot } from '@/lib/legal/types'
import { WorkoutLegalNotice } from './RateForm'

const legalNotice: LegalSnapshot = {
  schemaVersion: 1,
  documentId: 'screening-notice-v1',
  kind: 'screening_notice',
  version: '2026-07-20',
  title: 'Screening Notice',
  effectiveAt: '2026-07-20T00:00:00.000Z',
  jurisdiction: 'US',
  locale: 'en-US',
  productScope: 'us_fitness_wellness_assessment_beta_v1',
  audience: 'subject',
  bodySha256: 'a'.repeat(64),
  text: 'Exact governed workout notice.',
  sections: [{ id: 'notice', heading: null, paragraphs: ['Exact governed workout notice.'] }],
  isFixture: true,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkoutLegalNotice', () => {
  test('renders the exact governed snapshot without fetching newer copy', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkoutLegalNotice legalNotice={legalNotice} />)

    expect(screen.getByText('Exact governed workout notice.')).toBeTruthy()
    expect(screen.getByText(/Version 2026-07-20/)).toBeTruthy()
    expect(screen.getByText(/Effective Jul 20, 2026/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('labels persisted v1 notice copy as legacy with unavailable provenance', () => {
    render(<WorkoutLegalNotice legacyDisclaimer="Legacy screening notice." />)

    expect(screen.getByText('Legacy screening notice.')).toBeTruthy()
    expect(screen.getByText('Legacy notice — version and effective date unavailable.')).toBeTruthy()
  })
})
