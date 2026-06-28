# Wave 4 PR1 — Exact-Neutral Link-Driven Muscle Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the results body-map a slug-keyed, link-driven marker path (and a link-aware "has muscles" gate) without changing one pixel of what production users see, so PR2 can later flip the rendering source to the normalized muscle knowledge base behind the honesty gate.

**Architecture:** Extract the muscle→coordinate logic out of the 1199-line `app/assessments/[id]/page.tsx` into two focused units: a pure, React-free module `muscleMap.ts` (data + resolution functions, unit-tested in the node vitest env) and a `MuscleBodyMap.tsx` component (the SVG, tested under jsdom). The resolver is **legacy-first per role**: a role uses its legacy name array when non-empty, and only falls back to the normalized `muscle_imbalance_links` slugs when that array is empty. Every seeded assessment carries legacy arrays today, so the link path is inert in production — the change ships invisibly. The link path is exercised only by tests in PR1; PR2 makes it the user-facing source.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest 3 (node env default; `@testing-library/react` 16 + jsdom 26 per-file via `// @vitest-environment jsdom`).

## Global Constraints

- **Zero visible change.** For any assessment whose findings carry legacy `tight_muscles`/`weak_muscles` arrays (all seeded data today), the rendered markers, chips, and "Muscle Analysis" accordion must be byte-identical to current production. The link path activates only when a role's legacy array is empty.
- **Engine frozen at 1.2.0.** No scoring-math, threshold, or migration changes in PR1.
- **Legacy-name → slug map is the reviewed P4a contract.** Authority: `docs/plans/2026-06-12-p4a-muscle-slug-mapping.md`. Do not invent mappings; copy them verbatim. Notable: `deep thoracic flexors` → `deep-abdominals` (NOT null), `it band` + `tensor fasciae latae` → `tfl-it-band`, `vastus medialis (vmo)` → `quadriceps`, `gluteals` → `gluteus-maximus`, `hip flexors` → `iliopsoas`, `one-side hip rotators` → `deep-hip-external-rotators`.
- **`rectus-femoris` is the one linkable slug with no coordinate** (it has no legacy `MUSCLE_REGIONS` entry; reconciliation migration added it granularly). It must render as a chip with no marker — never error.
- **TDD.** Every function ships test-first: write the test, watch it fail, minimal impl, watch it pass.
- **Screening-only vocabulary** (hard constraint, unchanged): no `diagnos*`/`treat*`/`cure*`/`patient*`/`prescri*` in any new copy. PR1 adds no user-facing copy.
- **Conventional commits, attribution OFF** (no `Co-Authored-By`).
- **GPT-5.5 adversarial review gate before land:** `codex exec -s read-only -m gpt-5.5 -c model_reasoning_effort="high" -C /Users/zero-suminc./projects/posture-ai - < promptfile`. Fix everything it flags; re-run until clean. No land until clean.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `app/assessments/[id]/muscleMap.ts` | Pure data + resolution: `MUSCLE_REGIONS`, `LEGACY_NAME_TO_SLUG`, `MUSCLE_REGIONS_BY_SLUG`, `normalizeMuscle`, `getMuscleRegion`, `getMuscleRegionBySlug`, `resolveMarkerRegions`, `hasAnyMuscle`. No React/Next imports. | Create |
| `app/assessments/[id]/muscleMap.test.ts` | Node-env unit tests for the above (coverage, collisions, legacy-equivalence, link-fallback, precedence). | Create |
| `app/assessments/[id]/MuscleBodyMap.tsx` | The SVG body-map component, consuming `resolveMarkerRegions`. Markers + chips. | Create (moved out of page.tsx) |
| `app/assessments/[id]/MuscleBodyMap.test.tsx` | jsdom render tests: legacy-only, links-only, empty. | Create |
| `app/assessments/[id]/page.tsx` | Remove the moved code (`MUSCLE_REGIONS`, `normalizeMuscle`, `getMuscleRegion`, `MuscleBodyMap`); import from the new modules; switch `FindingCard.hasMuscles` to `hasAnyMuscle`. | Modify (`:142-189`, `:254-378`, `:653`, `:729-734`) |

