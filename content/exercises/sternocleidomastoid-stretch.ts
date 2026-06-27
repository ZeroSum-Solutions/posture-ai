import type { ExerciseContent } from '../muscles/types'

// Front-of-neck lengthening for the SCM without straining the throat.
export const sternocleidomastoidStretch: ExerciseContent = {
  slug: 'sternocleidomastoid-stretch',
  name: 'Sternocleidomastoid Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Sit or stand tall and place one hand flat on your collarbone to gently anchor it down. Rotate your head toward the same side as the hand, then tilt it slightly back and away until you feel a light stretch along the front-side of your neck. Keep the movement small and the jaw relaxed — this area needs only gentle tension. Hold 30 seconds, return slowly, and repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'sternocleidomastoid', role: 'stretch', progressionLevel: 2 },
  ],
}
