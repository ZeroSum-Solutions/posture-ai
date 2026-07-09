import { describe, it, expect } from 'vitest'
import { ALL_EXERCISES, ALL_MUSCLES } from '../../content'

/**
 * Cross-finding contraindication gate.
 *
 * The coherence gate (coherence.test.ts) validates each (exercise × finding) pair in
 * isolation, so a pair that is coherent on its own passes even when a second concurrent
 * finding makes it unsafe. This gate covers that blind spot: it derives every pair with
 * the shape "exercise STRETCHES muscle M for key K (M tight for K), but another key K2
 * marks M as weak/lengthened" and requires each one to have been adjudicated.
 *
 * Every derived pair must be either:
 *   * ENCODED    — listed in the exercise's contraindicatedDeviationKeys, or
 *   * ADJUDICATED — reviewed and deliberately not treated as a contraindication, with a reason.
 * A NEW pair matching neither fails the test → adjudicate it, don't widen the list silently.
 * An ADJUDICATED entry that no longer derives also fails → delete it (ratchet down).
 *
 * The mirror shape (STRENGTHEN a muscle another finding marks tight) is deliberately NOT
 * gated: "tight" and "strong" are not synonyms, and resistance work through range does not
 * shorten tissue (Alizadeh 2023, Adv Sports Med; Czaprowski 2018 PMC5836359 cautions
 * explicitly against inferring muscle function from postural length). Gating it would strip
 * the indicated hamstring and gluteus-medius strengthening from the clients who need it.
 */

/** Keys for which muscle M carries a scored link of the given role. */
function keysWhereRole(muscleSlug: string, role: 'tight' | 'weak'): string[] {
  const m = ALL_MUSCLES.find((x) => x.slug === muscleSlug)
  if (!m) return []
  return m.links.filter((l) => l.scored !== false && l.role === role).map((l) => l.imbalanceKey)
}

/** Pairs of the form `${exerciseSlug} × ${contradictingKey}`. */
function derivePairs(): string[] {
  const pairs: string[] = []
  for (const ex of ALL_EXERCISES) {
    if (ex.category === 'informational') continue
    for (const target of ex.muscles ?? []) {
      if (target.role !== 'stretch') continue
      const tightFor = keysWhereRole(target.muscleSlug, 'tight')
      const weakFor = keysWhereRole(target.muscleSlug, 'weak')
      for (const k of ex.primaryDeviationKeys) {
        if (!tightFor.includes(k)) continue
        for (const k2 of weakFor) {
          if (k2 === k) continue // same-key tight+weak = unmodelled laterality, not a cross-finding conflict
          pairs.push(`${ex.slug} × ${k2}`)
        }
      }
    }
  }
  return [...new Set(pairs)].sort()
}

/**
 * Reviewed and deliberately NOT encoded as contraindications. Each needs a reason.
 * Adding an entry here is a clinical decision, not a way to silence the gate.
 */
const ADJUDICATED: Record<string, string> = {
  // gluteus-medius carries BOTH tight (low) and weak (high) links for pelvic_obliquity
  // itself — the high-hip vs low-hip sides of an obliquity. The link schema has no `side`,
  // so the model cannot establish that the side being stretched is the side the knee
  // finding infers weak. Indeterminate, not cleared: do not auto-veto, do not auto-offer
  // bilaterally. Revisit once muscle links carry laterality.
  'supine-crossover-stretch × genu_varum_valgum_left':
    'gluteus-medius laterality not modelled — cannot resolve which side is lengthened',
  'supine-crossover-stretch × genu_varum_valgum_right':
    'gluteus-medius laterality not modelled — cannot resolve which side is lengthened',
}

/** Pairs actually encoded in content as contraindications. */
function encodedPairs(): string[] {
  const pairs: string[] = []
  for (const ex of ALL_EXERCISES) {
    for (const k of ex.contraindicatedDeviationKeys ?? []) pairs.push(`${ex.slug} × ${k}`)
  }
  return pairs.sort()
}

describe('cross-finding contraindication gate', () => {
  const derived = derivePairs()
  const encoded = new Set(encodedPairs())
  const adjudicated = new Set(Object.keys(ADJUDICATED))

  it('derives the known stretch-an-already-lengthened-muscle pairs', () => {
    // Pins the sweep itself: if this changes, the content model changed under us.
    expect(derived).toEqual([
      'seated-hamstring-stretch × knee_extension_back_knee',
      'supine-crossover-stretch × genu_varum_valgum_left',
      'supine-crossover-stretch × genu_varum_valgum_right',
    ])
  })

  it('leaves no derived pair unadjudicated', () => {
    const unhandled = derived.filter((p) => !encoded.has(p) && !adjudicated.has(p))
    expect(unhandled).toEqual([])
  })

  it('encodes the hamstring contraindication', () => {
    expect(encoded.has('seated-hamstring-stretch × knee_extension_back_knee')).toBe(true)
  })

  it('has no stale ADJUDICATED entries (ratchet down)', () => {
    const stale = [...adjudicated].filter((p) => !derived.includes(p))
    expect(stale).toEqual([])
  })

  it('never lists a key as both an indication and a contraindication', () => {
    const conflicts: string[] = []
    for (const ex of ALL_EXERCISES) {
      for (const k of ex.contraindicatedDeviationKeys ?? []) {
        if ((ex.primaryDeviationKeys as readonly string[]).includes(k)) conflicts.push(`${ex.slug} × ${k}`)
      }
    }
    expect(conflicts).toEqual([])
  })
})
