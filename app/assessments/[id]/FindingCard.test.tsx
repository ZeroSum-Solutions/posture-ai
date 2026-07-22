// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Heavy children (3D/WebGL, charts, program) are irrelevant to the toggle's ARIA.
vi.mock('./MuscleModel3D', () => ({ default: () => null }))
vi.mock('./MuscleBodyMap', () => ({ default: () => null }))
vi.mock('./PriorityProgram', () => ({ default: () => null }))
vi.mock('./WhyThisSheet', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

import { FindingCard } from './ClinicalAssessmentResults'

afterEach(cleanup)

const finding = {
  id: 'f1', imbalance_key: 'trunk_lean', region: 'spine', label: 'Trunk Lean',
  deviation: 5, direction: 'Forward', severity_pct: 40, zone: 'warning',
  view_used: 'side', confidence: 0.9,
  tight_muscle_links: [{ slug: 'iliopsoas', name: 'Iliopsoas' }],
  weak_muscle_links: [],
}

describe('FindingCard Muscle Analysis disclosure', () => {
  it('exposes aria-expanded so assistive tech knows the panel state (WCAG 4.1.2)', () => {
    render(<FindingCard f={finding as never} />)
    const btn = screen.getByRole('button', { name: /Muscle Analysis/i })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })
})
