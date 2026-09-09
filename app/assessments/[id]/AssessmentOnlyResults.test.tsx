// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AssessmentOnlyResults from './AssessmentOnlyResults'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/components/LegalNotice', () => ({ default: () => <p>Screening notice</p> }))

const assessment = {
  id: 'assessment-a', overall_score: 20, overall_grade: 'B', scoring_engine_version: null,
  assessed_at: '2026-09-08T00:00:00Z', clients: { id: 'client-a', first_name: 'Test', last_name: 'Client' },
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('assessment-only capture evidence', () => {
  it('hides current grade visuals while preserving evidence when the public summary is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      clinical_content: { enabled: false },
      assessment: { ...assessment, overall_score: null, overall_grade: null },
      findings: [],
      captures: [{ id: 'front-a', view: 'front', profile_side: null, signed_url: '/saved-front.jpg', capture_roll_deg: null }],
    }) }))

    render(<AssessmentOnlyResults params={Promise.resolve({ id: 'assessment-a' })} />)

    expect(await screen.findByText('Numeric grade unavailable')).toBeTruthy()
    expect(screen.getByTestId('grade-unavailable').textContent).toContain('Current summary')
    expect(screen.queryByText(/20\/100/)).toBeNull()
    expect(screen.queryByText(/Grade B/)).toBeNull()
    expect(screen.queryByText('Grade reference')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Evidence/ }))
    expect(screen.getByRole('button', { name: 'Enlarge front capture' })).toBeTruthy()
  })

  it('shows authorized original photos and missing-photo state without enabling recommendations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      clinical_content: { enabled: false }, assessment, findings: [], captures: [
        { id: 'front-a', view: 'front', profile_side: null, signed_url: '/saved-front.jpg', capture_roll_deg: null },
        { id: 'side-a', view: 'side', profile_side: 'left', signed_url: null, capture_roll_deg: null },
      ],
    }) }))
    render(<AssessmentOnlyResults params={Promise.resolve({ id: 'assessment-a' })} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Evidence/ }))
    expect(screen.getByRole('button', { name: 'Enlarge front capture' })).toBeTruthy()
    expect(new URL(screen.getByRole('img', { name: 'front capture' }).getAttribute('src')!, window.location.origin).pathname).toBe('/saved-front.jpg')
    expect(screen.getByText('side left')).toBeTruthy()
    expect(screen.getByText('Photo not saved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /generate.*program/i })).toBeNull()
  })

  it('does not present an unavailable legacy measurement as a current numeric finding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      clinical_content: { enabled: false }, assessment, captures: [], findings: [
        { id: 'legacy-a', imbalance_key: 'legacy', label: 'Legacy measurement', zone: 'unreliable',
          deviation: 14.2, direction: 'unavailable', view_used: 'front', uncertainty_deg: 1.2 },
      ],
    }) }))
    render(<AssessmentOnlyResults params={Promise.resolve({ id: 'assessment-a' })} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Findings/ }))
    expect(screen.getByText('Measurement unavailable. Review the capture evidence.')).toBeTruthy()
    expect(screen.queryByText(/14\.2/)).toBeNull()
    expect(screen.queryByText(/capture variation/)).toBeNull()
  })

  it('reports an absent capture set without inventing replacement imagery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      clinical_content: { enabled: false }, assessment, findings: [], captures: [],
    }) }))
    render(<AssessmentOnlyResults params={Promise.resolve({ id: 'assessment-a' })} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Evidence/ }))
    expect(screen.getByText('No captures are stored for this screening.')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
