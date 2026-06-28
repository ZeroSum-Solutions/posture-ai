import { describe, it, expect } from 'vitest'
import { MUSCLE_REGISTRY } from '@/content/muscles/registry'
import {
  MUSCLE_REGIONS_BY_SLUG,
  getMuscleRegion,
  getMuscleRegionBySlug,
  resolveMarkerRegions,
  hasAnyMuscle,
} from './muscleMap'

describe('muscleMap — slug coordinates', () => {
  it('every content slug except rectus-femoris has a coordinate', () => {
    for (const { slug } of MUSCLE_REGISTRY) {
      if (slug === 'rectus-femoris') {
        expect(getMuscleRegionBySlug(slug)).toBeNull()
        continue
      }
      expect(getMuscleRegionBySlug(slug), slug).not.toBeNull()
    }
  })

  it('colliding slugs resolve to the documented coordinate source', () => {
    expect(MUSCLE_REGIONS_BY_SLUG['deep-abdominals']).toEqual(getMuscleRegion('abdominals'))
    expect(MUSCLE_REGIONS_BY_SLUG['tfl-it-band']).toEqual(getMuscleRegion('tensor fasciae latae'))
    expect(MUSCLE_REGIONS_BY_SLUG['quadriceps']).toEqual(getMuscleRegion('quadriceps'))
  })
})

describe('muscleMap — resolveMarkerRegions', () => {
  it('reproduces legacy getMuscleRegion placement for a known name set', () => {
    const r = resolveMarkerRegions({
      tightMuscles: ['quadriceps'],
      weakMuscles: ['hamstrings'],
      tightLinks: [],
      weakLinks: [],
    })
    expect(r.frontTight).toHaveLength(1)
    expect(r.frontTight[0].region).toEqual(getMuscleRegion('quadriceps'))
    expect(r.backWeak).toHaveLength(1)
    expect(r.backWeak[0].region).toEqual(getMuscleRegion('hamstrings'))
    expect(r.hasAny).toBe(true)
  })

  it('falls back to links when a role legacy array is empty', () => {
    const r = resolveMarkerRegions({
      tightMuscles: [],
      weakMuscles: [],
      tightLinks: [{ slug: 'tfl-it-band', name: 'TFL & IT Band' }],
      weakLinks: [{ slug: 'gluteus-medius', name: 'Gluteus Medius' }],
    })
    expect(r.frontTight).toHaveLength(1) // tfl-it-band is a front marker
    expect(r.frontTight[0].region).toEqual(MUSCLE_REGIONS_BY_SLUG['tfl-it-band'])
    expect(r.backWeak).toHaveLength(1) // gluteus-medius is a back marker
    expect(r.hasAny).toBe(true)
  })

  it('legacy array takes precedence over links for the same role', () => {
    const r = resolveMarkerRegions({
      tightMuscles: ['quadriceps'],
      weakMuscles: [],
      tightLinks: [{ slug: 'tfl-it-band', name: 'ignored' }],
      weakLinks: [],
    })
    expect(r.frontTight).toHaveLength(1)
    expect(r.frontTight[0].region).toEqual(getMuscleRegion('quadriceps'))
  })

  it('ignores link slugs with no coordinate (e.g. rectus-femoris)', () => {
    const r = resolveMarkerRegions({
      tightMuscles: [],
      weakMuscles: [],
      tightLinks: [{ slug: 'rectus-femoris', name: 'Rectus Femoris' }],
      weakLinks: [],
    })
    expect(r.hasAny).toBe(false)
  })

  it('returns hasAny false for fully empty input', () => {
    const r = resolveMarkerRegions({ tightMuscles: [], weakMuscles: [], tightLinks: [], weakLinks: [] })
    expect(r.hasAny).toBe(false)
  })
})

describe('muscleMap — hasAnyMuscle (accordion gate via FindingCard.hasMuscles)', () => {
  it('is true when only links are present (legacy empty)', () => {
    expect(
      hasAnyMuscle({ tightMuscles: [], weakMuscles: [], tightLinks: [{ slug: 'hamstrings', name: 'Hamstrings' }], weakLinks: [] }),
    ).toBe(true)
  })

  it('is true when only legacy arrays are present', () => {
    expect(hasAnyMuscle({ tightMuscles: ['quadriceps'], weakMuscles: [], tightLinks: [], weakLinks: [] })).toBe(true)
  })

  it('is false when everything is empty', () => {
    expect(hasAnyMuscle({ tightMuscles: [], weakMuscles: [], tightLinks: [], weakLinks: [] })).toBe(false)
  })
})

