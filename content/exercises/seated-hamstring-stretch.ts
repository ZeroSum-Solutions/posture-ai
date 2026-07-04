import type { ExerciseContent } from '../muscles/types'

export const seatedHamstringStretch: ExerciseContent = {
  slug: 'seated-hamstring-stretch',
  name: 'Seated Hamstring Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Sit on the floor with one leg extended straight in front of you and the other leg relaxed. Hinge forward from your hips over the straight leg, keeping your back long rather than rounded, until you feel a gentle stretch behind your thigh. Hold the position and breathe steadily. Ease back out and switch sides.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Sit tall with one leg extended straight in front of you and the other leg relaxed.',
    'Hinge forward from your hips over the straight leg, keeping your back long.',
    'Stop when you feel a gentle stretch behind your thigh and breathe steadily.',
    'Hold the position, then ease back out with control.',
    'Switch sides and repeat with the other leg extended.',
  ],
  form: {
    alignmentCue: 'Lead with your chest and hinge from the hips to keep your back long.',
    avoidCue: 'Avoid rounding your back or forcing your torso down to reach farther.',
  },
  muscles: [
    { muscleSlug: 'hamstrings', role: 'stretch', progressionLevel: 2 },
  ],
}
