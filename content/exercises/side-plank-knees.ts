import type { ExerciseContent } from '../muscles/types'

// Regression of the side plank — performed from the knees.
export const sidePlankKnees: ExerciseContent = {
  slug: 'side-plank-knees',
  name: 'Side Plank from Knees',
  category: 'strengthen',
  primaryDeviationKeys: ['pelvic_axial_rotation', 'pelvic_obliquity'],
  minZone: 'warning',
  instructions:
    'Lie on your side with knees bent to about 90 degrees and your forearm on the floor, elbow under the shoulder. Keeping knees on the ground, lift your hips until the body forms a straight line from head to knees. Stack the shoulders and hips vertically — avoid rolling forward or letting the hips sag. Hold 15-20 seconds while breathing steadily, lower with control, and repeat on the other side.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'obliques', role: 'strengthen', progressionLevel: 1 },
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 1 },
  ],
}
