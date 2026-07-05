import type { ExerciseContent } from '../muscles/types'

// Progression of the glute bridge — one leg carries the load.
export const singleLegGluteBridge: ExerciseContent = {
  slug: 'single-leg-glute-bridge',
  name: 'Single-Leg Glute Bridge',
  category: 'strengthen',
  primaryDeviationKeys: ['trunk_lean', 'pelvic_axial_rotation', 'knee_extension_back_knee'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  isIntegrative: true,
  instructions:
    'Lie on your back with knees bent and feet flat. Extend one leg straight or hold that knee to your chest. Squeeze the glute of the grounded leg and drive the hips up until the body forms a straight line from knee to shoulder, keeping the pelvis level — do not let one side drop or rotate. Hold 3 seconds at the top, then lower with control. Do 8-10 repetitions on one side before switching. Keep the ribs down and avoid arching the lower back.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Lie on your back with both knees bent, feet flat and hip-width apart.',
    'Straighten one leg or hug that knee toward your chest to unload it.',
    'Push through the grounded heel and lift your hips into a straight knee-to-shoulder line.',
    'Keep your pelvis level and hold at the top for three seconds without letting a hip drop.',
    'Lower with control and reset your breath.',
    'Repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep your pelvis square and level as you press up through the working heel.',
    avoidCue: 'Avoid arching your lower back or letting one hip sag toward the floor.',
  },
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 3 },
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 2 },
  ],
}
