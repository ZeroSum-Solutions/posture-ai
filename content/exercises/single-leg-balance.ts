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
  steps: [
    'Stand on one foot with a slight bend in the standing knee.',
    'Steady yourself and hold the balance for about 30 seconds, keeping the hips level.',
    'For more challenge, try the hold with your eyes closed.',
    'Return to two feet, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep the hips level and the standing knee softly bent over the middle of your foot.',
    avoidCue: 'Avoid letting one hip drop or the standing knee cave inward.',
  },
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 2 },
  ],
}