`MuscleLink` interface (`{ slug: string; name: string }`) currently lives in `page.tsx:31-34`; it moves to `muscleMap.ts` and is re-imported by `page.tsx`.

---

## Task 1: Pure muscle-map module + unit tests

**Files:**
- Create: `app/assessments/[id]/muscleMap.ts`
- Test: `app/assessments/[id]/muscleMap.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2-4):
  - `interface MuscleRegion { view: 'front' | 'back'; cx: number; cy: number; rx: number; ry: number }`
  - `interface MuscleLink { slug: string; name: string }`
  - `interface MarkerInput { tightMuscles: string[]; weakMuscles: string[]; tightLinks?: MuscleLink[]; weakLinks?: MuscleLink[] }`
  - `interface ResolvedMarker { source: string; region: MuscleRegion }`
  - `interface ResolvedMarkers { frontTight: ResolvedMarker[]; frontWeak: ResolvedMarker[]; backTight: ResolvedMarker[]; backWeak: ResolvedMarker[]; hasAny: boolean }`
  - `MUSCLE_REGIONS: Record<string, MuscleRegion>`
  - `MUSCLE_REGIONS_BY_SLUG: Record<string, MuscleRegion>`
  - `normalizeMuscle(name: string): string`
  - `getMuscleRegion(name: string): MuscleRegion | null`
  - `getMuscleRegionBySlug(slug: string): MuscleRegion | null`
  - `resolveMarkerRegions(input: MarkerInput): ResolvedMarkers`
  - `hasAnyMuscle(input: MarkerInput): boolean`

- [ ] **Step 1: Create the module file.**

Create `app/assessments/[id]/muscleMap.ts`. Copy `MUSCLE_REGIONS`, `normalizeMuscle`, and `getMuscleRegion` verbatim from `page.tsx:144-189` (do not re-key or reorder — byte-for-byte), then add the slug map, the by-slug builder, and the resolvers:

```ts
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
```

- [ ] **Step 2: Write the failing test file.**

Create `app/assessments/[id]/muscleMap.test.ts`:

```ts
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

