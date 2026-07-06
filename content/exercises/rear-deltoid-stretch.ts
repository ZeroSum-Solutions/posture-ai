import type { ExerciseContent } from '../muscles/types'

// Cross-body hold to open the back of the shoulder and mid-back.
export const rearDeltoidStretch: ExerciseContent = {
  slug: 'rear-deltoid-stretch',
  name: 'Rear Deltoid Stretch',
  category: 'informational',
  primaryDeviationKeys: ['posterior_imbalanced_shoulders'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand or sit tall and draw one arm horizontally across the front of your chest. Use the opposite forearm to gently guide it closer to your body until you feel a stretch across the back of the shoulder. Keep the shoulder relaxed and down rather than shrugging it toward your ear. Hold 30 seconds while breathing steadily, then release and repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand or sit tall with your feet hip-width apart and shoulders relaxed.',
    'Draw one arm horizontally across the front of your chest at shoulder height.',
    'Use the opposite forearm to gently guide it closer until you feel a stretch across the back of the shoulder.',
    'Breathe steadily and keep the shoulder down through the full hold.',
    'Ease the arm back out, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep the working shoulder relaxed and down as you draw the arm across your chest.',
    avoidCue: 'Avoid shrugging the shoulder toward your ear to chase a deeper stretch.',
  },
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'stretch', progressionLevel: 1 },
  ],
}
