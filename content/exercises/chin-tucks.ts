import type { ExerciseContent } from '../muscles/types'

// Exemplar exercise file — existing seed exercise, now with muscle mappings.
// Instructions text is kept verbatim from the original seed row.
export const chinTucks: ExerciseContent = {
  slug: 'chin-tucks',
  name: 'Chin Tucks',
  category: 'strengthen',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand or sit tall. Gently retract your chin straight back, making a double chin. Hold 5 seconds, then release. Perform 10-12 repetitions per set.',
  sets: 3,
  holdSeconds: 5,
  steps: [
    'Sit or stand tall with your shoulders relaxed and eyes looking straight ahead.',
    'Glide your chin straight backward, creating a gentle double-chin without tilting the head.',
    'Hold the retracted position for about five seconds while breathing normally.',
    'Release slowly to the start and repeat for the full set of repetitions.',
  ],
  form: {
    alignmentCue: 'Slide the head straight back over the shoulders while keeping your eyes level and the jaw soft.',
    avoidCue: 'Avoid tipping the head up or down; the motion is a level glide backward, not a nod.',
  },
  muscles: [
    { muscleSlug: 'deep-cervical-flexors', role: 'strengthen', progressionLevel: 2 },
  ],
}
