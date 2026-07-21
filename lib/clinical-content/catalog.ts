import { ALL_EXERCISES, ALL_MUSCLES } from '@/content'
import type { ExerciseContent, MuscleContent } from '@/content/muscles/types'
import { clinicalLinkId, type ClinicalContentAccess } from './policy'

export function clinicalExerciseMuscleId(
  exerciseSlug: string,
  muscle: ExerciseContent['muscles'][number],
): string {
  return `exercise_muscle:${exerciseSlug}:${muscle.muscleSlug}:${muscle.role}:${muscle.progressionLevel}`
}

/**
 * Return reviewed records from the same typed source that produced the release
 * hashes. Runtime clinical rendering must not trust mutable database copies of
 * these fields merely because their slugs were approved.
 */
export function approvedClinicalExercises(access: ClinicalContentAccess): ExerciseContent[] {
  const approved = new Set(access.approvedExerciseSlugs)
  return ALL_EXERCISES.filter((exercise) => approved.has(exercise.slug))
}

export function approvedClinicalMuscles(access: ClinicalContentAccess): MuscleContent[] {
  const approved = new Set(access.approvedMuscleSlugs)
  return ALL_MUSCLES.filter((muscle) => approved.has(muscle.slug))
}

export function approvedClinicalLinks(access: ClinicalContentAccess) {
  const approved = new Set(access.approvedLinkIds)
  return approvedClinicalMuscles(access).flatMap((muscle) =>
    muscle.links
      .filter((link) => approved.has(clinicalLinkId(muscle.slug, link.imbalanceKey, link.role)))
      .map((link) => ({ muscle, link })),
  )
}

export function approvedExerciseMuscles(
  access: ClinicalContentAccess,
  exercise: ExerciseContent,
): ExerciseContent['muscles'] {
  const approved = new Set(access.approvedExerciseMuscleIds)
  return exercise.muscles.filter((muscle) =>
    approved.has(clinicalExerciseMuscleId(exercise.slug, muscle)),
  )
}
