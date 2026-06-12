import type { ExerciseContent } from '../muscles/types'

// Isometric quad strengthener with easy knee-tracking feedback.
export const wallSit: ExerciseContent = {
  slug: 'wall-sit',
  name: 'Wall Sit',
  category: 'strengthen',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  instructions:
    'Stand with your back against a wall and feet about half a meter out, hip-width apart. Slide down until your knees bend to roughly 45-60 degrees (work toward 90 as strength builds), keeping the whole back in contact with the wall. Check that both kneecaps track in line with the second toe — not caving inward or bowing out. Hold 20-30 seconds while breathing steadily, then push through the heels to slide back up.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'quadriceps', role: 'strengthen', progressionLevel: 2 },
  ],
}
