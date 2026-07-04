import type { ExerciseContent } from '../muscles/types'

// Targeted activation for the popliteus — the knee's "unlocking" muscle.
export const seatedTibialRotation: ExerciseContent = {
  slug: 'seated-tibial-rotation',
  name: 'Seated Tibial Internal Rotation',
  category: 'activation',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Sit on a chair with your knee bent to 90 degrees and foot flat on the floor. Keeping the thigh still and the heel planted, slowly rotate your foot and shin inward so the toes sweep toward the opposite leg, then hold 5 seconds at the end of the comfortable range. Feel the small effort behind the knee. Return slowly and repeat 10 times per side. The motion is small — quality of control matters far more than range.',
  sets: 3,
  holdSeconds: 5,
  steps: [
    'Sit on a chair with the knee bent to 90 degrees and foot flat on the floor.',
    'Keep the thigh still and the heel planted as you rotate the foot and shin inward.',
    'Hold 5 seconds at the end of the comfortable range, feeling a small effort behind the knee.',
    'Return slowly to the start, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep the thigh and heel steady so the motion comes only from the shin turning inward.',
    avoidCue: 'Avoid chasing range; keep the movement small and controlled rather than forcing it.',
  },
  muscles: [
    { muscleSlug: 'popliteus', role: 'strengthen', progressionLevel: 1 },
  ],
}
