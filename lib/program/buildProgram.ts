import { ALL_EXERCISES, ALL_MUSCLES } from '../../content'
import type { ExerciseContent } from '../../content/muscles/types'
import type { AssessmentResult, Finding } from '../../packages/posture-engine/src/types'
import { selectPriorities, type Capability, type SelectedPriority } from './selectPriorities'
import { computeDose, freqLabel, type Dose } from './dosage'
import { IMBALANCE_COPY, BILATERAL_KNEE_COPY, type ImbalanceCopy } from '../../content/report/imbalance-copy'
import { exerciseEvidenceForKey, type LinkEvidence } from './evidenceWeight'

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
  /** The auto-selected slug this step occupies — the key a coach swap is stored against. */
  baseSlug: string
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
  /** All imbalance keys this priority covers (incl. both sides for bilateral) — drives swap candidates. */
  keys: string[]
  label: string
  zone: 'warning' | 'danger'
  severityWord: SelectedPriority['severityWord']
  copy: ImbalanceCopy
  steps: ProgramStep[]
  hasConnect: boolean
}

/** A priority the coach demoted to "monitor only" — shown, no program. */
export interface MonitoredPriority {
  primaryKey: string
  label: string
  zone: 'warning' | 'danger'
  severityWord: SelectedPriority['severityWord']
}

/** Coach overrides, persisted per assessment so the plan regenerates deterministically. */
export interface ProgramOverrides {
  capability?: Capability
  /** Ordered active priority keys after demotions/reorder; null/undefined = natural top-3. */
  activeKeys?: string[] | null
  /** primaryKey → { fromSlug: toSlug } exercise swaps within a priority. */
  swaps?: Record<string, Record<string, string>>
}

export interface ProgramReport {
  hasPlan: boolean
  priorities: ProgramPriority[]
  monitored: MonitoredPriority[]
  /** All eligible priority keys in natural rank order — lets the coach re-promote. */
  eligibleOrder: string[]
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

export function linksForKeys(keys: string[]): Array<{ muscleSlug: string; confidence?: LinkEvidence }> {
  const out: Array<{ muscleSlug: string; confidence?: LinkEvidence }> = []
  for (const m of ALL_MUSCLES) {
    for (const l of m.links) {
      if (l.scored === false || !keys.includes(l.imbalanceKey)) continue
      out.push({ muscleSlug: m.slug, confidence: l.confidence })
    }
  }
  return out
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

const bySlug = new Map(ALL_EXERCISES.map((ex) => [ex.slug, ex]))

/**
 * Apply a coach swap: replace `from` with `to` only when `to` is a valid
 * candidate for this priority (same category, serves the keys, passes the zone
 * gate). Invalid swaps are ignored so the plan can never go off-protocol.
 */
function applySwap(ex: ExerciseContent, priority: SelectedPriority, swaps?: Record<string, string>): ExerciseContent {
  const toSlug = swaps?.[ex.slug]
  if (!toSlug) return ex
  const replacement = bySlug.get(toSlug)
  if (!replacement || replacement.category !== ex.category) return ex
  const valid = candidatesFor(priority.keys, priority.zone).some((c) => c.slug === toSlug)
  return valid ? replacement : ex
}

function buildSteps(
  priority: SelectedPriority,
  capability: Capability,
  swaps?: Record<string, string>,
): ProgramStep[] {
  const all = applyCapability(candidatesFor(priority.keys, priority.zone), capability)
  const integrative = all.filter((ex) => ex.isIntegrative)
  const core = all.filter((ex) => !ex.isIntegrative)

  // Session order: Loosen → Lengthen → Wake up → Strengthen, capped per category.
  const keyLinks = linksForKeys(priority.keys)
  core.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 9
    const cb = CATEGORY_ORDER[b.category] ?? 9
    if (ca !== cb) return ca - cb
    const ea = exerciseEvidenceForKey(a.muscles.map((m) => m.muscleSlug), keyLinks)
    const eb = exerciseEvidenceForKey(b.muscles.map((m) => m.muscleSlug), keyLinks)
    if (ea !== eb) return eb - ea // higher link evidence survives the category cap first
    return a.slug.localeCompare(b.slug) // deterministic fallback unchanged
  })
  const perCat: Record<string, number> = {}
  const picked: ExerciseContent[] = []
  for (const ex of core) {
    const used = perCat[ex.category] ?? 0
    if (used >= (CATEGORY_CAP[ex.category] ?? 2)) continue
    perCat[ex.category] = used + 1
    picked.push(ex) // original (pre-swap) — swap is applied per-step below
  }

