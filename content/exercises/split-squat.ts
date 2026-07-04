import type { ExerciseContent } from '../muscles/types'

// Progression for quad/VMO control — single-leg loading with alignment focus.
export const splitSquat: ExerciseContent = {
  slug: 'split-squat',
  name: 'Split Squat',
  category: 'strengthen',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  isIntegrative: true,
  instructions:
    'Take a long stride position, one foot forward and one back, back heel lifted. Keeping the torso tall, lower straight down until the front thigh nears parallel and the back knee hovers above the floor. Watch the front knee: it should track over the second toe the entire time, never collapsing inward. Pause 2 seconds at the bottom, then drive up through the front foot. Do 8-10 repetitions per side; hold light weights to progress.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Take a long stride with one foot forward and one back, back heel lifted.',
    'Keeping your torso tall, lower straight down until the front thigh nears parallel and the back knee hovers above the floor.',
    'Pause briefly at the bottom, then drive up through the front foot.',
    'Complete your repetitions, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Track the front knee over your second toe and keep your torso tall through each rep.',
    avoidCue: 'Avoid letting the front knee collapse inward as you lower and press up.',
  },
  muscles: [
    { muscleSlug: 'quadriceps', role: 'strengthen', progressionLevel: 3 },
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 2 },
  ],
}
