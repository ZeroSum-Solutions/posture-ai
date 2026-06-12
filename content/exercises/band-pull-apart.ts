import type { ExerciseContent } from '../muscles/types'

// Horizontal pull for the mid-back retractors using a light band.
export const bandPullApart: ExerciseContent = {
  slug: 'band-pull-apart',
  name: 'Band Pull-Apart',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  instructions:
    'Stand tall holding a light resistance band at shoulder height, hands about shoulder-width apart, arms straight. Pull the band apart by drawing your hands outward until it touches your chest, squeezing the shoulder blades together. Pause 2 seconds at full squeeze, then return with control. Keep the ribs down and avoid shrugging toward the ears. Perform 10-15 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 2 },
  ],
}
