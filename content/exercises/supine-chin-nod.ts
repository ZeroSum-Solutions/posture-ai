import type { ExerciseContent } from '../muscles/types'

// Regression of the chin tuck — gravity-assisted, lying down.
export const supineChinNod: ExerciseContent = {
  slug: 'supine-chin-nod',
  name: 'Supine Chin Nod',
  category: 'activation',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your back with knees bent and head resting on the floor (use a thin towel if needed). Without lifting your head, gently nod your chin toward your throat as if saying a subtle "yes". You should feel the small muscles deep in the front of the neck working, not the big surface muscles. Hold the nod 10 seconds while breathing steadily, then relax. Repeat for the full set.',
  sets: 3,
  holdSeconds: 10,
  muscles: [
    { muscleSlug: 'deep-cervical-flexors', role: 'strengthen', progressionLevel: 1 },
  ],
}
