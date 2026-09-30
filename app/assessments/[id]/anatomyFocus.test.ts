import { describe, it, expect } from 'vitest'
import {
  sidesSummary,
  musclesForFinding,
  prescribedSteps,
  sidesBySlug,
  slugForViewerId,
  spotlightIds,
  viewerStates,
} from './anatomyFocus'
import type { AssessmentFinding } from './findingsToMuscleStates'
import type { ClinicalProgramReport } from '@/lib/program/clinicalProjection'

function finding(over: Partial<AssessmentFinding>): AssessmentFinding {
  return {
    zone: 'warning',
    severity_pct: 60,
    tight_muscle_links: [],
    weak_muscle_links: [],
    tight_muscles: [],
    weak_muscles: [],
    ...over,
  }
}

describe('sidesBySlug', () => {
  it('spreads a bilateral state to both sides and keeps sided states apart', () => {
    const rows = sidesBySlug([
      { slug: 'upper-trapezius', role: 'tight', severity: 70 },
      { slug: 'gluteus-medius', role: 'weak', severity: 60, side: 'right' },
      { slug: 'gluteus-medius', role: 'tight', severity: 60, side: 'left' },
    ])
    expect(rows.find((r) => r.slug === 'upper-trapezius')).toMatchObject({
      left: { role: 'tight' },
      right: { role: 'tight' },
      viewerId: 'upper_trapezius',
    })
    expect(rows.find((r) => r.slug === 'gluteus-medius')).toMatchObject({
      left: { role: 'tight' },
      right: { role: 'weak' },
    })
  })
})

describe('musclesForFinding', () => {
  it('lists a finding’s muscles tight-first with authored names, and spotlights drawable ones', () => {
    const muscles = musclesForFinding(
      finding({
        imbalance_key: 'forward_head_posture',
        tight_muscle_links: [{ slug: 'suboccipitals', name: 'Suboccipitals' }],
        weak_muscle_links: [{ slug: 'deep-cervical-flexors', name: 'Deep cervical flexors' }],
      }),
    )
    expect(muscles.map((m) => m.name)).toEqual(['Suboccipitals', 'Deep cervical flexors'])
    expect(spotlightIds(muscles)).toEqual(['suboccipitals', 'deep_cervical_flexors'])
  })

  it('carries per-side roles from a lateral finding', () => {
    const muscles = musclesForFinding(
      finding({
        imbalance_key: 'pelvic_obliquity',
        direction: 'Left Low', // right side elevated
        tight_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus medius', side: 'lowered' }],
        weak_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus medius', side: 'elevated' }],
      }),
    )
    expect(muscles).toHaveLength(1)
    expect(muscles[0]).toMatchObject({ left: { role: 'tight' }, right: { role: 'weak' } })
  })
})

describe('viewerStates', () => {
  it('scales severity by link evidence', () => {
    const [low] = viewerStates([{ slug: 'x', role: 'tight', severity: 80, confidence: 'low' }])
    const [high] = viewerStates([{ slug: 'x', role: 'tight', severity: 80, confidence: 'high' }])
    expect(low.severity!).toBeLessThan(high.severity!)
  })
})

describe('slugForViewerId', () => {
  it('prefers the slug this assessment referenced, else the hyphenated id', () => {
    expect(slugForViewerId('pectoralis_minor', [{ slug: 'pectoralis-minor', role: 'tight' }])).toBe(
      'pectoralis-minor',
    )
    expect(slugForViewerId('rhomboids', [])).toBe('rhomboids')
    expect(slugForViewerId('upper_trapezius', [])).toBe('upper-trapezius')
  })
})

describe('prescribedSteps', () => {
  const step = (slug: string) => ({
    stepLabel: 'Lengthen', slug, baseSlug: slug, name: slug, category: 'stretch' as const, freq: 'daily',
    isIntegrative: false, repRange: null, weeks: [null, null, null] as [null, null, null], alternatives: [],
  })
  const program = {
    priorities: [
      { label: 'Forward head posture', steps: [step('doorway-pec-stretch'), step('chin-tucks')] },
      { label: 'Rounded shoulders', steps: [step('doorway-pec-stretch'), step('wall-angels')] },
    ],
  } as unknown as ClinicalProgramReport
  const catalog = [
    { slug: 'doorway-pec-stretch', role: 'stretch' as const },
    { slug: 'wall-angels', role: 'strengthen' as const },
  ]

  it('returns stretches for a tight muscle, once, in program order', () => {
    const out = prescribedSteps(program, catalog, { left: { role: 'tight' }, right: { role: 'tight' } })
    expect(out.map((p) => [p.step.slug, p.role, p.priorityLabel])).toEqual([
      ['doorway-pec-stretch', 'stretch', 'Forward head posture'],
    ])
  })

  it('returns strengthening for a weak muscle and both for a split muscle', () => {
    expect(prescribedSteps(program, catalog, { left: { role: 'weak' }, right: null }).map((p) => p.step.slug)).toEqual([
      'wall-angels',
    ])
    expect(
      prescribedSteps(program, catalog, { left: { role: 'tight' }, right: { role: 'weak' } }).map((p) => p.role),
    ).toEqual(['stretch', 'strengthen'])
  })

  it('is empty without a program', () => {
    expect(prescribedSteps(null, catalog, null)).toEqual([])
  })
})

describe('sidesSummary', () => {
  it('reads both sides in one line', () => {
    expect(sidesSummary({ left: { role: 'tight', severity: 70 }, right: { role: 'tight', severity: 72 } })).toBe('Tight · both sides (marked)')
    expect(sidesSummary({ left: { role: 'weak', severity: 20 }, right: { role: 'weak', severity: 70 } })).toBe('Right weaker than left')
    expect(sidesSummary({ left: { role: 'tight' }, right: { role: 'weak' } })).toBe('Right weak, left tight')
    expect(sidesSummary({ left: null, right: { role: 'weak' } })).toBe('Weak · right side only')
    expect(sidesSummary(null)).toBe('No finding in this scan')
  })
})
