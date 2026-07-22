// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import LegalNotice from './LegalNotice'
import { SUBJECT_CONSENT_SNAPSHOT } from './legal-test-fixture'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LegalNotice', () => {
  it('renders an exact supplied snapshot immediately and lets its kind win', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<LegalNotice document={SUBJECT_CONSENT_SNAPSHOT} kind="privacy" compact />)

    expect(screen.getByRole('article', { name: 'Consent to Posture Screening' })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads and displays the exact document returned by the legal endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      document: { ...SUBJECT_CONSENT_SNAPSHOT, kind: 'privacy', title: 'Privacy Policy', audience: 'public' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<LegalNotice kind="privacy" headingLevel={1} />)
    expect(await screen.findByRole('article', { name: 'Privacy Policy' })).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/legal/documents?kind=privacy', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('announces legal unavailability instead of showing stale fallback copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Counsel-approved privacy policy is unavailable.',
      code: 'legal_unavailable',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })))

    render(<LegalNotice kind="privacy" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Counsel-approved privacy policy is unavailable.')
    expect(screen.queryByRole('article')).toBeNull()
  })
})
