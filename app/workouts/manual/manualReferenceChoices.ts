import { REFERENCE_EXERCISE_LIBRARY } from '@/lib/training/catalog/reference-library'
import type { ManualRoutineExerciseChoice } from './ManualRoutine.types'

export function manualReferenceChoices(): ManualRoutineExerciseChoice[] {
  return REFERENCE_EXERCISE_LIBRARY.map(exercise => ({
    id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    equipment: [...exercise.equipment],
    instructions: exercise.instructions,
    media: exercise.media,
    source: {
      recordUrl: exercise.source.recordUrl,
      author: exercise.source.author,
      license: exercise.source.license,
    },
  }))
}
