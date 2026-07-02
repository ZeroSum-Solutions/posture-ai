import { buildProgramFrom } from '../program/buildProgram'
import type { Capability } from '../program/selectPriorities'
import { toEngineFinding, type StoredFinding } from '../findings/storedFindingToEngine'
import { generateWorkoutSession, type SessionSnapshot } from './generateWorkoutSession'
import type { Week } from '../program/dosage'

/** The stored-assessment fields the session builder reads (coach overrides + grade). */
export interface AssessmentForSession {
  overall_grade: string | null
  capability?: string | null
  priority_keys?: string[] | null
  exercise_swaps?: Record<string, Record<string, string>> | null
}

const CAPABILITIES = new Set<Capability>(['regression', 'standard', 'progression'])

/**
 * Assemble a playable SessionSnapshot from a stored assessment + its findings,
 * applying the same coach overrides (capability / active priorities / swaps) the
 * results page uses — buildProgramFrom stays the single source of truth, so a
 * launched session matches exactly what the coach approved. Returns null when
 * nothing is playable (empty-session floor), so the caller shows a re-capture CTA
 * instead of minting a hollow workout.
 */
export function buildSessionFromAssessment(
  assessment: AssessmentForSession,
  findings: StoredFinding[],
  week: Week,
): SessionSnapshot | null {
  const capability: Capability = CAPABILITIES.has(assessment.capability as Capability)
    ? (assessment.capability as Capability)
    : 'standard'

  const report = buildProgramFrom(findings.map(toEngineFinding), assessment.overall_grade ?? 'C', {
    capability,
    activeKeys: assessment.priority_keys ?? null,
    swaps: assessment.exercise_swaps ?? undefined,
  })

  return generateWorkoutSession(report, { week })
}
