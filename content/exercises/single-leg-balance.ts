import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const singleLegBalance: ExerciseContent = {
  slug: 'single-leg-balance',
  name: 'Single Leg Balance',
  category: 'activation',
  primaryDeviationKeys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand on one foot with a slight bend in the knee. Maintain your balance for 30 seconds. Keep your hips level. Progress to eyes closed for added challenge. Repeat on both sides.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 2 },
  ],
}
