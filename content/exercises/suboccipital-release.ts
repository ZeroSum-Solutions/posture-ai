import type { ExerciseContent } from '../muscles/types'

// Gentle release for the small muscles at the base of the skull.
export const suboccipitalRelease: ExerciseContent = {
  slug: 'suboccipital-release',
  name: 'Suboccipital Release with Chin Nod',
  category: 'stretch',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Lie on your back and place a rolled towel or soft massage ball at the base of your skull, just where the head meets the neck. Let the weight of your head rest on it. Slowly nod your chin toward your chest in a small "yes" motion, then return. Keep your jaw and shoulders relaxed throughout. Continue the slow nods for 45-60 seconds, breathing steadily, then rest.',
  sets: 2,
  holdSeconds: 60,
  steps: [
    'Lie on your back and place a rolled towel or soft ball at the base of your skull.',
    'Let the weight of your head rest gently onto the support.',
    'Nod your chin slowly toward your chest in a small yes motion, then return.',
    'Keep your jaw and shoulders relaxed as you continue the slow nods.',
    'Continue for about forty-five to sixty seconds, breathing steadily, then rest.',
  ],
  form: {
    alignmentCue: 'Let the head rest heavy on the support and keep each chin nod slow and small.',
    avoidCue: 'Avoid tensing the jaw or shoulders and do not press the head hard into the support.',
  },
  muscles: [
    { muscleSlug: 'suboccipitals', role: 'stretch', progressionLevel: 2 },
  ],
}
