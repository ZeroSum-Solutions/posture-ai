import { describe, it, expect } from 'vitest'
import { MUSCLE_REGISTRY } from '@/content/muscles/registry'
import { slugToViewerId } from './findingsToMuscleStates'

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
