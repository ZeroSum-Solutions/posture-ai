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
  steps: [
    'Stand tall and hold a wall or chair for steady balance.',
    'Curl one heel slowly up toward your glutes, keeping the thighs lined up together.',
    'Hold about 5 seconds at the top, then lower the heel with control.',
    'Repeat for your reps, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep both thighs parallel so the bend happens only at the knee.',
    avoidCue: 'Avoid swinging the leg up; lift the heel slowly and lower it under control.',
  },
  muscles: [
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'popliteus', role: 'strengthen', progressionLevel: 2 },
  ],
}
