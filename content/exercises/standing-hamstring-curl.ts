import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const standingHamstringCurl: ExerciseContent = {
  slug: 'standing-hamstring-curl',
  name: 'Standing Hamstring Curl',
  category: 'strengthen',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand holding a wall or chair for balance. Slowly curl one heel up toward your glutes against gravity. Hold ~5 seconds at the top, then lower with control. Keep your thighs parallel. Perform 10-12 repetitions per set, then switch legs.',
  sets: 3,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'popliteus', role: 'strengthen', progressionLevel: 2 },
  ],
}
