import { describe, it, expect } from 'vitest'
import { muscleContentSchema, exerciseContentSchema, IMBALANCE_KEYS } from './muscles/types'
import { MUSCLE_REGISTRY } from './muscles/registry'
import { ALL_MUSCLES, ALL_EXERCISES } from './index'

const linkKey = (m: string, i: string, r: string) => `${m}|${i}|${r}`

describe('muscle content', () => {
  it('every content file passes the schema (incl. vocabulary lint)', () => {
    for (const muscle of ALL_MUSCLES) {
      const result = muscleContentSchema.safeParse(muscle)
      expect(
        result.success,
        `${muscle.slug}: ${result.success ? '' : JSON.stringify(result.error.issues, null, 1)}`
      ).toBe(true)
    }
  })

  it('content slugs match the registry exactly', () => {
    const contentSlugs = ALL_MUSCLES.map(m => m.slug).sort()
    const registrySlugs = MUSCLE_REGISTRY.map(m => m.slug).sort()
    expect(contentSlugs).toEqual(registrySlugs)
  })

  it('registry name/region agree with content', () => {
    for (const entry of MUSCLE_REGISTRY) {
      const muscle = ALL_MUSCLES.find(m => m.slug === entry.slug)!
      expect(muscle.name, entry.slug).toBe(entry.name)
      expect(muscle.region, entry.slug).toBe(entry.region)
    }
  })

  // No direct EMG evidence supports pectoralis-minor *overactivity* in
  // rounded-shoulder/FHP — only mechanical (length-based) shortening. None of
  // its prose (summary, function, screening, link rationales) may propagate the
  // unsupported activity claim.
  it('pectoralis-minor is coded length-only (no unsupported "overactive" claim)', () => {
    const pecMinor = ALL_MUSCLES.find(m => m.slug === 'pectoralis-minor')
    expect(pecMinor, 'pectoralis-minor content must exist').toBeDefined()
    const prose = [
      pecMinor!.anatomySummary,
      pecMinor!.functionText,
      pecMinor!.screeningNotes,
      ...pecMinor!.links.map(l => l.rationale),
    ].join(' ').toLowerCase()
    expect(prose).not.toContain('overactive')
  })

  it('content links cover the registry links exactly (no missing, no extras)', () => {
    const contentLinks = new Set(
      ALL_MUSCLES.flatMap(m => m.links.map(l => linkKey(m.slug, l.imbalanceKey, l.role)))
    )
    const registryLinks = new Set(
      MUSCLE_REGISTRY.flatMap(m => m.links.map(l => linkKey(m.slug, l.imbalanceKey, l.role)))
    )
    const missing = [...registryLinks].filter(k => !contentLinks.has(k))
    const extra = [...contentLinks].filter(k => !registryLinks.has(k))
    expect(missing, 'links required by registry but absent from content').toEqual([])
    expect(extra, 'links in content but not in the reviewed registry').toEqual([])
  })
})

describe('exercise content', () => {
  it('every exercise passes the schema (incl. vocabulary lint)', () => {
    for (const exercise of ALL_EXERCISES) {
      const result = exerciseContentSchema.safeParse(exercise)
      expect(
        result.success,
        `${exercise.slug}: ${result.success ? '' : JSON.stringify(result.error.issues, null, 1)}`
      ).toBe(true)
    }
  })

  it('exercise slugs are unique', () => {
    const slugs = ALL_EXERCISES.map(e => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('exercise muscle slugs all exist in the registry', () => {
    const known = new Set(MUSCLE_REGISTRY.map(m => m.slug))
    for (const exercise of ALL_EXERCISES) {
      for (const m of exercise.muscles) {
        expect(known.has(m.muscleSlug), `${exercise.slug} -> ${m.muscleSlug}`).toBe(true)
      }
    }
  })

  it('every imbalance key is served by at least one exercise', () => {
    for (const key of IMBALANCE_KEYS) {
      const count = ALL_EXERCISES.filter(e => e.primaryDeviationKeys.includes(key)).length
      expect(count, key).toBeGreaterThanOrEqual(1)
    }
  })

  it('every tight-linked muscle has at least one stretch exercise', () => {
    const tightMuscles = new Set(
      MUSCLE_REGISTRY.filter(m => m.links.some(l => l.role === 'tight')).map(m => m.slug)
    )
    for (const slug of tightMuscles) {
      const stretches = ALL_EXERCISES.filter(e =>
        e.muscles.some(m => m.muscleSlug === slug && m.role === 'stretch')
      )
      expect(stretches.length, `${slug} needs >=1 stretch`).toBeGreaterThanOrEqual(1)
    }
  })

  it('every weak-linked muscle has strengthening work across >=2 progression levels', () => {
    const weakMuscles = new Set(
      MUSCLE_REGISTRY.filter(m => m.links.some(l => l.role === 'weak')).map(m => m.slug)
    )
    for (const slug of weakMuscles) {
      const levels = new Set(
        ALL_EXERCISES.flatMap(e =>
          e.muscles
            .filter(m => m.muscleSlug === slug && m.role === 'strengthen')
            .map(m => m.progressionLevel)
        )
      )
      expect(levels.size, `${slug} needs strengthen work at >=2 progression levels, has [${[...levels]}]`).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps the original ten seed exercises present by slug', () => {
    const seedSlugs = [
      'chin-tucks', 'neck-lateral-stretch', 'thoracic-extension', 'wall-angels',
      'doorway-pec-stretch', 'kneeling-hip-flexor-stretch', 'glute-bridge',
      'clamshell', 'single-leg-balance', 'standing-hamstring-curl',
    ]
    const slugs = new Set(ALL_EXERCISES.map(e => e.slug))
    for (const slug of seedSlugs) expect(slugs.has(slug), slug).toBe(true)
  })

  it('total exercise count lands in the planned 45-60 range', () => {
    expect(ALL_EXERCISES.length).toBeGreaterThanOrEqual(45)
    expect(ALL_EXERCISES.length).toBeLessThanOrEqual(60)
  })

  // Static stretches must hold >=30s to produce chronic ROM change (Bandy &
  // Irion 1994 meta-analysis; 2025 Delphi; Grade A). Sub-threshold holds are
  // an under-dose. Isometric strength/stability holds are a different category
  // and are intentionally excluded.
  it('every static stretch holds >= 30 seconds (Bandy & Irion 1994 floor)', () => {
    const stretches = ALL_EXERCISES.filter(e => e.category === 'stretch')
    // Guard against a vacuous pass: the predicate must actually run on real data.
    expect(stretches.length, 'expected static stretches in the library').toBeGreaterThan(0)
    const subThreshold = stretches
      .filter(e => e.holdSeconds < 30)
      .map(e => `${e.slug} (${e.holdSeconds}s)`)
    expect(subThreshold, 'static stretches below the 30s evidence floor').toEqual([])
  })
})
