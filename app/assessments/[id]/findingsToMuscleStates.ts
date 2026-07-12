// Pure, framework-free adapter: posture-ai assessment findings → muscle-viewer
// `applyMuscleStates` inputs. No React/Next imports, so it runs in the node vitest
// env and can move into a shared package when mobile reuses it.
//
// The viewer's own `fromMuscleStates` owns slug→id / role→color / severity→intensity.
// This adapter only SHAPES the data: reliability filter, legacy-name fallback, severity
// sanitization, per-slug dedup + tight/weak conflict collapse, and honest coverage notes.

import { COORDINATE_NAME_TO_SLUG, normalizeMuscle, type MuscleLink } from './muscleMap'
import manifest from './muscleIds.generated.json'

export type Role = 'tight' | 'weak'

/** Matches the muscle-viewer MuscleStateInput contract. Side omitted ⇒ bilateral. */
export interface MuscleStateInput {
  slug: string
  role: Role
  severity?: number
  side?: 'left' | 'right' | 'both'
  confidence?: 'high' | 'medium' | 'low'
}

/** Structural subset of the results-page `Finding` this adapter reads. */
export interface AssessmentFinding {
  zone: string
  severity_pct: number
  direction?: string
  imbalance_key?: string
  tight_muscles?: string[]
  weak_muscles?: string[]
  tight_muscle_links?: MuscleLink[]
  weak_muscle_links?: MuscleLink[]
}

export interface MuscleStatesResult {
  /** Ready to hand to window.muscleViewer.applyMuscleStates(...). */
  states: MuscleStateInput[]
  /** Emitted muscles no viewer id renders (+ unresolved legacy names) — surfaced, not hidden. */
  notShown: MuscleLink[]
  /** Muscles that were both tight and weak across findings and collapsed to one color. */
  collapsedConflicts: MuscleLink[]
}

const VIEWER_IDS = new Set<string>(manifest.ids as string[])
const VIEWER_ALIASES = manifest.aliases as Record<string, string>

/** Mirror of the viewer's slugToMuscleId: alias first, else hyphen→underscore, else null. */
export function slugToViewerId(slug: string): string | null {
  if (!slug) return null
  const alias = VIEWER_ALIASES[slug]
  if (alias) return VIEWER_IDS.has(alias) ? alias : null
  const id = slug.replace(/-/g, '_')
  return VIEWER_IDS.has(id) ? id : null
}

// Resolve a legacy muscle NAME to a posture-ai slug, mirroring the 2D map's getMuscleRegion
// (exact normalized key, then substring fallback) so the 3D colors the SAME muscles the 2D map
// does for legacy seed-string variants like "opposite gluteus medius" or
// "lateral structures (varum) or adductors (valgum)". Kept in lockstep with muscleMap.ts.
function legacyNameToSlug(name: string): string | null {
  const key = normalizeMuscle(name)
  const exact = COORDINATE_NAME_TO_SLUG[key]
  if (exact) return exact
  for (const [coordName, slug] of Object.entries(COORDINATE_NAME_TO_SLUG)) {
    if (key.includes(coordName) || coordName.includes(key)) return slug
  }
  return null
}

// Clamp a raw severity_pct to finite 0..100; non-finite (null / NaN / non-number) → undefined
// so the viewer applies its documented default intensity (2). Explicit, not implicit coercion.
function sanitizeSeverity(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.min(100, Math.max(0, raw))
    : undefined
}

// Rank for max/conflict comparisons: a real (finite) severity always outranks an unknown one,
// so missing data (null/NaN severity) can never win a same-role max — or flip a muscle's color
// in a tight-vs-weak conflict — over a genuinely quantified signal.
const rank = (s: number | undefined): number => s ?? -1

const ROLES: Role[] = ['tight', 'weak']

const CONF_RANK = { high: 3, medium: 2, low: 1 } as const
const higherConf = (a?: 'high' | 'medium' | 'low', b?: 'high' | 'medium' | 'low') =>
  !a ? b : !b ? a : (CONF_RANK[a] >= CONF_RANK[b] ? a : b)

