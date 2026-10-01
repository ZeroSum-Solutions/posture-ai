// Pure glue between the results page and the 3D anatomy viewer: which muscles a finding
// involves (per side), how a viewer id maps back to a content slug, and which of this
// assessment's program steps work a given muscle. No React, so it unit-tests in node.

import { evidenceWeight } from '@/lib/program/evidenceWeight'
import type { ClinicalProgramReport, ClinicalProgramStep } from '@/lib/program/clinicalProjection'
import {
  findingsToMuscleStates,
  slugToViewerId,
  type AssessmentFinding,
  type MuscleStateInput,
  type Role,
} from './findingsToMuscleStates'
import manifest from './muscleIds.generated.json'

export type BodySide = 'left' | 'right'

/**
 * Tight/weak colors, identical to the 3D viewer's mid-intensity glass (muscle-viewer
 * src/data/stateColors.ts) so page chips, legend and detail dots match what the model paints.
 */
export const STATE_COLORS = { tight: '#ff5f5f', weak: '#4db0f7' } as const

export function severityWord(severity?: number): string {
  if (severity == null) return ''
  if (severity >= 67) return 'marked'
  if (severity >= 34) return 'moderate'
  return 'mild'
}

/** One line for a muscle's two sides, e.g. "Tight · both sides" or "Right weaker than left". */
export function sidesSummary(m: Pick<MuscleSides, 'left' | 'right'> | null): string {
  const l = m?.left ?? null
  const r = m?.right ?? null
  if (!l && !r) return 'No finding in this scan'
  if (!l) return `${r!.role === 'tight' ? 'Tight' : 'Weak'} · right side only`
  if (!r) return `${l.role === 'tight' ? 'Tight' : 'Weak'} · left side only`
  if (l.role !== r.role) return `Right ${r.role}, left ${l.role}`
  const dl = l.severity ?? 0
  const dr = r.severity ?? 0
  const role = l.role === 'tight' ? 'Tight' : 'Weak'
  if (Math.abs(dl - dr) < 10) return `${role} · both sides${severityWord(Math.max(dl, dr)) ? ` (${severityWord(Math.max(dl, dr))})` : ''}`
  const word = l.role === 'tight' ? 'tighter' : 'weaker'
  return dr > dl ? `Right ${word} than left` : `Left ${word} than right`
}

export interface SideState {
  role: Role
  severity?: number
}

/** One muscle as a finding (or the whole assessment) presents it, per subject side. */
export interface MuscleSides {
  slug: string
  name: string
  viewerId: string | null
  left: SideState | null
  right: SideState | null
}

/**
 * States for the viewer's `applyMuscleStates`: severity scaled by the link's evidence grade, so a
 * low-confidence link paints lighter than a high-confidence one at the same measured severity.
 */
export function viewerStates(states: MuscleStateInput[]): MuscleStateInput[] {
  return states.map((s) => ({
    ...s,
    severity: s.severity == null ? undefined : Math.round(s.severity * evidenceWeight(s.confidence)),
  }))
}

/** Collapse adapter states (side omitted ⇒ both) into one left/right record per slug. */
export function sidesBySlug(
  states: MuscleStateInput[],
  names: Record<string, string> = {},
): MuscleSides[] {
  const bySlug = new Map<string, MuscleSides>()
  for (const s of states) {
    const entry =
      bySlug.get(s.slug) ??
      { slug: s.slug, name: names[s.slug] ?? prettySlug(s.slug), viewerId: slugToViewerId(s.slug), left: null, right: null }
    const state: SideState = { role: s.role, severity: s.severity }
    if (s.side !== 'right') entry.left = state
    if (s.side !== 'left') entry.right = state
    bySlug.set(s.slug, entry)
  }
  return [...bySlug.values()]
}

/** The muscles one finding involves, per side, ordered tight-first then by severity. */
export function musclesForFinding(finding: AssessmentFinding): MuscleSides[] {
  const names: Record<string, string> = {}
  for (const l of [...(finding.tight_muscle_links ?? []), ...(finding.weak_muscle_links ?? [])])
    if (l?.slug && l.name) names[l.slug] = l.name
  const { states } = findingsToMuscleStates([finding])
  const rank = (m: MuscleSides) => {
    const s = [m.left, m.right].filter((x): x is SideState => !!x)
    const tight = s.some((x) => x.role === 'tight') ? 0 : 1
    return tight * 1000 - Math.max(0, ...s.map((x) => x.severity ?? 0))
  }
  return sidesBySlug(states, names).sort((a, b) => rank(a) - rank(b))
}

/** Viewer ids to spotlight for a finding (muscles the 3D model can draw). */
export function spotlightIds(muscles: MuscleSides[]): string[] {
  return [...new Set(muscles.map((m) => m.viewerId).filter((id): id is string => !!id))]
}

const ALIAS_BY_VIEWER_ID: Record<string, string> = Object.fromEntries(
  Object.entries(manifest.aliases as Record<string, string>).map(([slug, id]) => [id, slug]),
)

/**
 * The content slug behind a viewer id. Prefer a slug this assessment actually references (so the
 * modal shows ITS findings), then a manifest alias, then the plain underscore→hyphen form.
 */
export function slugForViewerId(viewerId: string, states: MuscleStateInput[]): string {
  const referenced = states.find((s) => slugToViewerId(s.slug) === viewerId)
  if (referenced) return referenced.slug
  return ALIAS_BY_VIEWER_ID[viewerId] ?? viewerId.replace(/_/g, '-')
}

export type ExerciseRole = 'stretch' | 'strengthen'

export interface ProgramStepMatch {
  step: ClinicalProgramStep
  role: ExerciseRole
  priorityLabel: string
}

/**
 * This assessment's program steps that work the muscle, in program order. A tight side asks for
 * lengthening (stretch), a weak side for strengthening; `exercises` is the muscle's approved
 * exercise catalog with its role for each.
 */
export function programStepsFor(
  program: ClinicalProgramReport | null,
  exercises: Array<{ slug: string; role: ExerciseRole }>,
  sides: Pick<MuscleSides, 'left' | 'right'> | null,
): ProgramStepMatch[] {
  if (!program) return []
  const wanted = new Set<ExerciseRole>()
  for (const s of [sides?.left, sides?.right]) {
    if (s?.role === 'tight') wanted.add('stretch')
    if (s?.role === 'weak') wanted.add('strengthen')
  }
  const roleBySlug = new Map<string, ExerciseRole>()
  for (const e of exercises) if (wanted.size === 0 || wanted.has(e.role)) roleBySlug.set(e.slug, e.role)
  const out: ProgramStepMatch[] = []
  const seen = new Set<string>()
  for (const priority of program.priorities)
    for (const step of priority.steps) {
      const role = roleBySlug.get(step.slug)
      if (!role || seen.has(step.slug)) continue
      seen.add(step.slug)
      out.push({ step, role, priorityLabel: priority.label })
    }
  return out
}

export function prettySlug(slug: string): string {
  const words = slug.replace(/[-_]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
