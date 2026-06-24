import { ALL_EXERCISES } from '../../content'
import type { ExerciseContent } from '../../content/muscles/types'
import type { AssessmentResult, Finding } from '../../packages/posture-engine/src/types'
import { selectPriorities, type Capability, type SelectedPriority } from './selectPriorities'
import { computeDose, freqLabel, type Dose } from './dosage'
import { IMBALANCE_COPY, BILATERAL_KNEE_COPY, type ImbalanceCopy } from '../../content/report/imbalance-copy'

const ZONE_RANK: Record<string, number> = { maintain: 0, warning: 1, danger: 2, unreliable: -1 }
const CATEGORY_ORDER: Record<string, number> = { mobility: 0, stretch: 1, activation: 2, strengthen: 3 }
const STEP_LABEL: Record<string, string> = {
  mobility: 'Loosen',
  stretch: 'Lengthen',
  activation: 'Wake up',
  strengthen: 'Strengthen',
}
const CAP_LEVEL: Record<Capability, number> = { regression: 1, standard: 2, progression: 3 }
// Per-category curation caps so the client plan stays tidy and learnable.
const CATEGORY_CAP: Record<string, number> = { mobility: 1, stretch: 3, activation: 1, strengthen: 2 }

export interface ProgramStep {
  stepLabel: string // Loosen | Lengthen | Wake up | Strengthen | Connect
  slug: string
  name: string
  category: ExerciseContent['category']
  freq: string
  isIntegrative: boolean
  /** Authored rep band (e.g. 10–15); null for hold/stretch items. Surfaced coach-side. */
  repRange: ExerciseContent['reps']
  weeks: [Dose | null, Dose | null, Dose | null]
}

export interface ProgramPriority {
  rank: number
  primaryKey: string
  label: string
  zone: 'warning' | 'danger'
  severityWord: SelectedPriority['severityWord']
  copy: ImbalanceCopy
  steps: ProgramStep[]
  hasConnect: boolean
}

export interface ProgramReport {
  hasPlan: boolean
  priorities: ProgramPriority[]
  positives: string[]
  gradeHuman: string
  oneMoreToWatch: string | null
  capability: Capability
}

function gradeHuman(grade: string): string {
  if (grade === 'S' || grade === 'A') return 'Looking great — a strong baseline to keep up.'
  if (grade === 'B') return 'A solid baseline with a few things to work on.'
  if (grade === 'C') return 'A few clear areas to focus on over the next few weeks.'
  return 'Several areas worth dedicating some focused time to.'
}

function repLevel(ex: ExerciseContent): number {
  return ex.muscles[0]?.progressionLevel ?? 2
}
function primaryMuscle(ex: ExerciseContent): string {
  return ex.muscles[0]?.muscleSlug ?? ex.slug
}

/** Recommended exercises for a priority: imbalance match + zone gate, no informational. */
function candidatesFor(keys: string[], zone: string): ExerciseContent[] {
  return ALL_EXERCISES.filter(
    (ex) =>
      ex.category !== 'informational' &&
      ex.primaryDeviationKeys.some((k) => keys.includes(k)) &&
      ZONE_RANK[zone] >= ZONE_RANK[ex.minZone],
  )
}

/**
 * Capability dial: within a (category, primary muscle) ladder, keep the variant
 * whose progressionLevel is closest to the client's capability (ties → lower).
 * This seeds the starting variant; the exercise then stays fixed across weeks.
 */
function applyCapability(list: ExerciseContent[], capability: Capability): ExerciseContent[] {
  const target = CAP_LEVEL[capability]
  const groups = new Map<string, ExerciseContent[]>()
  for (const ex of list) {
    const k = `${ex.category}::${primaryMuscle(ex)}`
    const g = groups.get(k)
    if (g) g.push(ex)
    else groups.set(k, [ex])
  }
  const chosen: ExerciseContent[] = []
  for (const g of groups.values()) {
    g.sort((a, b) => {
      const da = Math.abs(repLevel(a) - target)
      const db = Math.abs(repLevel(b) - target)
      if (da !== db) return da - db
      return repLevel(a) - repLevel(b)
    })
    chosen.push(g[0])
  }
  return chosen
}