describe('muscleMap — hasAnyMuscle', () => {
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
```

- [ ] **Step 3: Run the test, verify it fails for the right reason.**

Run: `npx vitest run app/assessments/\[id\]/muscleMap.test.ts`
Expected: FAIL — module `./muscleMap` not found, or (if Step 1 done) all green. If Step 1 is already in place this passes immediately; that is acceptable here because the module is new code with no prior behavior. If any assertion fails, the implementation in Step 1 is wrong — fix `muscleMap.ts`, not the test.

- [ ] **Step 4: Run the test, verify it passes.**

Run: `npx vitest run app/assessments/\[id\]/muscleMap.test.ts`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 5: Typecheck + lint the new file.**

Run: `npx tsc --noEmit && npx eslint app/assessments/\[id\]/muscleMap.ts app/assessments/\[id\]/muscleMap.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add "app/assessments/[id]/muscleMap.ts" "app/assessments/[id]/muscleMap.test.ts"
git commit -m "feat(muscle-map): add pure slug-keyed coordinate resolver"
```

---

## Task 2: Extract MuscleBodyMap into its own component (verbatim move)

This task is a pure refactor: move the component out of `page.tsx` into its own file and point it at the shared `muscleMap.ts` legacy functions. No marker-logic change yet — the golden jsdom smoke test must pass identically.

**Files:**
- Create: `app/assessments/[id]/MuscleBodyMap.tsx`
- Create: `app/assessments/[id]/MuscleBodyMap.test.tsx`
- Modify: `app/assessments/[id]/page.tsx` (remove component body `:254-378`; add import)

**Interfaces:**
- Consumes: `getMuscleRegion`, `MuscleLink` from `./muscleMap` (Task 1)
- Produces: default export `MuscleBodyMap` with props `{ tightMuscles: string[]; weakMuscles: string[]; tightLinks?: MuscleLink[]; weakLinks?: MuscleLink[] }`

- [ ] **Step 1: Create `MuscleBodyMap.tsx` by moving the component verbatim.**

Create `app/assessments/[id]/MuscleBodyMap.tsx`. Move `BodySilhouette` (`page.tsx:192-251`) and `MuscleBodyMap` (`page.tsx:254-378`) verbatim. Replace the inline `MuscleLink` prop type with an import, and import the legacy resolver from `muscleMap`. The marker computation stays exactly as it is in this task (still `getMuscleRegion` over legacy arrays):

```tsx
'use client'
import Link from 'next/link'
import { getMuscleRegion, type MuscleLink } from './muscleMap'

// Schematic body silhouette paths (front and back, viewBox 0 0 80 180)
function BodySilhouette({ view }: { view: 'front' | 'back' }) {
  // ... VERBATIM from page.tsx:192-251 ...
}

export default function MuscleBodyMap({
  tightMuscles,
  weakMuscles,
  tightLinks = [],
  weakLinks = [],
}: {
  tightMuscles: string[]
  weakMuscles: string[]
  tightLinks?: MuscleLink[]
  weakLinks?: MuscleLink[]
}) {
  // ... VERBATIM body from page.tsx:265-377, unchanged ...
}
```

Keep the `item.region!.cx` non-null assertions as-is in this task (they are removed in Task 3 when the resolver changes). Do not alter chip JSX.

- [ ] **Step 2: Write the jsdom smoke test (legacy-only render).**

Create `app/assessments/[id]/MuscleBodyMap.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, cleanup } from '@testing-library/react'
import MuscleBodyMap from './MuscleBodyMap'

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))

afterEach(() => cleanup())

