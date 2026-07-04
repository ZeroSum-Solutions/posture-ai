import type { ExerciseContent } from '../muscles/types'

// Horizontal pull for the mid-back retractors using a light band.
export const bandPullApart: ExerciseContent = {
  slug: 'band-pull-apart',
  name: 'Band Pull-Apart',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand tall holding a light resistance band at shoulder height, hands about shoulder-width apart, arms straight. Pull the band apart by drawing your hands outward until it touches your chest, squeezing the shoulder blades together. Pause 2 seconds at full squeeze, then return with control. Keep the ribs down and avoid shrugging toward the ears. Perform 10-15 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand tall and hold a light band at chest height with straight arms about shoulder-width apart.',
    'Sweep both hands outward until the band nears your chest, drawing the shoulder blades together.',
    'Pause briefly at the widest point, then let the band return slowly to the start.',
  ],
  form: {
    alignmentCue: 'Keep your ribs down and lead the motion with your shoulder blades, not your hands.',
    avoidCue: 'Avoid shrugging your shoulders toward your ears as you open the band.',
  },
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 2 },
  ],
}
