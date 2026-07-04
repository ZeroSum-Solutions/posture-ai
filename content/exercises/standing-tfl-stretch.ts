import type { ExerciseContent } from '../muscles/types'

// Standing stretch biased to the TFL and lateral thigh line.
export const standingTflStretch: ExerciseContent = {
  slug: 'standing-tfl-stretch',
  name: 'Standing TFL & IT Band Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand beside a wall with one hand on it for balance. Cross the leg nearest the wall behind the other leg. Keeping both feet grounded, push the hip nearest the wall toward it while leaning your upper body slightly away, until you feel a stretch along the outside of the hip and thigh of the crossed-behind leg. Keep the trunk tall rather than collapsing sideways. Hold 30 seconds, then switch sides and repeat.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand beside a wall with one hand resting on it for balance.',
    'Cross the leg nearest the wall behind your other leg, both feet grounded.',
    'Push the wall-side hip toward the wall while leaning your upper body slightly away.',
    'Feel the stretch along the outside of the hip and thigh, keeping your trunk tall.',
    'Hold for about 30 seconds, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Drive the hip sideways toward the wall while your torso stays tall and leans away.',
    avoidCue: 'Avoid collapsing your trunk sideways instead of pushing from the hip.',
  },
  muscles: [
    { muscleSlug: 'tfl-it-band', role: 'stretch', progressionLevel: 2 },
  ],
}