describe('MuscleBodyMap', () => {
  it('renders one ellipse marker per legacy muscle that has a coordinate', () => {
    const { container } = render(
      <MuscleBodyMap tightMuscles={['quadriceps']} weakMuscles={['hamstrings']} />,
    )
    // quadriceps (front) + hamstrings (back) = 2 markers
    expect(container.querySelectorAll('ellipse')).toHaveLength(2)
  })

  it('renders nothing when there are no muscles at all', () => {
    const { container } = render(<MuscleBodyMap tightMuscles={[]} weakMuscles={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('ellipse')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run the test, verify it passes (move did not change behavior).**

Run: `npx vitest run app/assessments/\[id\]/MuscleBodyMap.test.tsx`
Expected: PASS (2 ellipses; null svg when empty). If it fails, the verbatim move introduced a regression — fix the move, not the test.

- [ ] **Step 4: Update `page.tsx` to import the moved component.**

In `app/assessments/[id]/page.tsx`:
- Delete the `BodySilhouette` function (`:192-251`) and the `MuscleBodyMap` function (`:254-378`).
- Add to the import block near the top: `import MuscleBodyMap from './MuscleBodyMap'`
- Leave the call site (`:729-734`) and everything else untouched. Do NOT yet remove `MUSCLE_REGIONS`/`getMuscleRegion`/`normalizeMuscle`/the `MuscleLink` interface from page.tsx — that cleanup is Task 4, after the resolver swap, to keep this task a clean isolated move. (They are now unused by page.tsx but still compile.)

- [ ] **Step 5: Verify build + full suite green.**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: typecheck clean, all tests pass, build succeeds. (Note: `MuscleLink`/`MUSCLE_REGIONS` in page.tsx may now trigger `no-unused-vars` lint — if eslint fails on those, proceed to Task 4 which removes them; do not silence with disables.)

- [ ] **Step 6: Commit.**

```bash
git add "app/assessments/[id]/MuscleBodyMap.tsx" "app/assessments/[id]/MuscleBodyMap.test.tsx" "app/assessments/[id]/page.tsx"
git commit -m "refactor(muscle-map): extract MuscleBodyMap into its own component"
```

---

## Task 3: Wire the link-driven marker path into MuscleBodyMap (TDD)

**Files:**
- Modify: `app/assessments/[id]/MuscleBodyMap.tsx` (marker computation)
- Modify: `app/assessments/[id]/MuscleBodyMap.test.tsx` (add links-only test)

**Interfaces:**
- Consumes: `resolveMarkerRegions` from `./muscleMap` (Task 1)

- [ ] **Step 1: Write the failing links-only test.**

Add to `app/assessments/[id]/MuscleBodyMap.test.tsx`:

```tsx
  it('renders markers from links when legacy arrays are empty', () => {
    const { container } = render(
      <MuscleBodyMap
        tightMuscles={[]}
        weakMuscles={[]}
        tightLinks={[{ slug: 'tfl-it-band', name: 'TFL & IT Band' }]}
        weakLinks={[{ slug: 'gluteus-medius', name: 'Gluteus Medius' }]}
      />,
    )
    // tfl-it-band (front) + gluteus-medius (back) = 2 markers
    expect(container.querySelectorAll('ellipse')).toHaveLength(2)
  })
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `npx vitest run app/assessments/\[id\]/MuscleBodyMap.test.tsx -t "from links"`
Expected: FAIL — 0 ellipses (current markers come only from legacy arrays via `getMuscleRegion`). This is Blocker 3 reproduced at the component boundary.

- [ ] **Step 3: Swap the marker computation to the resolver.**

In `app/assessments/[id]/MuscleBodyMap.tsx`, change the import and replace the marker-derivation block (the verbatim `tightRegions`/`weakRegions`/`front*`/`back*`/`hasAny` lines from the original `page.tsx:266-275`) with the resolver call:

```tsx
import Link from 'next/link'
import { resolveMarkerRegions, type MuscleLink } from './muscleMap'
```

```tsx
  const { frontTight, frontWeak, backTight, backWeak, hasAny } = resolveMarkerRegions({
    tightMuscles,
    weakMuscles,
    tightLinks,
    weakLinks,
  })

  if (!hasAny) return null
```

Then update the four `.map` blocks so the marker accessor is `item.region.cx` (drop the `!` — `ResolvedMarker.region` is non-null), e.g.:

```tsx
            {frontTight.map((item, i) => (
              <ellipse
                key={'ft-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="#EF444440" stroke="#EF4444" strokeWidth="1.2"
              />
            ))}
```

Apply the same `item.region.` change to the `frontWeak`, `backTight`, and `backWeak` maps. Leave the view-guard conditionals (`frontTight.length > 0 || frontWeak.length > 0`, etc.) and the chip JSX unchanged.

- [ ] **Step 4: Run the test, verify all MuscleBodyMap tests pass.**

Run: `npx vitest run app/assessments/\[id\]/MuscleBodyMap.test.tsx`
Expected: PASS — legacy-only (2), empty (null), links-only (2) all green.

- [ ] **Step 5: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean (no leftover `region!` non-null assertions).

- [ ] **Step 6: Commit.**

```bash
git add "app/assessments/[id]/MuscleBodyMap.tsx" "app/assessments/[id]/MuscleBodyMap.test.tsx"
git commit -m "feat(muscle-map): render markers from links when legacy arrays are empty"
```

---

## Task 4: Make the accordion gate link-aware + remove page.tsx orphans

**Files:**
- Modify: `app/assessments/[id]/page.tsx` (`:653` gate; remove orphaned `:31-34`, `:144-189`)
- Modify: `app/assessments/[id]/muscleMap.test.ts` is unchanged; behavior covered by `hasAnyMuscle` tests from Task 1.

**Interfaces:**
- Consumes: `hasAnyMuscle` from `./muscleMap` (Task 1)

- [ ] **Step 1: Write a failing test for the link-aware gate decision.**

The gate is a one-line boolean in `FindingCard`; its logic is `hasAnyMuscle`, already unit-tested in Task 1. Add one explicit regression test naming the current bug (gate ignores links) to `app/assessments/[id]/muscleMap.test.ts`:

```ts
describe('muscleMap — accordion gate (FindingCard.hasMuscles uses this)', () => {
  it('opens the Muscle Analysis section when only links are present', () => {
    // Pre-PR1 the gate read legacy arrays only; a links-only finding stayed closed.
    expect(
      hasAnyMuscle({ tightMuscles: [], weakMuscles: [], tightLinks: [{ slug: 'hamstrings', name: 'Hamstrings' }], weakLinks: [] }),
    ).toBe(true)
  })
})
```

Run: `npx vitest run app/assessments/\[id\]/muscleMap.test.ts -t "accordion gate"`
Expected: PASS (Task 1 already implements `hasAnyMuscle`). This documents the behavior the page wiring must adopt.

- [ ] **Step 2: Switch the gate and import in page.tsx.**

In `app/assessments/[id]/page.tsx`:
- Add `hasAnyMuscle` to the muscleMap import: `import MuscleBodyMap from './MuscleBodyMap'` stays; add `import { hasAnyMuscle } from './muscleMap'`.
- Replace line 653:

```tsx
  const hasMuscles = (f.tight_muscles && f.tight_muscles.length > 0) || (f.weak_muscles && f.weak_muscles.length > 0)
```

with:

```tsx
  const hasMuscles = hasAnyMuscle({
    tightMuscles: f.tight_muscles ?? [],
    weakMuscles: f.weak_muscles ?? [],
    tightLinks: f.tight_muscle_links ?? [],
    weakLinks: f.weak_muscle_links ?? [],
  })
```

- [ ] **Step 3: Remove the now-orphaned code from page.tsx.**

Delete from `app/assessments/[id]/page.tsx` (made unused by Tasks 2-4):
- The `MuscleLink` interface (`:31-34`) — now imported. Replace its uses in the `Finding` interface (`:27-28`) by adding `import type { MuscleLink } from './muscleMap'` to the top import block.
- The `MUSCLE_REGIONS` const (`:144-176`), `normalizeMuscle` (`:178-180`), and `getMuscleRegion` (`:182-189`) — now live in `muscleMap.ts` and have no remaining references in page.tsx.

Confirm no other references remain:

Run: `grep -n "MUSCLE_REGIONS\|getMuscleRegion\|normalizeMuscle\|interface MuscleLink" "app/assessments/[id]/page.tsx"`
Expected: no matches (only the `import type { MuscleLink }` line, which the grep pattern above does not match).

- [ ] **Step 4: Full green gate.**

Run: `npx tsc --noEmit && npx eslint "app/assessments/[id]" && npx vitest run && npx next build`
Expected: typecheck clean, lint clean (no unused-vars), all tests pass, build succeeds.

- [ ] **Step 5: Manual zero-visible-change spot check.**

Run the app locally (`npx supabase start && npm run dev`), open an existing assessment with seeded findings, expand "Muscle Analysis" on 2-3 findings across regions (e.g. forward_head_posture, knee_extension_back_knee, genu_varum_valgum_left). Confirm the markers, chips, and accordion behavior are visually identical to `main`. (Legacy arrays drive everything; this is a guard, not a code change.)

- [ ] **Step 6: Commit.**

```bash
git add "app/assessments/[id]/page.tsx" "app/assessments/[id]/muscleMap.test.ts"
git commit -m "feat(muscle-map): gate Muscle Analysis on links too; drop page.tsx duplicates"
```

---

## Task 5: Verification gate + GPT-5.5 adversarial review + land

**Files:** none (process task).

- [ ] **Step 1: Full local verification.**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npx next build`
Expected: all green.

- [ ] **Step 2: Author the GPT-5.5 review prompt.**

Write `/private/tmp/claude-501/-Users-zero-suminc-/590842a6-f8e4-4eb5-91ba-daaeefbe330e/scratchpad/wave4-pr1-review.md` stating: the PR1 goal (zero-visible-change link-driven map refactor), the diff summary (new `muscleMap.ts` + `MuscleBodyMap.tsx`, page.tsx slimming, link-aware gate), and the acceptance contract (legacy stays active source; link path test-only; `deep thoracic flexors`→`deep-abdominals`; `rectus-femoris` no-coordinate; 3 documented collisions). Ask it to adversarially verify, grounded in the actual files: (a) is the legacy render path provably unchanged for all 10 keys? (b) does any production data path have an empty legacy array with non-empty links (which would make PR1 visible)? (c) is the slug map faithful to the P4a contract and the seed? (d) are the tests capable of catching a regression, or do they assert tautologies? Require `[CONFIRM]`/`[DISAGREE]` tags and a final `SHIP` or `BLOCK + numbered deltas`.

- [ ] **Step 3: Run the review (background).**

Run: `codex exec -s read-only -m gpt-5.5 -c model_reasoning_effort="high" -C /Users/zero-suminc./projects/posture-ai - < /private/tmp/claude-501/-Users-zero-suminc-/590842a6-f8e4-4eb5-91ba-daaeefbe330e/scratchpad/wave4-pr1-review.md`
Expected: a verdict. If `BLOCK`, fix each delta (confirm in code first — its critiques have been legitimate), re-run from Step 1. **Do not proceed until `SHIP`.**

- [ ] **Step 4: Land.**

Once GPT-5.5 returns `SHIP` and the full gate is green:

Run: `~/bin/zs-land`
Expected: pushes the branch, opens a PR (summary + test plan), squash-merges (owner `wiggdevin` ∈ `ZS_LAND_OWNERS`), deletes the branch, syncs `main`.

---

## Self-Review

**1. Spec coverage (PR1 section of `2026-06-28-wave4-honest-muscle-map-design.md`):**
- "Build `MUSCLE_REGIONS_BY_SLUG` from an explicit, tested `legacy-name → slug` map" → Task 1 (`LEGACY_NAME_TO_SLUG` + `MUSCLE_REGIONS_BY_SLUG` + collision/coverage tests). ✓
- "incl. `tensor fasciae latae`→`tfl-it-band`, `vastus medialis (vmo)`→`quadriceps`, `gastrocnemius`→`gastrocnemius-soleus`" → all present in `LEGACY_NAME_TO_SLUG`; collisions documented. ✓
- "`MuscleBodyMap` gains a slug-keyed link-driven marker path and link-aware `hasMuscles`/`hasAny`" → Task 3 (markers) + Task 4 (`hasMuscles` via `hasAnyMuscle`); `hasAny` is inside `resolveMarkerRegions`. ✓
- "legacy arrays remain the ACTIVE source for existing assessments; the link path is exercised by tests only" → `regionsForRole` legacy-first; Global Constraints; Task 4 Step 5 manual check. ✓
- "Zero visible change" → Task 2 verbatim move + golden smoke test; Task 3 only adds an empty-legacy branch; Task 4 manual spot check. ✓
- Acceptance "byte-identical for all 10 keys; route-level test proves markers CAN render from `muscle_imbalance_links` with EMPTY legacy arrays; accordion opens on links-only" → legacy-equivalence test (Task 1) + links-only render test (Task 3) + accordion-gate test (Task 4). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; the two verbatim moves explicitly cite the source line ranges to copy. ✓

**3. Type consistency:** `MuscleLink`, `MarkerInput`, `ResolvedMarker`, `ResolvedMarkers`, `resolveMarkerRegions`, `getMuscleRegionBySlug`, `hasAnyMuscle` are defined once in Task 1 and consumed with identical signatures in Tasks 2-4. `MuscleBodyMap` default export consumed at `page.tsx:729`. ✓

**Known intentional exceptions (documented, not gaps):** `rectus-femoris` has no coordinate (chip-only); `deep thoracic flexors` and `it band` and `vastus medialis` are the non-primary members of the 3 slug collisions and intentionally do not set their slug's coordinate.