interface Candidate {
  slug: string
  name: string
  role: Role
  severity?: number
  confidence?: 'high' | 'medium' | 'low'
}

export function findingsToMuscleStates(
  findings: AssessmentFinding[] | null | undefined,
): MuscleStatesResult {
  const candidates: Candidate[] = []
  const legacyUnresolved: MuscleLink[] = []

  for (const f of findings ?? []) {
    // Skip non-actionable zones: 'unreliable' (low signal) and 'maintain' (within
    // normal range). Both count as non-actionable everywhere else (selectPriorities,
    // buildProgram), so the 3D map must not paint them as imbalances.
    if (!f || f.zone === 'unreliable' || f.zone === 'maintain') continue
    const severity = sanitizeSeverity(f.severity_pct)
    for (const role of ROLES) {
      const links = role === 'tight' ? f.tight_muscle_links : f.weak_muscle_links
      const names = role === 'tight' ? f.tight_muscles : f.weak_muscles
      if (links && links.length > 0) {
        for (const l of links) {
          if (l?.slug) candidates.push({ slug: l.slug, name: l.name ?? l.slug, role, severity, confidence: l.confidence })
        }
      } else if (names && names.length > 0) {
        // Legacy JSONB names (populated until the muscle KB is seeded). Resolving them keeps
        // the 3D in lockstep with the 2D map, which uses the same source. Unresolvable
        // catch-alls (e.g. the genu "lateral structures … or adductors …" string) surface
        // in notShown instead of silently vanishing.
        //
        // TODO(genu-direction): once muscle_imbalance_links.direction_applicability is
        // populated + selected by the API, gate genu varum/valgum muscles here (AND in
        // muscleMap) by f.direction. v1 deliberately mirrors the 2D map's over-coloring.
        for (const name of names) {
          const slug = legacyNameToSlug(name)
          if (slug) candidates.push({ slug, name, role, severity })
          else legacyUnresolved.push({ slug: '', name })
        }
      }
    }
  }

  // Dedup by slug (side omitted ⇒ every entry is bilateral, so the viewer's `${muscle}:${side}`
  // last-write-wins collapses to per-slug anyway — we control the collapse deterministically).
  const bySlug = new Map<string, Candidate[]>()
  const order: string[] = []
  for (const c of candidates) {
    const group = bySlug.get(c.slug)
    if (group) group.push(c)
    else {
      bySlug.set(c.slug, [c])
      order.push(c.slug)
    }
  }

  const states: MuscleStateInput[] = []
  const collapsedConflicts: MuscleLink[] = []
  const notShown: MuscleLink[] = []

  for (const slug of order) {
    const group = bySlug.get(slug)!
    const best = (role: Role): Candidate | null =>
      group
        .filter((c) => c.role === role)
        .reduce<Candidate | null>(
          (a, c) => (a && rank(a.severity) >= rank(c.severity) ? a : c),
          null,
        )
    const bestTight = best('tight')
    const bestWeak = best('weak')

    let winner: Candidate
    if (bestTight && bestWeak) {
      // tight-vs-weak conflict: higher severity wins; tie → tight (the actionable "release" cue).
      winner = rank(bestTight.severity) >= rank(bestWeak.severity) ? bestTight : bestWeak
      collapsedConflicts.push({ slug, name: winner.name })
    } else {
      winner = (bestTight ?? bestWeak)!
    }

    // Confidence must reflect the WINNING role's evidence, not the max across both roles.
    // A muscle can carry a low-confidence tight link AND a high-confidence weak link
    // (e.g. gluteus-medius / pelvic_obliquity). If tight wins by severity, borrowing the
    // losing weak link's high confidence would paint a low-evidence signal at high intensity.
    const winnerConf = group
      .filter((c) => c.role === winner.role)
      .reduce<'high' | 'medium' | 'low' | undefined>((acc, c) => higherConf(acc, c.confidence), undefined)
    states.push({ slug, role: winner.role, severity: winner.severity, confidence: winnerConf })
    if (!slugToViewerId(slug)) notShown.push({ slug, name: winner.name })
  }

  for (const u of legacyUnresolved) notShown.push(u)

  return { states, notShown, collapsedConflicts }
}
