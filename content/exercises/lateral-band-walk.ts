import type { ExerciseContent } from '../muscles/types'

// Progression for gluteus medius — banded side-stepping under load.
export const lateralBandWalk: ExerciseContent = {
  slug: 'lateral-band-walk',
  name: 'Lateral Band Walk',
  category: 'strengthen',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right', 'pelvic_obliquity'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Place a loop band just above your knees (or around the ankles for more challenge). Sit into a quarter-squat with feet hip-width apart, chest up. Step sideways with one foot, then follow with the other, keeping constant tension on the band and the knees tracking over the toes — never letting them cave inward. Take 8-10 steps in one direction, pause 2 seconds, then return leading with the other leg. Stay low throughout the set.',
  sets: 3,
  holdSeconds: 2,
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 3 },
  ],
}
