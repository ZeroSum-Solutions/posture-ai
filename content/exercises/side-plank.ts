import type { ExerciseContent } from '../muscles/types'

// Full side plank — progression for obliques and lateral hip stabilizers.
export const sidePlank: ExerciseContent = {
  slug: 'side-plank',
  name: 'Side Plank',
  category: 'strengthen',
  primaryDeviationKeys: ['pelvic_obliquity'],
  minZone: 'warning',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Lie on your side with legs straight and stacked, forearm on the floor with the elbow directly under the shoulder. Lift your hips until the body forms one straight line from head to feet, and keep the shoulders and hips stacked vertically. Reach the top arm toward the ceiling or rest it on your hip. Do not let the hips drift back or drop toward the floor. Hold 20-30 seconds breathing steadily, then switch sides.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Lie on your side with legs straight and stacked, forearm down and elbow under the shoulder.',
    'Lift the hips until the body forms one straight line from head to feet.',
    'Reach the top arm toward the ceiling or rest it along your hip, keeping shoulders and hips stacked.',
    'Hold twenty to thirty seconds breathing steadily, lower with control, then switch sides.',
  ],
  form: {
    alignmentCue: 'Stack the shoulders and hips vertically and drive the hips up into a straight line.',
    avoidCue: 'Avoid letting the hips drift backward or sink toward the floor during the hold.',
  },
  muscles: [
    { muscleSlug: 'obliques', role: 'strengthen', progressionLevel: 3 },
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 2 },
  ],
}
