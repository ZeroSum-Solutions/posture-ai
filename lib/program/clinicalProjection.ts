import { ALL_EXERCISES } from '@/content'
import { deriveExerciseRecommendations } from '@/lib/exercises'
import { toEngineFinding, type StoredFinding } from '@/lib/findings/storedFindingToEngine'
import {
  buildProgramFrom,
  swapAlternatives,
  type ProgramOverrides,
  type ProgramPriority,
  type ProgramReport,
  type ProgramStep,
} from '@/lib/program/buildProgram'
import { isCoherentForKey } from '@/lib/program/roleCoherence'
import type { Capability } from '@/lib/program/selectPriorities'
import { generateWorkoutSession } from '@/lib/workout/generateWorkoutSession'

export type ClinicalProgramStep = ProgramStep & {
  alternatives: Array<{ slug: string; name: string }>
}

export type ClinicalProgramPriority = Omit<ProgramPriority, 'steps'> & {
  steps: ClinicalProgramStep[]
}

export type ClinicalProgramReport = Omit<ProgramReport, 'priorities'> & {
  priorities: ClinicalProgramPriority[]
}

export type ClinicalExerciseProjection = {
  slug: string
  name: string
  category: string
  instructions: string
  sets: number
  holdSeconds: number
  dosageType: string
  reps: { min: number; max: number } | null
}

export type ClinicalProjection = {
  program: ClinicalProgramReport
  exercises: ClinicalExerciseProjection[]
  sessionPreview: { itemCount: number; estimatedDurationSec: number } | null
}

type AssessmentProgramState = {
  overall_grade: string | null
  capability?: string | null
  priority_keys?: string[] | null
  exercise_swaps?: Record<string, Record<string, string>> | null
}

const CAPABILITIES = new Set<Capability>(['regression', 'standard', 'progression'])

/**
 * Build the exact release-scoped clinical DTO consumed by the browser. The
 * authored catalogs and selection algorithms stay on the server; browser
 * chunks receive only items already admitted by the HG-03 dependency closure.
 */
export function buildClinicalProjection(
  assessment: AssessmentProgramState,
  findings: StoredFinding[],
  clinicalContent: NonNullable<ProgramOverrides['clinicalContent']>,
): ClinicalProjection {
  const capability = CAPABILITIES.has(assessment.capability as Capability)
    ? assessment.capability as Capability
    : 'standard'
  const engineFindings = findings.map(toEngineFinding)
  const baseProgram = buildProgramFrom(engineFindings, assessment.overall_grade ?? 'C', {
    capability,
    activeKeys: assessment.priority_keys ?? null,
    swaps: assessment.exercise_swaps ?? undefined,
    clinicalContent,
  })
  const approvedLinks = new Set(clinicalContent.approvedLinkIds)
  const exercises = deriveExerciseRecommendations(
    ALL_EXERCISES.filter((exercise) => clinicalContent.approvedExerciseSlugs.includes(exercise.slug)),
    findings,
    {
      isCoherentForKey: (exercise, key) => isCoherentForKey(exercise, key, approvedLinks),
    },
  ).map((exercise) => ({
    slug: exercise.slug,
    name: exercise.name,
    category: exercise.category,
    instructions: exercise.instructions,
    sets: exercise.sets,
    holdSeconds: exercise.holdSeconds,
    dosageType: exercise.dosageType,
    reps: exercise.reps,
  }))
  const program: ClinicalProgramReport = {
    ...baseProgram,
    priorities: baseProgram.priorities.map((priority) => ({
      ...priority,
      steps: priority.steps.map((step) => ({
        ...step,
        alternatives: swapAlternatives(
          priority.keys,
          priority.zone,
          step.category,
          priority.steps.filter((other) => other.baseSlug !== step.baseSlug).map((other) => other.slug),
          priority.screenedKeys,
          clinicalContent,
        ),
      })),
    })),
  }
  const session = generateWorkoutSession(baseProgram, { week: 1 })
  return {
    program,
    exercises,
    sessionPreview: session
      ? { itemCount: session.items.length, estimatedDurationSec: session.estimatedDurationSec }
      : null,
  }
}
