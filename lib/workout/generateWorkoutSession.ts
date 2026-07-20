/**
 * Pure flattener: an already-built (and coach-overridden) ProgramReport → one
 * linear, playable SessionSnapshot for the guided workout player. No selection
 * logic lives here — buildProgramFrom() stays the single source of truth for
 * WHICH exercises; this module only decides ORDER and TIMING, so the player can
 * never drift from the coach-approved program.
 *
 * Reliability is inherited: selectPriorities() already admits only reliable
 * warning/danger findings, so nothing unreliable can reach a session. If that
 * gate leaves nothing playable, this returns null (empty-session floor) — the
 * caller shows a re-capture CTA instead of minting a hollow workout.
 */
import { DISCLAIMER } from '../../packages/posture-engine/src/engine'
import type { ExerciseContent } from '../../content/muscles/types'
import { ALL_EXERCISES } from '../../content'
import type { ProgramReport } from '../program/buildProgram'
import type { Capability } from '../program/selectPriorities'
import type { Week, Dose } from '../program/dosage'
import type { LegalSnapshot } from '../legal/types'

export type SessionTiming =
  | { kind: 'hold'; sets: number; secondsPerSet: number; restSeconds: number }
  | { kind: 'reps'; sets: number; repsPerSet: number; restSeconds: number }

export interface SessionItem {
  index: number
  slug: string
  /** The auto-selected slug this step occupies (swap bookkeeping parity with ProgramStep). */
  baseSlug: string
  name: string
  category: ExerciseContent['category']
  stepLabel: string
  priorityKey: string
  priorityLabel: string
  isIntegrative: boolean
  /** Authored screening-safe instructions — the on-screen caption/detail text. */
  instructions: string
  /** Optional demonstration media copied from content — player falls back to poster/gradient when absent. */
  media?: ExerciseContent['media']
  /** Optional short coaching cues copied from content. */
  form?: ExerciseContent['form']
  /** Optional discrete coaching steps copied from content. */
  steps?: string[]
  timing: SessionTiming
}

interface SessionSnapshotBase {
  week: Week
  capability: Capability
  /** The screening findings this session derives from — intro voice + traceability. */
  priorities: { primaryKey: string; label: string; zone: 'warning' | 'danger'; severityWord: string }[]
  items: SessionItem[]
  estimatedDurationSec: number
}

export interface LegacySessionSnapshot extends SessionSnapshotBase {
  version: 1
  /** Travels with the snapshot so a shared link always carries it. */
  disclaimer: string
}

export interface GovernedSessionSnapshot extends SessionSnapshotBase {
  version: 2
  /** Immutable notice resolved when this workout artifact was minted. */
  legalNotice: LegalSnapshot
}

export type SessionSnapshot = LegacySessionSnapshot | GovernedSessionSnapshot

// Session order mirrors the builder's authored arc; interleaving by band means
// the client warms up globally once instead of once per priority.
const BAND: Record<string, number> = { mobility: 0, stretch: 1, activation: 2, strengthen: 3 }

// Rest between sets, by category (content has no authored rest field yet; these
// are the plan's defaults — stretches/mobility flow, strength work recovers).
const REST_SECONDS: Record<string, number> = { mobility: 10, stretch: 10, activation: 20, strengthen: 20 }
const DEFAULT_REST = 15

// Duration estimate constants (documented estimates, not measurements):
// a controlled corrective rep runs ~4s; each item costs ~8s of Up-Next + 3-2-1.
const SECONDS_PER_REP = 4
const ITEM_TRANSITION_SEC = 8

const exerciseBySlug = new Map(ALL_EXERCISES.map((ex) => [ex.slug, ex]))

function toTiming(dose: Dose, category: string, isIntegrative: boolean): SessionTiming {
  const restSeconds = isIntegrative
    ? REST_SECONDS.strengthen
    : REST_SECONDS[category] ?? DEFAULT_REST
  if (dose.type === 'hold' && dose.seconds != null) {
    return { kind: 'hold', sets: dose.sets, secondsPerSet: dose.seconds, restSeconds }
  }
  return { kind: 'reps', sets: dose.sets, repsPerSet: dose.reps ?? 1, restSeconds }
}

function itemSeconds(t: SessionTiming): number {
  const work = t.kind === 'hold' ? t.sets * t.secondsPerSet : t.sets * t.repsPerSet * SECONDS_PER_REP
  return work + t.restSeconds * Math.max(0, t.sets - 1) + ITEM_TRANSITION_SEC
}

export function generateWorkoutSession(
  report: ProgramReport,
  opts: { week: Week; legalNotice?: LegalSnapshot },
): SessionSnapshot | null {
  const { week } = opts

  // Flatten: every step of every active priority that has a dose this week.
  type Flat = Omit<SessionItem, 'index'> & { priorityRank: number }
  const flat: Flat[] = []
  const seen = new Set<string>()
  for (const priority of report.priorities) {
    for (const step of priority.steps) {
      const dose = step.weeks[week - 1]
      if (!dose) continue // e.g. Connect exists only in week 3
      if (seen.has(step.slug)) continue // same exercise serving two priorities plays once
      seen.add(step.slug)
      const ex = exerciseBySlug.get(step.slug)
      flat.push({
        slug: step.slug,
        baseSlug: step.baseSlug,
        name: step.name,
        category: step.category,
        stepLabel: step.stepLabel,
        priorityKey: priority.primaryKey,
        priorityLabel: priority.label,
        isIntegrative: step.isIntegrative,
        instructions: ex?.instructions ?? '',
        media: ex?.media,
        form: ex?.form,
        steps: ex?.steps,
        timing: toTiming(dose, step.category, step.isIntegrative),
        priorityRank: priority.rank,
      })
    }
  }

  // Empty-session floor: never mint a hollow workout.
  if (flat.length === 0) return null

  // Order: step band across priorities (stable by priority rank within a band),
  // with the integrative Connect item(s) pinned last.
  flat.sort((a, b) => {
    if (a.isIntegrative !== b.isIntegrative) return a.isIntegrative ? 1 : -1
    const ba = BAND[a.category] ?? 9
    const bb = BAND[b.category] ?? 9
    if (ba !== bb) return ba - bb
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
    return a.slug.localeCompare(b.slug)
  })

  const items: SessionItem[] = flat.map((f, index) => {
    const { priorityRank, ...item } = f
    void priorityRank // ordering key only — not part of the snapshot
    return { ...item, index }
  })
  const estimatedDurationSec = items.reduce((acc, i) => acc + itemSeconds(i.timing), 0)

  const snapshotBase: SessionSnapshotBase = {
    week,
    capability: report.capability,
    priorities: report.priorities.map((p) => ({
      primaryKey: p.primaryKey,
      label: p.label,
      zone: p.zone,
      severityWord: p.severityWord,
    })),
    items,
    estimatedDurationSec,
  }

  return opts.legalNotice
    ? { ...snapshotBase, version: 2, legalNotice: opts.legalNotice }
    : { ...snapshotBase, version: 1, disclaimer: DISCLAIMER }
}

/**
 * Upgrade a freshly built legacy snapshot at the persistence boundary without
 * changing its playable content. Persisted v1 snapshots remain valid; all newly
 * minted governed artifacts use v2.
 */
export function governSessionSnapshot(
  snapshot: SessionSnapshot,
  legalNotice: LegalSnapshot,
): GovernedSessionSnapshot {
  return {
    version: 2,
    week: snapshot.week,
    capability: snapshot.capability,
    priorities: snapshot.priorities,
    items: snapshot.items,
    estimatedDurationSec: snapshot.estimatedDurationSec,
    legalNotice,
  }
}
