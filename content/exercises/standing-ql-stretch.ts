import type { ExerciseContent } from '../muscles/types'

// Side-bend stretch for the quadratus lumborum and lateral trunk.
export const standingQlStretch: ExerciseContent = {
  slug: 'standing-ql-stretch',
  name: 'Standing Side-Bend Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['pelvic_obliquity'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand with feet hip-width apart. Cross one leg behind the other, then reach the arm on that same side overhead and lean your trunk toward the opposite side, keeping both hips level and facing forward. You should feel a stretch along the side of the lower back and waist, from the hip up toward the ribs. Avoid leaning forward or backward. Hold 20-30 seconds, return upright slowly, and repeat on the other side.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'quadratus-lumborum', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'obliques', role: 'stretch', progressionLevel: 1 },
    { muscleSlug: 'latissimus-dorsi', role: 'stretch', progressionLevel: 1 },
  ],
}