function buildSteps(priority: SelectedPriority, capability: Capability): ProgramStep[] {
  const all = applyCapability(candidatesFor(priority.keys, priority.zone), capability)
  const integrative = all.filter((ex) => ex.isIntegrative)
  const core = all.filter((ex) => !ex.isIntegrative)

  // Session order: Loosen → Lengthen → Wake up → Strengthen, capped per category.
  core.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 9
    const cb = CATEGORY_ORDER[b.category] ?? 9
    if (ca !== cb) return ca - cb
    return a.slug.localeCompare(b.slug)
  })
  const perCat: Record<string, number> = {}
  const picked: ExerciseContent[] = []
  for (const ex of core) {
    const used = perCat[ex.category] ?? 0
    if (used >= (CATEGORY_CAP[ex.category] ?? 2)) continue
    perCat[ex.category] = used + 1
    picked.push(ex)
  }

  const toStep = (ex: ExerciseContent, isIntegrative: boolean): ProgramStep => ({
    stepLabel: isIntegrative ? 'Connect' : STEP_LABEL[ex.category] ?? 'Move',
    slug: ex.slug,
    name: ex.name,
    category: ex.category,
    freq: freqLabel(ex.category),
    isIntegrative,
    repRange: ex.reps,
    weeks: [
      computeDose(ex, 1, isIntegrative),
      computeDose(ex, 2, isIntegrative),
      computeDose(ex, 3, isIntegrative),
    ],
  })

  const steps = picked.map((ex) => toStep(ex, false))
  if (integrative.length > 0) steps.push(toStep(integrative[0], true)) // one Connect, Week-3 only
  return steps
}

/** Build the full client corrective program from an assessment result. */
export function buildProgram(result: AssessmentResult, capability: Capability = 'standard'): ProgramReport {
  const ranked = selectPriorities(result.findings)
  const top = ranked.slice(0, 3)

  const priorities: ProgramPriority[] = top.map((p, i) => {
    const copy = p.isBilateral ? BILATERAL_KNEE_COPY : IMBALANCE_COPY[p.primaryKey as keyof typeof IMBALANCE_COPY]
    const steps = buildSteps(p, capability)
    return {
      rank: i + 1,
      primaryKey: p.primaryKey,
      label: copy?.plainLabel ?? p.primaryKey,
      zone: p.zone,
      severityWord: p.severityWord,
      copy: copy ?? BILATERAL_KNEE_COPY,
      steps,
      hasConnect: steps.some((s) => s.isIntegrative),
    }
  })

  // A body area counts as a positive only when it has a maintained finding and
  // no warning/danger finding (so we never call an area "good" while it's also a priority).
  const REGION_FRIENDLY: Record<Finding['region'], string> = {
    head_shoulders: 'head & shoulders',
    spine: 'upper back',
    pelvis: 'hips',
    leg: 'knees & legs',
  }
  const byRegion = new Map<Finding['region'], Finding[]>()
  for (const f of result.findings) {
    if (!f.reliable) continue
    const g = byRegion.get(f.region)
    if (g) g.push(f)
    else byRegion.set(f.region, [f])
  }
  const positives: string[] = []
  for (const [region, fs] of byRegion) {
    const anyMaintain = fs.some((f) => f.zone === 'maintain')
    const anyIssue = fs.some((f) => f.zone === 'warning' || f.zone === 'danger')
    if (anyMaintain && !anyIssue) positives.push(REGION_FRIENDLY[region])
  }

  return {
    hasPlan: priorities.length > 0,
    priorities,
    positives,
    gradeHuman: gradeHuman(result.overallGrade),
    oneMoreToWatch: ranked.length > 3 ? (IMBALANCE_COPY[ranked[3].primaryKey as keyof typeof IMBALANCE_COPY]?.plainLabel ?? null) : null,
    capability,
  }
}
