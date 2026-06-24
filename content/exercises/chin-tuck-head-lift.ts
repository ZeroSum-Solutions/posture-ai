import type { ExerciseContent } from '../muscles/types'

// Progression of the chin tuck — adds a small head lift against gravity.
export const chinTuckHeadLift: ExerciseContent = {
  slug: 'chin-tuck-head-lift',
  name: 'Chin Tuck with Head Lift',
  category: 'strengthen',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your back with knees bent. First perform a gentle chin nod, drawing the chin toward the throat. Keeping that nod, lift your head just one to two centimeters off the floor — barely clearing it. Hold 5 seconds without letting the chin poke forward, then lower with control. If the front of your neck shakes early, build up with shorter holds first. Rest briefly between repetitions.',
  sets: 3,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'deep-cervical-flexors', role: 'strengthen', progressionLevel: 3 },
  ],
}
