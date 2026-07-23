// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('./PriorityProgram', () => ({ default: () => null }))
vi.mock('./ReviewDock', () => ({
  default: ({ comparisonOptions }: { comparisonOptions: unknown[] }) => (
    <div data-testid="review-dock" data-comparison-count={comparisonOptions.length} />
  ),
}))
vi.mock('./MuscleBodyMap', () => ({ default: () => null }))
vi.mock('./MuscleModel3D', () => ({ default: () => null }))
vi.mock('@/components/LegalNotice', () => ({ default: () => null }))

import ClinicalAssessmentResults from './ClinicalAssessmentResults'

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('assessment results progressive rendering', () => {
  it('paints the primary review before optional comparison history finishes', async () => {
    const priorHistory = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/assessments/assessment-1') {
        return Promise.resolve(response({
          assessment: {
            id: 'assessment-1',
            status: 'complete',
            overall_score: 12,
            overall_grade: 'A',
            scoring_engine_version: '2.1.0',
            tilt_corrected: false,
            level_verified: true,
            capture_stability: 0.98,
            assessed_at: '2026-07-02T00:00:00.000Z',
            priority_keys: [],
            capability: 'standard',
            exercise_swaps: {},
            practitioner_approved: false,
            clients: { id: 'client-1', first_name: 'Ada', last_name: 'Lovelace' },
          },
          findings: [],
          captures: [],
          clinical_content: {
            enabled: true,
            projection: {
              program: { priorities: [], eligibleOrder: [] },
              exercises: [],
              sessionPreview: null,
            },
          },
        }))
      }
      if (url.startsWith('/api/clients/client-1/assessments?')) return priorHistory.promise
      if (url === '/api/workouts?assessment_id=assessment-1') return Promise.resolve(response({ runs: [] }))
      throw new Error(`Unexpected URL: ${url}`)
    }))

    render(<ClinicalAssessmentResults params={Promise.resolve({ id: 'assessment-1' })} />)

    expect(await screen.findByRole('heading', { name: 'Assessment review studio' })).toBeTruthy()
    expect(screen.queryByText('Loading results...')).toBeNull()
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
})
