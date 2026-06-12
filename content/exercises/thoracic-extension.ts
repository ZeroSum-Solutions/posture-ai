import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const thoracicExtension: ExerciseContent = {
  slug: 'thoracic-extension',
  name: 'Thoracic Extension on Foam Roller',
  category: 'mobility',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  instructions:
    'Place a foam roller perpendicular to your spine at mid-back. Support your head with your hands. Extend back over the roller gently. Move slowly up and down the thoracic spine. Pause 3 seconds at each position. Perform 8-10 slow extensions per set.',
  sets: 2,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'pectoralis-major', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'pectoralis-minor', role: 'stretch', progressionLevel: 2 },
  ],
}
