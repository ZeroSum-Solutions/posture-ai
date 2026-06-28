// app/assessments/[id]/muscleMap.ts
// Muscle → body-map coordinate resolution. Pure (no React/Next imports) so it
// is unit-testable in the node vitest environment.
//
// PR1 (Wave 4) adds a slug-keyed marker path alongside the legacy name-keyed
// one. Legacy name arrays stay the ACTIVE marker source for existing
// assessments; the slug/link path only takes effect when a role's legacy array
// is empty (no seeded data produces that today), so PR1 is invisible in prod.
// See docs/plans/2026-06-28-wave4-honest-muscle-map-design.md (PR1) and the
// reviewed legacy-name → slug contract in
// docs/plans/2026-06-12-p4a-muscle-slug-mapping.md.

export interface MuscleRegion {
  view: 'front' | 'back'
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface MuscleLink {
  slug: string
  name: string
}

export interface MarkerInput {
  tightMuscles: string[]
  weakMuscles: string[]
  tightLinks?: MuscleLink[]
  weakLinks?: MuscleLink[]
}

export interface ResolvedMarker {
  source: string
  region: MuscleRegion
}

export interface ResolvedMarkers {
  frontTight: ResolvedMarker[]
  frontWeak: ResolvedMarker[]
  backTight: ResolvedMarker[]
  backWeak: ResolvedMarker[]
  hasAny: boolean
}

// Legacy name-keyed coordinates (viewBox 0 0 80 180). VERBATIM from page.tsx.
const MUSCLE_REGIONS: Record<string, MuscleRegion> = {
  'suboccipitals': { view: 'back', cx: 40, cy: 8, rx: 9, ry: 5 },
  'upper trapezius': { view: 'back', cx: 40, cy: 20, rx: 22, ry: 8 },
  'levator scapulae': { view: 'back', cx: 34, cy: 14, rx: 8, ry: 7 },
  'sternocleidomastoid': { view: 'front', cx: 36, cy: 15, rx: 6, ry: 7 },
  'deep cervical flexors': { view: 'front', cx: 40, cy: 14, rx: 10, ry: 5 },
  'lower trapezius': { view: 'back', cx: 40, cy: 54, rx: 16, ry: 7 },
  'middle trapezius': { view: 'back', cx: 40, cy: 40, rx: 18, ry: 7 },
  'pectoralis major': { view: 'front', cx: 40, cy: 36, rx: 20, ry: 11 },
  'pectoralis minor': { view: 'front', cx: 40, cy: 30, rx: 13, ry: 8 },
  'anterior deltoid': { view: 'front', cx: 22, cy: 28, rx: 7, ry: 8 },
  'rhomboids': { view: 'back', cx: 40, cy: 43, rx: 10, ry: 10 },
  'serratus anterior': { view: 'front', cx: 26, cy: 52, rx: 7, ry: 12 },
  'thoracic erector spinae': { view: 'back', cx: 40, cy: 48, rx: 5, ry: 18 },
  'latissimus dorsi': { view: 'back', cx: 40, cy: 62, rx: 22, ry: 14 },
  'deep thoracic flexors': { view: 'front', cx: 40, cy: 42, rx: 14, ry: 10 },
  'abdominals': { view: 'front', cx: 40, cy: 66, rx: 13, ry: 18 },
  'hip flexors': { view: 'front', cx: 40, cy: 93, rx: 16, ry: 7 },
  'lumbar erector spinae': { view: 'back', cx: 40, cy: 76, rx: 5, ry: 12 },
  'gastrocnemius': { view: 'back', cx: 40, cy: 153, rx: 10, ry: 15 },
  'gluteals': { view: 'back', cx: 40, cy: 93, rx: 20, ry: 11 },
  'hamstrings': { view: 'back', cx: 40, cy: 118, rx: 12, ry: 21 },
  'gluteus medius': { view: 'back', cx: 40, cy: 86, rx: 14, ry: 7 },
  'tensor fasciae latae': { view: 'front', cx: 20, cy: 97, rx: 7, ry: 10 },
  'quadratus lumborum': { view: 'back', cx: 40, cy: 75, rx: 14, ry: 7 },
  'quadriceps': { view: 'front', cx: 40, cy: 116, rx: 20, ry: 20 },
  'vastus medialis (vmo)': { view: 'front', cx: 40, cy: 140, rx: 13, ry: 7 },
  'adductors': { view: 'front', cx: 40, cy: 120, rx: 9, ry: 16 },
  'obliques': { view: 'front', cx: 40, cy: 66, rx: 18, ry: 13 },
  'one-side hip rotators': { view: 'back', cx: 40, cy: 91, rx: 14, ry: 10 },
  'it band': { view: 'front', cx: 20, cy: 116, rx: 5, ry: 20 },
  'popliteus': { view: 'back', cx: 40, cy: 136, rx: 8, ry: 6 },
}

export function normalizeMuscle(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\([^)]*\)/g, '').trim()
}

