import type { ExerciseContent } from '../muscles/types'

// Classic "look at your armpit" stretch for the levator scapulae.
export const levatorScapulaeStretch: ExerciseContent = {
  slug: 'levator-scapulae-stretch',
  name: 'Levator Scapulae Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['forward_head_posture', 'posterior_imbalanced_shoulders'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Sit tall and grasp the edge of your chair with one hand to anchor the shoulder down. Turn your head about 45 degrees away from that side, then look down toward your opposite armpit. Place your free hand lightly on the back of your head and add gentle pressure until you feel a stretch along the back-side of the neck into the shoulder blade. Hold 20-30 seconds, release slowly, and repeat on the other side.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'levator-scapulae', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'upper-trapezius', role: 'stretch', progressionLevel: 1 },
  ],
}
