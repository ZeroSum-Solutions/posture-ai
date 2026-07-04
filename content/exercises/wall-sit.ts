import type { ExerciseContent } from '../muscles/types'

// Isometric quad strengthener with easy knee-tracking feedback.
export const wallSit: ExerciseContent = {
  slug: 'wall-sit',
  name: 'Wall Sit',
  category: 'strengthen',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand with your back against a wall and feet about half a meter out, hip-width apart. Slide down until your knees bend to roughly 45-60 degrees (work toward 90 as strength builds), keeping the whole back in contact with the wall. Check that both kneecaps track in line with the second toe — not caving inward or bowing out. Hold 20-30 seconds while breathing steadily, then push through the heels to slide back up.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand with your back on a wall and feet about half a meter out, hip-width apart.',
    'Slide down until the knees bend to roughly 45 to 60 degrees, back flat on the wall.',
    'Hold 20 to 30 seconds while breathing steadily.',
    'Push through your heels to slide back up the wall.',
  ],
  form: {
    alignmentCue: 'Track each kneecap in line with the second toe and keep the whole back on the wall.',
    avoidCue: 'Avoid letting the knees cave inward or bow outward as you hold.',
  },
  muscles: [
    { muscleSlug: 'quadriceps', role: 'strengthen', progressionLevel: 2 },
  ],
}
