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
  steps: [
    'Lie on your back with knees bent and your head resting flat, using a thin towel if needed.',
    'Without lifting the head, nod your chin gently toward your throat as if saying a subtle yes.',
    'Feel the deep muscles at the front of the neck engage rather than the large surface ones.',
    'Hold the nod for about ten seconds while breathing steadily, then relax.',
    'Return to the neutral start and repeat for the full set.',
  ],
  form: {
    alignmentCue: 'Let the head stay heavy on the floor and make the nod small and deep at the front of the neck.',
    avoidCue: 'Avoid lifting the head or tensing the large surface muscles; keep the movement subtle.',
  },
  muscles: [
    { muscleSlug: 'deep-cervical-flexors', role: 'strengthen', progressionLevel: 1 },
  ],
}