// Post-reconciliation legacy arrays from the seed migrations
// (20260101000001_seed_data.sql + 20260627000000_muscle_evidence_reconciliation.sql),
// with the per-role/view marker split computed INDEPENDENTLY by hand from the
// coordinate views (not by running the resolver). Locks the legacy render path
// against `main` for every one of the 10 seeded imbalance keys — the
// zero-visible-change guarantee for production data.
const LEGACY_SEED_PARITY: Record<
  string,
  {
    tight: string[]
    weak: string[]
    expected: { frontTight: number; backTight: number; frontWeak: number; backWeak: number }
  }
> = {
  forward_head_posture: {
    tight: ['suboccipitals', 'upper trapezius', 'levator scapulae', 'sternocleidomastoid'],
    weak: ['deep cervical flexors', 'lower trapezius'],
    expected: { frontTight: 1, backTight: 3, frontWeak: 1, backWeak: 1 },
  },
  anterior_imbalanced_shoulders: {
    tight: ['pectoralis major', 'pectoralis minor', 'anterior deltoid', 'upper trapezius'],
    weak: ['rhomboids', 'middle trapezius', 'lower trapezius', 'serratus anterior'],
    expected: { frontTight: 3, backTight: 1, frontWeak: 1, backWeak: 3 },
  },
  posterior_imbalanced_shoulders: {
    tight: ['upper trapezius', 'levator scapulae'],
    weak: ['lower trapezius'],
    expected: { frontTight: 0, backTight: 2, frontWeak: 0, backWeak: 1 },
  },
  t1_tilt_backward: {
    tight: ['thoracic erector spinae', 'latissimus dorsi'],
    weak: ['deep thoracic flexors', 'abdominals'],
    expected: { frontTight: 0, backTight: 2, frontWeak: 2, backWeak: 0 },
  },
  pelvic_obliquity: {
    tight: ['quadratus lumborum', 'adductors (elevated side)', 'opposite gluteus medius'],
    weak: ['gluteus medius (elevated side)'],
    expected: { frontTight: 1, backTight: 2, frontWeak: 0, backWeak: 1 },
  },
  anterior_pelvic_shift: {
    tight: ['hip flexors', 'lumbar erector spinae', 'gastrocnemius'],
    weak: ['gluteals', 'hamstrings', 'abdominals'],
    expected: { frontTight: 1, backTight: 2, frontWeak: 1, backWeak: 2 },
  },
  // Demoted by 20260626000000_demote_pelvic_axial_rotation.sql: arrays cleared,
  // links deleted, findings forced unreliable — so it renders no markers at all.
  pelvic_axial_rotation: {
    tight: [],
    weak: [],
    expected: { frontTight: 0, backTight: 0, frontWeak: 0, backWeak: 0 },
  },
  genu_varum_valgum_left: {
    tight: ['tensor fasciae latae', 'IT band', 'lateral structures (varum) or adductors (valgum)'],
    weak: ['gluteus medius', 'vastus medialis (VMO)'],
    expected: { frontTight: 3, backTight: 0, frontWeak: 1, backWeak: 1 },
  },
  genu_varum_valgum_right: {
    tight: ['tensor fasciae latae', 'IT band', 'lateral structures (varum) or adductors (valgum)'],
    weak: ['gluteus medius', 'vastus medialis (VMO)'],
    expected: { frontTight: 3, backTight: 0, frontWeak: 1, backWeak: 1 },
  },
  knee_extension_back_knee: {
    tight: [],
    weak: ['hamstrings'],
    expected: { frontTight: 0, backTight: 0, frontWeak: 0, backWeak: 1 },
  },
}

describe('muscleMap — legacy seed parity (zero visible change vs main, all 10 keys)', () => {
  for (const [key, { tight, weak, expected }] of Object.entries(LEGACY_SEED_PARITY)) {
    it(`reproduces the marker split for ${key}`, () => {
      const r = resolveMarkerRegions({ tightMuscles: tight, weakMuscles: weak, tightLinks: [], weakLinks: [] })
      expect(
        {
          frontTight: r.frontTight.length,
          backTight: r.backTight.length,
          frontWeak: r.frontWeak.length,
          backWeak: r.backWeak.length,
        },
        key,
      ).toEqual(expected)
    })
  }
})
