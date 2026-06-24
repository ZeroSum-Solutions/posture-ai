import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const clamshell: ExerciseContent = {
  slug: 'clamshell',
  name: 'Clamshell',
  category: 'strengthen',
  primaryDeviationKeys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your side with knees stacked and bent at 45 degrees. Keeping your feet together, open your top knee upward like a clamshell. Pause, then lower slowly. Perform 10-12 repetitions per set, then switch sides.',
  sets: 3,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 1 },
  ],
}
