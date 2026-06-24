import type { ExerciseContent } from '../muscles/types'

// Side-lying trunk rotation — lengthens the obliques and opens the chest.
export const openBookStretch: ExerciseContent = {
  slug: 'open-book-stretch',
  name: 'Open Book Stretch',
  category: 'mobility',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 8, max: 10 },
  instructions:
    'Lie on your side with knees bent to 90 degrees and stacked, arms extended together in front of your chest. Keeping the knees glued together on the floor, lift the top arm and rotate it across your body toward the opposite side, letting the chest and trunk open like a book. Follow the moving hand with your eyes. Pause 3-5 seconds at your comfortable end range, feeling the stretch through the waist and trunk, then return. Do 8-10 rotations, then switch sides.',
  sets: 2,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'obliques', role: 'stretch', progressionLevel: 2 },
  ],
}
