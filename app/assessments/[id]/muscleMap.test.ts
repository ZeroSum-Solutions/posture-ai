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
