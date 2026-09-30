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

  it('skips maintain (within-normal) findings — the 3D must not paint a non-actionable result', () => {
    // A reliable finding in the 'maintain' zone is within normal range; every other
    // consumer (selectPriorities, buildProgram) treats it as non-actionable. The 3D
    // muscle map must not color it as an imbalance the same report labels "looking great".
    const { states } = findingsToMuscleStates([
      finding({ zone: 'maintain', tight_muscle_links: [link('upper-trapezius')] }),
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

  it('confidence follows the WINNING role, not the losing role (opposing-role conflict, C4)', () => {
    // gluteus-medius carries a low-confidence tight link AND a high-confidence weak link
    // for the same finding. Equal severity → tie → tight wins. Confidence must be the
    // winning tight role's grade ('low'), NOT the losing weak link's 'high' — otherwise a
    // low-evidence tight signal renders at high 3D intensity.
    const result = findingsToMuscleStates([
      { zone: 'warning', severity_pct: 50, imbalance_key: 'pelvic_obliquity',
        tight_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus Medius', confidence: 'low' }],
        weak_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus Medius', confidence: 'high' }] },
    ])
    const state = result.states.find(s => s.slug === 'gluteus-medius')
    expect(state?.role).toBe('tight')     // tie → tight
    expect(state?.confidence).toBe('low') // winning role's grade, not the losing weak link's 'high'
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

describe('findingsToMuscleStates — left/right laterality', () => {
  it('lateral key + "elevated" link side + "Left Low" direction ⇒ subject right only', () => {
    // Left Low = the subject's left side is lower, so the right side is elevated.
    const { states } = findingsToMuscleStates([
      {
        zone: 'warning', severity_pct: 60,
        imbalance_key: 'posterior_imbalanced_shoulders', direction: 'Left Low',
        tight_muscle_links: [{ slug: 'upper-trapezius', name: 'Upper Trapezius', side: 'elevated' }],
        weak_muscle_links: [],
      },
    ])
    expect(states).toEqual([
      { slug: 'upper-trapezius', role: 'tight', severity: 60, side: 'right' },
    ])
  })

  it('pelvic_obliquity "Right Low" ⇒ QL tight on the elevated (left) side, glute med weak left + tight right', () => {
    // Right Low = the subject's right side is lower, so the left side is elevated.
    const { states, collapsedConflicts } = findingsToMuscleStates([
      {
        zone: 'warning', severity_pct: 55,
        imbalance_key: 'pelvic_obliquity', direction: 'Right Low',
        tight_muscle_links: [
          { slug: 'quadratus-lumborum', name: 'Quadratus Lumborum', side: 'elevated' },
          { slug: 'gluteus-medius', name: 'Gluteus Medius', side: 'lowered' },
        ],
        weak_muscle_links: [
          { slug: 'gluteus-medius', name: 'Gluteus Medius', side: 'elevated' },
        ],
      },
    ])
    expect(bySlug(states, 'quadratus-lumborum')).toEqual({
      slug: 'quadratus-lumborum', role: 'tight', severity: 55, side: 'left',
    })
    const gluteMedStates = states.filter((s) => s.slug === 'gluteus-medius')
    expect(gluteMedStates).toHaveLength(2)
    expect(gluteMedStates).toEqual(expect.arrayContaining([
      { slug: 'gluteus-medius', role: 'weak', severity: 55, side: 'left' },
      { slug: 'gluteus-medius', role: 'tight', severity: 55, side: 'right' },
    ]))
    // Each side only carries one role — this is the motivating case, and it must NOT collapse.
    expect(collapsedConflicts.map((c) => c.slug)).not.toContain('gluteus-medius')
  })

  it('genu_varum_valgum_left resolves to left-only states regardless of link side', () => {
    const { states } = findingsToMuscleStates([
      {
        zone: 'warning', severity_pct: 45,
        imbalance_key: 'genu_varum_valgum_left', direction: 'Valgum (Knock-Knee)',
        tight_muscle_links: [
          { slug: 'tfl-it-band', name: 'TFL / IT Band' },
          { slug: 'hip-adductors', name: 'Hip Adductors' },
        ],
        weak_muscle_links: [],
      },
    ])
    expect(states).toEqual(expect.arrayContaining([
      { slug: 'tfl-it-band', role: 'tight', severity: 45, side: 'left' },
      { slug: 'hip-adductors', role: 'tight', severity: 45, side: 'left' },
    ]))
    expect(states.every((s) => s.side === 'left')).toBe(true)
  })

  it('a sagittal/non-lateral finding is unchanged — no side key present', () => {
    const { states } = findingsToMuscleStates([
      finding({
        severity_pct: 70,
        imbalance_key: 'forward_head_posture',
        tight_muscle_links: [link('upper-trapezius')],
      }),
    ])
    const state = bySlug(states, 'upper-trapezius')
    expect(state).toEqual({ slug: 'upper-trapezius', role: 'tight', severity: 70 })
    expect(state).not.toHaveProperty('side')
  })

  it('"Level" direction (or an unrecognised one) on a lateral key stays bilateral', () => {
    const level = findingsToMuscleStates([
      {
        zone: 'warning', severity_pct: 50, imbalance_key: 'pelvic_obliquity', direction: 'Level',
        tight_muscle_links: [{ slug: 'quadratus-lumborum', name: 'Quadratus Lumborum', side: 'elevated' }],
        weak_muscle_links: [],
      },
    ])
    const unrecognised = findingsToMuscleStates([
      {
        zone: 'warning', severity_pct: 50, imbalance_key: 'pelvic_obliquity', direction: undefined,
        tight_muscle_links: [{ slug: 'quadratus-lumborum', name: 'Quadratus Lumborum', side: 'elevated' }],
        weak_muscle_links: [],
      },
    ])
    for (const { states } of [level, unrecognised]) {
      const state = bySlug(states, 'quadratus-lumborum')
      expect(state).toEqual({ slug: 'quadratus-lumborum', role: 'tight', severity: 50 })
      expect(state).not.toHaveProperty('side')
    }
  })

  it('two findings resolving the same muscle to opposite sides emit both sides correctly', () => {
    const { states } = findingsToMuscleStates([
      {
        zone: 'warning', severity_pct: 40,
        imbalance_key: 'pelvic_obliquity', direction: 'Left Low', // elevated = right
        tight_muscle_links: [{ slug: 'quadratus-lumborum', name: 'Quadratus Lumborum', side: 'elevated' }],
        weak_muscle_links: [],
      },
      {
        zone: 'warning', severity_pct: 55,
        imbalance_key: 'pelvic_obliquity', direction: 'Right Low', // elevated = left
        tight_muscle_links: [{ slug: 'quadratus-lumborum', name: 'Quadratus Lumborum', side: 'elevated' }],
        weak_muscle_links: [],
      },
    ])
    const qlStates = states.filter((s) => s.slug === 'quadratus-lumborum')
    expect(qlStates).toHaveLength(2)
    expect(qlStates).toEqual(expect.arrayContaining([
      { slug: 'quadratus-lumborum', role: 'tight', severity: 55, side: 'left' },
      { slug: 'quadratus-lumborum', role: 'tight', severity: 40, side: 'right' },
    ]))
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
