import type { ExerciseContent } from '../muscles/types'

// Self-massage along the lateral thigh — TFL and IT band region.
export const foamRollLateralThigh: ExerciseContent = {
  slug: 'foam-roll-lateral-thigh',
  name: 'Foam Rolling: Lateral Thigh',
  category: 'mobility',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 1, max: 2 },
  instructions:
    'Lie on your side with a foam roller under the outside of your thigh, just below the hip, supporting yourself on your forearm. Place the top leg over and in front for support. Roll slowly from below the hip bone toward just above the knee and back, pausing 5-10 seconds on tight or restricted spots and letting the tissue soften. Keep the pressure firm but tolerable — ease off by taking more weight through the arms. Spend about 45-60 seconds per side.',
  sets: 2,
  holdSeconds: 45,
  steps: [
    'Lie on your side with a foam roller under the outside of your thigh just below the hip, propped on your forearm.',
    'Place the top leg over and in front for support.',
    'Roll slowly from below the hip bone toward just above the knee and back, pausing on tight spots to let them soften.',
    'Spend about 45 to 60 seconds, then switch to the other side.',
  ],
  form: {
    alignmentCue: 'Keep pressure firm but tolerable and roll slowly through the length of the outer thigh.',
    avoidCue: 'Avoid rolling directly over the knee or hip bone rather than the soft tissue between them.',
  },
  muscles: [
    { muscleSlug: 'tfl-it-band', role: 'stretch', progressionLevel: 1 },
  ],
}
