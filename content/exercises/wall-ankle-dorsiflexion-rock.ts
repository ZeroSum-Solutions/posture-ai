import type { ExerciseContent } from '../muscles/types'

export const wallAnkleDorsiflexionRock: ExerciseContent = {
  slug: 'wall-ankle-dorsiflexion-rock',
  name: 'Wall Ankle Dorsiflexion Rock',
  category: 'informational',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: null,
  instructions:
    'Set up half-kneeling or standing facing a wall, with your front foot a few inches away from it. Drive your front knee forward over your toes toward the wall while keeping that heel flat on the floor. Rock back to the start and repeat, feeling the movement open up through your ankle. Count each forward rock as one repetition per side. Switch sides. Perform 8-10 repetitions per side per set.',
  sets: 2,
  holdSeconds: 2,
  steps: [
    'Face a wall in a half-kneeling or standing stance, front foot a few inches from the wall.',
    'Drive your front knee forward over your toes toward the wall, keeping the heel flat.',
    'Feel the movement open through your ankle, then rock back to the start.',
    'Repeat smoothly for your reps, then switch sides and work the other ankle.',
  ],
  form: {
    alignmentCue: 'Track your knee straight over your toes and keep the heel pressed down.',
    avoidCue: 'Avoid letting your heel lift or your knee cave inward as you rock forward.',
  },
  muscles: [
    { muscleSlug: 'gastrocnemius-soleus', role: 'stretch', progressionLevel: 2 },
  ],
}
