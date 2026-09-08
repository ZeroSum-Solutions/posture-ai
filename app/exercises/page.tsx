import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
import { REFERENCE_EXERCISE_LIBRARY } from '@/lib/training/catalog/reference-library'
import ExercisesLibrary from './ExercisesLibrary'
import { approvedClinicalExercises } from '@/lib/clinical-content/catalog'

export const dynamic = 'force-dynamic'

export default async function ExercisesPage() {
  const access = await currentPractitionerClinicalContentAccess()
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
  const referenceExercises = REFERENCE_EXERCISE_LIBRARY.map(exercise => ({
    id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    equipment: [...exercise.equipment],
    primaryMuscles: [...exercise.primaryMuscles],
    instructions: exercise.instructions,
    source: {
      recordUrl: exercise.source.recordUrl,
      author: exercise.source.author,
      license: exercise.source.license,
    },
  }))
  return <ExercisesLibrary exercises={exercises} referenceExercises={referenceExercises} />
}