  // `base` is the auto-selected exercise; `ex` is the effective one after any swap.
  const toStep = (base: ExerciseContent, isIntegrative: boolean): ProgramStep => {
    const ex = applySwap(base, priority, swaps)
    return {
      stepLabel: isIntegrative ? 'Connect' : STEP_LABEL[ex.category] ?? 'Move',
      slug: ex.slug,
      baseSlug: base.slug,
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
    }
  }

  const steps = picked.map((ex) => toStep(ex, false))
  if (integrative.length > 0) steps.push(toStep(integrative[0], true)) // one Connect, Week-3 only
  return steps
}

/**
 * Valid swap alternatives for one step: other candidates in the same category
 * for this priority that aren't already in the plan. Drives the coach swap menu.
 */
export function swapAlternatives(
  keys: string[],
  zone: string,
  category: string,
  excludeSlugs: string[],
): { slug: string; name: string }[] {
  const exclude = new Set(excludeSlugs)
  return candidatesFor(keys, zone)
    .filter((ex) => ex.category === category && !exclude.has(ex.slug))
    .map((ex) => ({ slug: ex.slug, name: ex.name }))
}

function labelFor(p: SelectedPriority): string {
  const copy = p.isBilateral ? BILATERAL_KNEE_COPY : IMBALANCE_COPY[p.primaryKey as keyof typeof IMBALANCE_COPY]
  return copy?.plainLabel ?? p.primaryKey
}

/** Build the full client corrective program from an assessment result. */
export function buildProgram(result: AssessmentResult, capability: Capability = 'standard'): ProgramReport {
  return buildProgramFrom(result.findings, result.overallGrade, { capability })
}

/**
 * Same program, built from the raw findings + grade (so the coach page can pass
 * its mapped findings) with optional coach overrides applied deterministically.
 */
export function buildProgramFrom(
  findings: Finding[],
  overallGrade: string,
  overrides: ProgramOverrides = {},
): ProgramReport {
  const capability = overrides.capability ?? 'standard'
  const ranked = selectPriorities(findings)

  // Active priorities: coach's ordered list if set, else the natural top 3.
  let active: SelectedPriority[]
  if (overrides.activeKeys) {
    active = overrides.activeKeys
      .map((k) => ranked.find((p) => p.primaryKey === k))
      .filter((p): p is SelectedPriority => Boolean(p))
      .slice(0, 3)
  } else {
    active = ranked.slice(0, 3)
  }
  const activeSet = new Set(active.map((p) => p.primaryKey))
  const monitored: MonitoredPriority[] = ranked
    .filter((p) => !activeSet.has(p.primaryKey))
    .map((p) => ({ primaryKey: p.primaryKey, label: labelFor(p), zone: p.zone, severityWord: p.severityWord }))

  const priorities: ProgramPriority[] = active.map((p, i) => {
    const copy = p.isBilateral ? BILATERAL_KNEE_COPY : IMBALANCE_COPY[p.primaryKey as keyof typeof IMBALANCE_COPY]
    const steps = buildSteps(p, capability, overrides.swaps?.[p.primaryKey])
    return {
      rank: i + 1,
      primaryKey: p.primaryKey,
      keys: p.keys,
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
  for (const f of findings) {
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
    monitored,
    eligibleOrder: ranked.map((p) => p.primaryKey),
    positives,
    gradeHuman: gradeHuman(overallGrade),
    oneMoreToWatch: monitored[0]?.label ?? null,
    capability,
  }
}
