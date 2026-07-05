import { describe, it, expect } from 'vitest'
import {
  findingsToMuscleStates,
  slugToViewerId,
  type AssessmentFinding,
} from './findingsToMuscleStates'

// Minimal finding factory — only the fields the adapter reads.
function finding(over: Partial<AssessmentFinding>): AssessmentFinding {
  return {
    zone: 'warning',
    severity_pct: 50,
    tight_muscle_links: [],
    weak_muscle_links: [],
    tight_muscles: [],
    weak_muscles: [],
    ...over,
  }
}
const link = (slug: string, name = slug) => ({ slug, name })
const bySlug = <T extends { slug: string }>(states: T[], slug: string) =>
  states.find((s) => s.slug === slug)

describe('findingsToMuscleStates', () => {
  it('skips unreliable findings entirely', () => {
    const { states } = findingsToMuscleStates([
      finding({ zone: 'unreliable', tight_muscle_links: [link('upper-trapezius')] }),
    ])
    expect(states).toEqual([])
  })

  it('emits tight/weak from muscle links with finding-level severity', () => {
    const { states } = findingsToMuscleStates([
      finding({
        severity_pct: 70,
        tight_muscle_links: [link('upper-trapezius')],
        weak_muscle_links: [link('lower-trapezius')],
      }),
    ])
    expect(bySlug(states, 'upper-trapezius')).toEqual({ slug: 'upper-trapezius', role: 'tight', severity: 70 })
    expect(bySlug(states, 'lower-trapezius')).toEqual({ slug: 'lower-trapezius', role: 'weak', severity: 70 })
  })

  it('falls back to legacy name arrays via exact + substring, mirroring the 2D map', () => {
    const { states } = findingsToMuscleStates([
      finding({
        severity_pct: 40,
        tight_muscle_links: [],
        tight_muscles: [
          'tensor fasciae latae', // exact -> tfl-it-band
          'lateral structures (varum) or adductors (valgum)', // substring -> hip-adductors (as 2D does)
          'opposite gluteus medius', // substring -> gluteus-medius (as 2D does)
        ],
      }),
    ])
    expect(bySlug(states, 'tfl-it-band')).toEqual({ slug: 'tfl-it-band', role: 'tight', severity: 40 })
    expect(bySlug(states, 'hip-adductors')?.role).toBe('tight')
    expect(bySlug(states, 'gluteus-medius')?.role).toBe('tight')
  })

  it('surfaces a legacy name that resolves to no muscle in notShown', () => {
    const { states, notShown } = findingsToMuscleStates([
      finding({ tight_muscle_links: [], tight_muscles: ['zzz nonexistent structure'] }),
    ])
    expect(states).toEqual([])
    expect(notShown.some((m) => m.name.includes('zzz nonexistent'))).toBe(true)
  })

  it('prefers links over legacy names for the same role', () => {
    const { states } = findingsToMuscleStates([
      finding({
        tight_muscle_links: [link('upper-trapezius')],
        tight_muscles: ['tensor fasciae latae'], // ignored because links present
      }),
    ])
    expect(bySlug(states, 'upper-trapezius')).toBeTruthy()
    expect(bySlug(states, 'tfl-it-band')).toBeUndefined()
  })

  it('sanitizes severity: clamps in-range, drops non-finite to undefined', () => {
    const s = (sev: unknown) =>
      findingsToMuscleStates([
        finding({ severity_pct: sev as number, tight_muscle_links: [link('rhomboids')] }),
      ]).states[0].severity
    expect(s(150)).toBe(100)
    expect(s(-20)).toBe(0)
    expect(s(null)).toBeUndefined()
    expect(s(NaN)).toBeUndefined()
    expect(s('80')).toBeUndefined()
  })

  it('dedups same-role occurrences keeping max severity', () => {
    const { states } = findingsToMuscleStates([
      finding({ severity_pct: 40, tight_muscle_links: [link('pectoralis-major')] }),
      finding({ severity_pct: 72, tight_muscle_links: [link('pectoralis-major')] }),
    ])
    expect(states.filter((x) => x.slug === 'pectoralis-major')).toHaveLength(1)
    expect(bySlug(states, 'pectoralis-major')).toEqual({ slug: 'pectoralis-major', role: 'tight', severity: 72 })
  })

  it('collapses a tight/weak conflict to the higher-severity role and surfaces it', () => {
    const { states, collapsedConflicts } = findingsToMuscleStates([
      finding({ severity_pct: 50, tight_muscle_links: [link('gluteus-medius')] }),
      finding({ severity_pct: 60, weak_muscle_links: [link('gluteus-medius')] }),
    ])
    expect(bySlug(states, 'gluteus-medius')).toEqual({ slug: 'gluteus-medius', role: 'weak', severity: 60 })
    expect(collapsedConflicts.map((c) => c.slug)).toContain('gluteus-medius')
  })

  it('a real severity beats an unknown one in a conflict (missing data never flips color)', () => {
    const { states } = findingsToMuscleStates([
      finding({ severity_pct: 30, tight_muscle_links: [link('gluteus-medius')] }),
      finding({ severity_pct: null as unknown as number, weak_muscle_links: [link('gluteus-medius')] }),
    ])
    // tight=30 is the only measured signal; the null-severity weak must not win and flip it blue.
    expect(bySlug(states, 'gluteus-medius')).toEqual({
      slug: 'gluteus-medius',
      role: 'tight',
      severity: 30,
    })
  })

  it('breaks a conflict tie in favor of tight', () => {
    const { states } = findingsToMuscleStates([
      finding({ severity_pct: 55, tight_muscle_links: [link('gluteus-medius')] }),
      finding({ severity_pct: 55, weak_muscle_links: [link('gluteus-medius')] }),
    ])
    expect(bySlug(states, 'gluteus-medius')?.role).toBe('tight')
  })

  it('does not throw on findings with no muscle data', () => {
    expect(() => findingsToMuscleStates([finding({})])).not.toThrow()
    expect(findingsToMuscleStates([finding({})]).states).toEqual([])
    expect(findingsToMuscleStates(null).states).toEqual([])
  })

  it('lists an emitted slug that no viewer id renders in notShown', () => {
    const { states, notShown } = findingsToMuscleStates([
      finding({ tight_muscle_links: [link('totally-made-up-muscle', 'Made Up')] }),
    ])
    // still emitted (viewer drops unknown slugs), and surfaced honestly
    expect(bySlug(states, 'totally-made-up-muscle')).toBeTruthy()
    expect(notShown.some((m) => m.slug === 'totally-made-up-muscle')).toBe(true)
  })

  it('mirrors the 2D map for genu findings (colors both lateral + adductor)', () => {
    const { states } = findingsToMuscleStates([
      finding({
        imbalance_key: 'genu_varum_valgum_left',
        direction: 'Valgum (Knock-Knee)',
        tight_muscle_links: [link('tfl-it-band'), link('hip-adductors')],
      }),
    ])
    expect(bySlug(states, 'tfl-it-band')?.role).toBe('tight')
    expect(bySlug(states, 'hip-adductors')?.role).toBe('tight')
  })

  it('carries the max link confidence onto the muscle state', () => {
    const result = findingsToMuscleStates([
      { zone: 'danger', severity_pct: 80, imbalance_key: 'trunk_lean',
        tight_muscle_links: [
          { slug: 'iliopsoas', name: 'Iliopsoas', confidence: 'high' },
          { slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'low' },
        ], weak_muscle_links: [] },
    ])
    expect(result.states.find(s => s.slug === 'iliopsoas')?.confidence).toBe('high')
    expect(result.states.find(s => s.slug === 'latissimus-dorsi')?.confidence).toBe('low')
  })

  it('takes the highest confidence when a slug appears in two findings (confidence decoupled from severity-winner)', () => {
    // severity-80 candidate is graded 'low'; severity-40 candidate is graded 'high'.
    // The severity-winner (80) and the confidence-winner (40/high) are different candidates.
    // Result confidence must be 'high' (group-max), proving confidence ≠ severity winner's grade.
    const result = findingsToMuscleStates([
      { zone: 'danger', severity_pct: 80, imbalance_key: 'a',
        tight_muscle_links: [{ slug: 'upper-trapezius', name: 'Upper Trapezius', confidence: 'low' }], weak_muscle_links: [] },
      { zone: 'warning', severity_pct: 40, imbalance_key: 'b',
        tight_muscle_links: [{ slug: 'upper-trapezius', name: 'Upper Trapezius', confidence: 'high' }], weak_muscle_links: [] },
    ])
    const state = result.states.find(s => s.slug === 'upper-trapezius')
    expect(state?.confidence).toBe('high') // group-max confidence, not the severity winner's grade
    expect(state?.severity).toBe(80)       // severity-winner's severity is still correct
  })

  it('does not mutate its input', () => {
    const input = [
      finding({ severity_pct: 70, tight_muscle_links: [link('upper-trapezius')] }),
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    findingsToMuscleStates(input)
    expect(input).toEqual(snapshot)
  })
})

describe('slugToViewerId', () => {
  it('maps a plain slug by hyphen->underscore', () => {
    expect(slugToViewerId('upper-trapezius')).toBe('upper_trapezius')
  })
  it('maps aliased slugs', () => {
    expect(slugToViewerId('tfl-it-band')).toBe('tfl_itband')
    expect(slugToViewerId('gastrocnemius-soleus')).toBe('gastroc_soleus')
  })
  it('returns null for unknown slugs and empty input', () => {
    expect(slugToViewerId('totally-made-up-muscle')).toBeNull()
    expect(slugToViewerId('')).toBeNull()
  })
})