export function getMuscleRegion(name: string): MuscleRegion | null {
  const key = normalizeMuscle(name)
  if (MUSCLE_REGIONS[key]) return MUSCLE_REGIONS[key]
  for (const [k, v] of Object.entries(MUSCLE_REGIONS)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return null
}

// Legacy display name (normalized) → canonical muscle slug.
// Authority: docs/plans/2026-06-12-p4a-muscle-slug-mapping.md (reviewed contract).
// Keys are normalizeMuscle() outputs (lowercased, parentheticals stripped).
export const LEGACY_NAME_TO_SLUG: Record<string, string> = {
  'suboccipitals': 'suboccipitals',
  'upper trapezius': 'upper-trapezius',
  'levator scapulae': 'levator-scapulae',
  'sternocleidomastoid': 'sternocleidomastoid',
  'deep cervical flexors': 'deep-cervical-flexors',
  'lower trapezius': 'lower-trapezius',
  'middle trapezius': 'middle-trapezius',
  'pectoralis major': 'pectoralis-major',
  'pectoralis minor': 'pectoralis-minor',
  'anterior deltoid': 'anterior-deltoid',
  'rhomboids': 'rhomboids',
  'serratus anterior': 'serratus-anterior',
  'thoracic erector spinae': 'thoracic-erector-spinae',
  'latissimus dorsi': 'latissimus-dorsi',
  'deep thoracic flexors': 'deep-abdominals',
  'abdominals': 'deep-abdominals',
  'hip flexors': 'iliopsoas',
  'lumbar erector spinae': 'lumbar-erector-spinae',
  'gastrocnemius': 'gastrocnemius-soleus',
  'gluteals': 'gluteus-maximus',
  'hamstrings': 'hamstrings',
  'gluteus medius': 'gluteus-medius',
  'tensor fasciae latae': 'tfl-it-band',
  'quadratus lumborum': 'quadratus-lumborum',
  'quadriceps': 'quadriceps',
  'vastus medialis': 'quadriceps',
  'adductors': 'hip-adductors',
  'obliques': 'obliques',
  'one-side hip rotators': 'deep-hip-external-rotators',
  'it band': 'tfl-it-band',
  'popliteus': 'popliteus',
}

// When several legacy names share a slug, only the designated source name sets
// that slug's marker coordinate (documented collision resolution).
const SLUG_COORDINATE_SOURCE: Record<string, string> = {
  'deep-abdominals': 'abdominals', // not 'deep thoracic flexors'
  'tfl-it-band': 'tensor fasciae latae', // not 'it band'
  'quadriceps': 'quadriceps', // not 'vastus medialis (vmo)'
}

// Slug-keyed coordinates, built from MUSCLE_REGIONS via LEGACY_NAME_TO_SLUG.
export const MUSCLE_REGIONS_BY_SLUG: Record<string, MuscleRegion> = (() => {
  const bySlug: Record<string, MuscleRegion> = {}
  for (const [legacyName, region] of Object.entries(MUSCLE_REGIONS)) {
    const norm = normalizeMuscle(legacyName)
    const slug = LEGACY_NAME_TO_SLUG[norm]
    if (!slug) continue
    const source = SLUG_COORDINATE_SOURCE[slug]
    // For a colliding slug, only its designated source name writes the coord.
    if (source && normalizeMuscle(source) !== norm) continue
    bySlug[slug] = region
  }
  return bySlug
})()

export function getMuscleRegionBySlug(slug: string): MuscleRegion | null {
  return MUSCLE_REGIONS_BY_SLUG[slug] ?? null
}

function regionsFromLegacy(names: string[]): ResolvedMarker[] {
  return names
    .map((n) => ({ source: n, region: getMuscleRegion(n) }))
    .filter((x): x is ResolvedMarker => x.region !== null)
}

function regionsFromLinks(links: MuscleLink[]): ResolvedMarker[] {
  return links
    .map((l) => ({ source: l.slug, region: getMuscleRegionBySlug(l.slug) }))
    .filter((x): x is ResolvedMarker => x.region !== null)
}

// Legacy-first per role: a role uses its legacy name array when non-empty, else
// falls back to its normalized links. Existing assessments always carry legacy
// arrays, so the link branch is inert in production (zero visible change).
function regionsForRole(names: string[], links: MuscleLink[]): ResolvedMarker[] {
  return names.length > 0 ? regionsFromLegacy(names) : regionsFromLinks(links)
}

export function resolveMarkerRegions(input: MarkerInput): ResolvedMarkers {
  const tight = regionsForRole(input.tightMuscles, input.tightLinks ?? [])
  const weak = regionsForRole(input.weakMuscles, input.weakLinks ?? [])
  const frontTight = tight.filter((r) => r.region.view === 'front')
  const backTight = tight.filter((r) => r.region.view === 'back')
  const frontWeak = weak.filter((r) => r.region.view === 'front')
  const backWeak = weak.filter((r) => r.region.view === 'back')
  return {
    frontTight,
    frontWeak,
    backTight,
    backWeak,
    hasAny:
      frontTight.length > 0 ||
      frontWeak.length > 0 ||
      backTight.length > 0 ||
      backWeak.length > 0,
  }
}

export function hasAnyMuscle(input: MarkerInput): boolean {
  return (
    input.tightMuscles.length > 0 ||
    input.weakMuscles.length > 0 ||
    (input.tightLinks?.length ?? 0) > 0 ||
    (input.weakLinks?.length ?? 0) > 0
  )
}
