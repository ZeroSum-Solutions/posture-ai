// Pure, framework-free adapter: posture-ai assessment findings → muscle-viewer
// `applyMuscleStates` inputs. No React/Next imports, so it runs in the node vitest
// env and can move into a shared package when mobile reuses it.
//
// The viewer's own `fromMuscleStates` owns slug→id / role→color / severity→intensity.
// This adapter only SHAPES the data: reliability filter, legacy-name fallback, severity
// sanitization, per-(slug,side) dedup + tight/weak conflict collapse, subject left/right
// laterality resolution, and honest coverage notes.

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

type Side = 'left' | 'right' | 'both'

// The only imbalance keys whose `direction` carries a 'Level' | 'Left Low' | 'Right Low'
// vocabulary (see packages/posture-engine/src/metrics.ts). A link's authored side
// ('elevated' | 'lowered') is only meaningful for these keys.
const LATERAL_IMBALANCE_KEYS = new Set<string>([
  'anterior_imbalanced_shoulders',
  'posterior_imbalanced_shoulders',
  'pelvic_obliquity',
])

// Resolve one candidate's SUBJECT side (left/right/both) from its imbalance key, the
// finding's direction, and the link's own authored side.
//   - genu_varum_valgum_left/_right: the key suffix IS the side, regardless of linkSide.
//   - Any other key not in LATERAL_IMBALANCE_KEYS: always bilateral (sagittal/global).
//   - A lateral key with no linkSide (or 'both'), or a direction that isn't 'Left Low' /
//     'Right Low' (e.g. 'Level', or missing): bilateral — content or engine gave no basis
//     to pick a side.
//   - Otherwise: 'Left Low' means the subject's LEFT side is lower, so the RIGHT side is
//     elevated (and vice versa for 'Right Low'); linkSide picks the elevated or lowered
//     side accordingly.
function resolveCandidateSide(
  imbalanceKey: string | undefined,
  direction: string | undefined,
  linkSide: 'elevated' | 'lowered' | 'both' | undefined,
): Side {
  if (imbalanceKey === 'genu_varum_valgum_left') return 'left'
  if (imbalanceKey === 'genu_varum_valgum_right') return 'right'
  if (!imbalanceKey || !LATERAL_IMBALANCE_KEYS.has(imbalanceKey)) return 'both'
  if (!linkSide || linkSide === 'both') return 'both'
  if (direction !== 'Left Low' && direction !== 'Right Low') return 'both'
  const elevatedSide: 'left' | 'right' = direction === 'Left Low' ? 'right' : 'left'
  const loweredSide: 'left' | 'right' = elevatedSide === 'left' ? 'right' : 'left'
  return linkSide === 'elevated' ? elevatedSide : loweredSide
}

interface Candidate {
  slug: string
  name: string
  role: Role
  severity?: number
  confidence?: 'high' | 'medium' | 'low'
  side: Side
}

interface SideWinner {
  role: Role
  severity?: number
  confidence?: 'high' | 'medium' | 'low'
  name: string
  collapsed: boolean
}

// Resolve the winning role for ONE subject side from a slug's full candidate group —
// filtering to candidates that apply to that side ('both' applies to every side) — using
// the same max-severity / tight-vs-weak-conflict rules as before, scoped per side.
function winnerForSide(group: Candidate[], side: 'left' | 'right'): SideWinner | null {
  const applicable = group.filter((c) => c.side === side || c.side === 'both')
  if (applicable.length === 0) return null
  const best = (role: Role): Candidate | null =>
    applicable
      .filter((c) => c.role === role)
      .reduce<Candidate | null>((a, c) => (a && rank(a.severity) >= rank(c.severity) ? a : c), null)
  const bestTight = best('tight')
  const bestWeak = best('weak')
  let winner: Candidate
  let collapsed = false
  if (bestTight && bestWeak) {
    // tight-vs-weak conflict: higher severity wins; tie → tight (the actionable "release" cue).
    winner = rank(bestTight.severity) >= rank(bestWeak.severity) ? bestTight : bestWeak
    collapsed = true
  } else {
    winner = (bestTight ?? bestWeak)!
  }
  // Confidence must reflect the WINNING role's evidence, not the max across both roles.
  const confidence = applicable
    .filter((c) => c.role === winner.role)
    .reduce<'high' | 'medium' | 'low' | undefined>((acc, c) => higherConf(acc, c.confidence), undefined)
  return { role: winner.role, severity: winner.severity, confidence, name: winner.name, collapsed }
}

const sameWinner = (a: SideWinner, b: SideWinner): boolean =>
  a.role === b.role && a.severity === b.severity && a.confidence === b.confidence

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
          if (l?.slug) {
            candidates.push({
              slug: l.slug,
              name: l.name ?? l.slug,
              role,
              severity,
              confidence: l.confidence,
              side: resolveCandidateSide(f.imbalance_key, f.direction, l.side),
            })
          }
        }
      } else if (names && names.length > 0) {
        // Legacy JSONB names (populated until the muscle KB is seeded). Resolving them keeps
        // the 3D in lockstep with the 2D map, which uses the same source. Unresolvable
        // catch-alls (e.g. the genu "lateral structures … or adductors …" string) surface
        // in notShown instead of silently vanishing. This path predates link-level `side`
        // and has no way to carry it, so it always stays bilateral — including for genu
        // keys, which v1 deliberately over-colors on this legacy path as before.
        for (const name of names) {
          const slug = legacyNameToSlug(name)
          if (slug) candidates.push({ slug, name, role, severity, side: 'both' })
          else legacyUnresolved.push({ slug: '', name })
        }
      }
    }
  }

  // Group by slug first; each group is then resolved independently per subject side below,
  // so we control the viewer's `${muscle}:${side}` collapse deterministically rather than
  // relying on its last-write-wins semantics.
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
    // Resolve independently per subject side ('both'-side candidates apply to each side's
    // computation). A muscle can carry a low-confidence tight link AND a high-confidence
    // weak link (e.g. gluteus-medius / pelvic_obliquity) — confidence always reflects the
    // WINNING role's evidence on that side, never borrowed from the losing role.
    const left = winnerForSide(group, 'left')
    const right = winnerForSide(group, 'right')

    if (left?.collapsed || right?.collapsed) {
      collapsedConflicts.push({ slug, name: (left ?? right)!.name })
    }

    if (left && right && sameWinner(left, right)) {
      // Both sides resolved identically (the common case: no lateral link/direction data
      // applied, or both sides genuinely match) — keep today's bilateral shape, `side` omitted.
      states.push({ slug, role: left.role, severity: left.severity, confidence: left.confidence })
    } else {
      if (left) states.push({ slug, role: left.role, severity: left.severity, confidence: left.confidence, side: 'left' })
      if (right) states.push({ slug, role: right.role, severity: right.severity, confidence: right.confidence, side: 'right' })
    }

    if (!slugToViewerId(slug)) notShown.push({ slug, name: (left ?? right)!.name })
  }

  for (const u of legacyUnresolved) notShown.push(u)

  return { states, notShown, collapsedConflicts }
}
