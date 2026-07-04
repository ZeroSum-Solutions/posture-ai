import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const thoracicExtension: ExerciseContent = {
  slug: 'thoracic-extension',
  name: 'Thoracic Extension on Foam Roller',
  category: 'mobility',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 10 },
  instructions:
    'Place a foam roller perpendicular to your spine at mid-back. Support your head with your hands. Extend back over the roller gently. Move slowly up and down the thoracic spine. Pause 3 seconds at each position. Perform 8-10 slow extensions per set.',
  sets: 2,
  holdSeconds: 3,
  steps: [
    'Set a foam roller across your mid-back, lying so it sits perpendicular to your spine.',
    'Cradle your head in your hands to support the neck and keep the chin gently tucked.',
    'Ease back over the roller, letting the upper back extend, and pause about three seconds.',
    'Shift the roller a little up or down the mid-back and repeat through each position slowly.',
  ],
  form: {
    alignmentCue: 'Let the extension happen at the upper back while the ribs and lower back stay quiet.',
    avoidCue: 'Avoid arching from the lower back or forcing the stretch; move only within a comfortable range.',
  },
  muscles: [
    { muscleSlug: 'pectoralis-major', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'pectoralis-minor', role: 'stretch', progressionLevel: 2 },
  ],
}
