import type { ExerciseContent } from '../muscles/types'

// Light-band internal rotation to load the hip through a controlled arc.
export const bandLyingHipInternalRotation: ExerciseContent = {
  slug: 'band-lying-hip-internal-rotation',
  name: 'Band Lying Hip Internal Rotation',
  category: 'informational',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: null,
  instructions:
    'Lie on your side or sit with the working knee bent and a light band providing gentle resistance to the lower leg. Rotate the lower leg to turn the hip inward with control, moving only through a comfortable range. Pause 2 seconds at the end of the turn, then return slowly to the start. Keep the hips stacked and steady so the movement comes from the hip. Perform 10-12 controlled repetitions, then switch sides.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Lie on your side or sit with the working knee bent to about ninety degrees.',
    'Loop a light band so it gently resists the lower leg.',
    'Rotate the lower leg to turn the hip inward with control, through a comfortable range.',
    'Pause briefly at the end of the turn, then return the leg slowly to the start.',
    'Finish your repetitions, then switch to the other side.',
  ],
  form: {
    alignmentCue: 'Keep your hips stacked and steady so the motion comes from the hip itself.',
    avoidCue: 'Avoid rolling the pelvis or forcing the leg past a comfortable range.',
  },
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 2 },
  ],
}
