import type { ExerciseContent } from '../muscles/types'

// Equipment-free stretch for the front of the shoulder and chest.
export const handsBehindBackChestOpener: ExerciseContent = {
  slug: 'hands-behind-back-chest-opener',
  name: 'Hands-Behind-Back Chest Opener',
  category: 'stretch',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'maintain',
  instructions:
    'Stand tall and interlace your fingers behind your lower back, palms facing in. Straighten the elbows, roll the shoulders back and down, and gently lift the hands away from your body until you feel a stretch across the front of the shoulders and chest. Keep the chin level and ribs stacked over the pelvis — avoid arching the lower back to cheat the lift. Hold 20-30 seconds, breathing slowly, then release.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'anterior-deltoid', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'pectoralis-major', role: 'stretch', progressionLevel: 1 },
  ],
}
