import { describe, it, expect } from 'vitest'
import { MUSCLE_REGISTRY } from '@/content/muscles/registry'
import { slugToViewerId } from './findingsToMuscleStates'
import { resolveMarkerRegions } from './muscleMap'

// Guardrail: every muscle slug posture-ai can attach to a finding must resolve to a 3D viewer
// id, or be an explicit known exception. This and the adapter resolve slugs through the SAME
// copied manifest (muscleIds.generated.json), so they cannot drift from EACH OTHER. Freshness
// of that manifest vs the actual viewer build is enforced separately in muscleViewerBuild.test.ts
// (matches the copied build always; matches the sibling viewer build when checked out).
//
// If this fails, a content slug was added/renamed that the viewer has no id for: either add
// the muscle (or an alias) to the viewer and re-sync, or add the slug to KNOWN_UNMAPPED with a
// reason. Do NOT let it drop silently — an un-rendered muscle would just vanish from the 3D.
const KNOWN_UNMAPPED: ReadonlySet<string> = new Set([])

describe('muscleMap — links-first + possible-involvement tier', () => {
  it('is links-first: uses graded links over legacy name strings when links present', () => {
    const r = resolveMarkerRegions({
      tightMuscles: ['suboccipitals'],       // legacy name (would render if legacy-first)
      weakMuscles: [],
      tightLinks: [{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'high' }],
      weakLinks: [],
    })
    const sources = [...r.frontTight, ...r.backTight].map(m => m.source)
    expect(sources).toContain('latissimus-dorsi')   // link won
    expect(sources).not.toContain('suboccipitals')  // legacy ignored
  })

  it('routes low-confidence links to possible-involvement, not tight/weak', () => {
    const r = resolveMarkerRegions({
      tightMuscles: [], weakMuscles: [],
      tightLinks: [{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'low' }],
      weakLinks: [],
    })
    expect([...r.frontPossible, ...r.backPossible].map(m => m.source)).toContain('latissimus-dorsi')
    expect([...r.frontTight, ...r.backTight]).toHaveLength(0)
  })

  it('keeps high/medium links in their role bucket', () => {
    const r = resolveMarkerRegions({
      tightMuscles: [], weakMuscles: [],
      tightLinks: [{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'high' }],
      weakLinks: [],
    })
    expect([...r.frontTight, ...r.backTight].map(m => m.source)).toContain('latissimus-dorsi')
    expect([...r.frontPossible, ...r.backPossible]).toHaveLength(0)
  })
})

describe('muscle 3D coverage', () => {
  it('every posture-ai content slug maps to a viewer id (or is a known exception)', () => {
    const unmapped: string[] = []
    for (const { slug } of MUSCLE_REGISTRY) {
      if (KNOWN_UNMAPPED.has(slug)) continue
      if (slugToViewerId(slug) === null) unmapped.push(slug)
    }
    expect(unmapped, `slugs with no viewer id: ${unmapped.join(', ')}`).toEqual([])
  })

  it('KNOWN_UNMAPPED contains only real content slugs (no stale entries)', () => {
    const all = new Set(MUSCLE_REGISTRY.map((m) => m.slug))
    for (const s of KNOWN_UNMAPPED) expect(all.has(s), `stale KNOWN_UNMAPPED: ${s}`).toBe(true)
  })
})
