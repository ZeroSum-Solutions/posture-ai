import { notFound } from 'next/navigation'
import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
import ExercisesLibrary from './ExercisesLibrary'
import { approvedClinicalExercises } from '@/lib/clinical-content/catalog'

export const dynamic = 'force-dynamic'

export default async function ExercisesPage() {
  const access = await currentPractitionerClinicalContentAccess()
  if (!access.surfaces.recommendations) notFound()
  const exercises = approvedClinicalExercises(access)
    .map((exercise) => ({
      id: exercise.slug,
      name: exercise.name,
      category: exercise.category,
      instructions: exercise.instructions,
      sets: exercise.sets,
      hold_seconds: exercise.holdSeconds,
      poster_url: exercise.media?.posterUrl ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return <ExercisesLibrary exercises={exercises} />
}
